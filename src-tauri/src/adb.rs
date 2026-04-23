use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::process::Command;
use tokio::sync::Semaphore;
use std::sync::LazyLock;
use std::io::{Read, Write};

// 跨平台设置命令创建标志
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 全局 ADB 命令并发限制（严格串行，同一时间只允许 1 个 ADB 命令执行）
/// 这是核心机制：确保上一条 ADB 命令完全结束后才执行下一条，防止设备 offline
static ADB_SEMAPHORE: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(1));

/// ADB 错误类型
#[derive(Debug, Error)]
pub enum AdbError {
    #[error("ADB 命令执行失败: {0}")]
    ExecutionFailed(String),

    #[error("设备未找到: {0}")]
    DeviceNotFound(String),

    #[error("解析输出失败: {0}")]
    ParseError(String),

    #[error("ADB 未安装或不在 PATH 中")]
    AdbNotFound,

    #[error("设备无响应: {0}")]
    DeviceUnresponsive(String),

    #[error("超时: {0}")]
    Timeout(String),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
}

pub type AdbResult<T> = Result<T, AdbError>;

fn default_platform() -> String {
    "android".to_string()
}

/// ADB 设备信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdbDevice {
    pub serial: String,
    pub status: String,
    pub model: String,
    pub brand: String,
    pub android_version: String,
    pub sdk_version: String,
    pub battery_level: Option<u8>,
    pub screen_resolution: String,
    pub cpu_info: String,
    pub total_memory: String,
    pub available_storage: String,
    pub total_storage: String,
    pub device_type: String,
    #[serde(default = "default_platform")]
    pub platform: String,
}

impl Default for AdbDevice {
    fn default() -> Self {
        Self {
            serial: String::new(),
            status: String::new(),
            model: String::new(),
            brand: String::new(),
            android_version: String::new(),
            sdk_version: String::new(),
            battery_level: None,
            screen_resolution: String::new(),
            cpu_info: String::new(),
            total_memory: String::new(),
            available_storage: String::new(),
            total_storage: String::new(),
            device_type: String::new(),
            platform: "android".to_string(),
        }
    }
}

/// 应用信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub package_name: String,
    pub app_name: String,
    pub version_name: String,
    pub version_code: String,
    pub icon_base64: Option<String>,
    pub install_time: String,
    pub app_size: String,
    pub is_system: bool,
    pub uid: u32,
}

/// 文件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: String,
    pub permissions: String,
    pub last_modified: String,
}

/// APK 信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApkInfo {
    pub package_name: String,
    pub app_name: String,
    pub version_name: String,
    pub version_code: String,
    pub permissions: Vec<String>,
    pub icon_base64: Option<String>,
    pub file_size: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min_sdk_version: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_sdk_version: Option<i32>,
}

/// 性能信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerformanceInfo {
    pub cpu_usage: f32,
    pub memory_total: String,
    pub memory_used: String,
    pub memory_free: String,
    pub memory_total_bytes: u64,
    pub memory_used_bytes: u64,
    pub memory_free_bytes: u64,
    pub battery_level: u8,
    pub battery_temperature: String,
    pub battery_status: String,
    pub storage_total: String,
    pub storage_used: String,
    pub storage_free: String,
    pub storage_total_bytes: u64,
    pub storage_used_bytes: u64,
    pub storage_free_bytes: u64,
}

/// ADB 命令构建器
pub struct AdbCommand {
    adb_path: String,
}

/// 解析 df -h 的人类可读大小（如 "24G"、"9.4G"、"512M"、"1.8K"）为字节数
fn parse_df_size(s: &str) -> u64 {
    let s = s.trim();
    if s.is_empty() {
        return 0;
    }
    let (num_str, multiplier) = if let Some(n) = s.strip_suffix("T") {
        (n, 1024u64 * 1024 * 1024 * 1024)
    } else if let Some(n) = s.strip_suffix("G") {
        (n, 1024u64 * 1024 * 1024)
    } else if let Some(n) = s.strip_suffix("M") {
        (n, 1024u64 * 1024)
    } else if let Some(n) = s.strip_suffix("K") {
        (n, 1024u64)
    } else {
        // 纯数字，假设是 1K 块
        return s.parse::<u64>().unwrap_or(0) * 1024;
    };
    let num: f64 = num_str.trim().parse().unwrap_or(0.0);
    (num * multiplier as f64) as u64
}

impl AdbCommand {
    /// 创建新的 ADB 命令构建器
    pub fn new(adb_path: &str) -> Self {
        Self {
            adb_path: adb_path.to_string(),
        }
    }

    /// 执行 ADB 命令并返回输出
    /// 执行 ADB 命令（走全局信号量，串行执行）
    /// 用于所有可能影响设备稳定性的命令
    pub async fn execute(&self, args: &[&str]) -> AdbResult<String> {
        let _permit = ADB_SEMAPHORE.acquire().await
            .map_err(|_| AdbError::ExecutionFailed("ADB 并发限制获取失败".to_string()))?;

        self.run_command(args).await
    }

    /// 执行轻量 ADB 命令（不走信号量，可并发）
    /// 仅用于 adb devices 等不会影响设备稳定性的只读查询
    pub async fn execute_fast(&self, args: &[&str]) -> AdbResult<String> {
        self.run_command(args).await
    }

    /// 实际执行 ADB 命令
    async fn run_command(&self, args: &[&str]) -> AdbResult<String> {
        let cmd_str = args.join(" ");
        eprintln!("[adb] +{} | {:?}", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str);

        let start = std::time::Instant::now();
        let mut cmd = Command::new(&self.adb_path);
        cmd.args(args);
        
        // 在 Windows 上设置 CREATE_NO_WINDOW 标志，防止 cmd 窗口弹出
        #[cfg(target_os = "windows")]
        { cmd.creation_flags(CREATE_NO_WINDOW); }
        
        let output = cmd.output()
            .await
            .map_err(|e| {
                eprintln!("[adb] -{} | {:?} FAILED after {}ms", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str, start.elapsed().as_millis());
                if e.kind() == std::io::ErrorKind::NotFound {
                    AdbError::AdbNotFound
                } else {
                    AdbError::ExecutionFailed(format!("执行 adb {:?} 失败: {}", args, e))
                }
            })?;

        let elapsed = start.elapsed().as_millis();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        if !output.status.success() {
            let err_msg = if stderr.trim().is_empty() {
                stdout.trim().to_string()
            } else {
                stderr.trim().to_string()
            };
            eprintln!("[adb] -{} | {:?} ERROR ({}ms): {}", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str, elapsed, &err_msg[..err_msg.len().min(200)]);
            return Err(AdbError::ExecutionFailed(err_msg));
        }

        eprintln!("[adb] -{} | {:?} OK ({}ms, {} bytes)", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str, elapsed, output.stdout.len());
        Ok(stdout)
    }

    /// 获取已连接的设备列表（带 5 秒超时，避免设备 offline 时卡住）
    pub async fn devices(&self) -> AdbResult<Vec<(String, String)>> {
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            self.execute(&["devices"])
        ).await;

        let output = match result {
            Ok(Ok(output)) => output,
            Ok(Err(e)) => return Err(e),
            Err(_) => {
                eprintln!("[devices] adb devices timed out (5s), device likely offline");
                return Err(AdbError::ExecutionFailed("ADB 命令超时，设备可能离线".to_string()));
            }
        };

        let devices: Vec<(String, String)> = output
            .lines()
            .skip(1)
            .filter(|line| !line.trim().is_empty())
            .filter_map(|line| {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    Some((parts[0].to_string(), parts[1].to_string()))
                } else {
                    None
                }
            })
            .collect();
        Ok(devices)
    }

    /// 通过 WiFi 连接设备
    pub async fn connect_wifi(&self, ip: &str, port: u16) -> AdbResult<String> {
        let addr = format!("{}:{}", ip, port);
        let output = self.execute(&["connect", &addr]).await?;
        Ok(output.trim().to_string())
    }

    /// 断开设备连接
    pub async fn disconnect(&self, serial: &str) -> AdbResult<String> {
        let output = self.execute(&["disconnect", serial]).await?;
        Ok(output.trim().to_string())
    }

    /// 安装 APK
    /// 安装应用（流式读取进度）
    pub async fn install_with_progress<F>(
        &self,
        serial: &str,
        path: &str,
        mut progress_callback: F,
    ) -> AdbResult<String>
    where
        F: FnMut(u32, &str),
    {
        let mut cmd = tokio::process::Command::new(&self.adb_path);
        cmd.args(["-s", serial, "install", "-r", path])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        
        // 在 Windows 上设置 CREATE_NO_WINDOW 标志，防止 cmd 窗口弹出
        #[cfg(target_os = "windows")]
        { cmd.creation_flags(CREATE_NO_WINDOW); }
        
        let mut child = cmd.spawn()
            .map_err(|e| AdbError::ExecutionFailed(e.to_string()))?;

        use tokio::io::{AsyncBufReadExt, BufReader};

        // 读取 stderr（adb install 的进度和错误输出都在 stderr）
        let mut stderr_output = String::new();
        if let Some(stderr) = child.stderr.take() {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line_trimmed = line.trim();
                eprintln!("[install] {}", line_trimmed);
                stderr_output.push_str(line_trimmed);
                stderr_output.push('\n');

                // 解析进度：格式 "  apk: 45%" 或 "Streaming: 45%"
                if let Some(pct_str) = line_trimmed.strip_suffix('%') {
                    let parts: Vec<&str> = pct_str.split(':').collect();
                    if let Some(last) = parts.last() {
                        if let Ok(pct) = last.trim().parse::<u32>() {
                            progress_callback(pct, line_trimmed);
                        }
                    }
                }

                // 解析状态消息
                if line_trimmed.contains("Performing Streamed Install") {
                    progress_callback(0, "正在传输 APK...");
                } else if line_trimmed.contains("Installing") {
                    progress_callback(50, "正在安装...");
                }
            }
        }

        // 读取 stdout
        let stdout_output = if let Some(stdout) = child.stdout.take() {
            let mut buf = String::new();
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                buf.push_str(&line);
                buf.push('\n');
            }
            buf
        } else {
            String::new()
        };

        let status = child.wait().await.map_err(|e| AdbError::ExecutionFailed(e.to_string()))?;

        if !status.success() {
            // 从 stderr 中提取关键错误信息
            let error_detail = stderr_output.lines()
                .find(|l| l.contains("INSTALL_FAILED") || l.contains("Failure") || l.contains("Error"))
                .unwrap_or(&stderr_output)
                .trim();
            return Err(AdbError::ExecutionFailed(format!(
                "adb install failed (exit code {:?}): {}",
                status.code(),
                error_detail
            )));
        }

        Ok(stdout_output.trim().to_string())
    }

    /// 安装应用（简单版，无进度回调）
    pub async fn install(&self, serial: &str, path: &str) -> AdbResult<String> {
        let output = self.execute(&["-s", serial, "install", "-r", path]).await?;
        Ok(output.trim().to_string())
    }

    /// 判断是否为归档格式 APK（.xapk / .apks / .apkm）
    pub fn is_archive_apk(path: &str) -> bool {
        let ext = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        matches!(ext.as_str(), "xapk" | "apks" | "apkm")
    }

    /// 判断是否为 HarmonyOS 安装包（.hap）
    pub fn is_hap_file(path: &str) -> bool {
        let ext = std::path::Path::new(path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_lowercase())
            .unwrap_or_default();
        ext == "hap"
    }

    /// 安装归档格式 APK（.xapk / .apks / .apkm）
    /// 流程：解压 → 读取 manifest.json → adb install-multiple
    pub async fn install_archive<F>(
        &self,
        serial: &str,
        path: &str,
        device_abi: Option<&str>,
        device_density: Option<&str>,
        mut progress_callback: F,
    ) -> AdbResult<String>
    where
        F: FnMut(u32, &str),
    {
        progress_callback(0, "正在解压安装包...");

        // 1. 打开 ZIP 文件
        let file = std::fs::File::open(path)
            .map_err(|e| AdbError::ExecutionFailed(format!("无法打开文件: {}", e)))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| AdbError::ExecutionFailed(format!("无法解析 ZIP: {}", e)))?;

        progress_callback(5, "正在读取分包信息...");

        // 2. 读取 manifest.json 获取分包列表
        let split_apks = Self::read_split_apks_from_archive(&mut archive, device_abi, device_density)?;

        if split_apks.is_empty() {
            return Err(AdbError::ExecutionFailed("安装包中未找到任何 APK 文件".into()));
        }

        eprintln!("[install_archive] Found {} split APKs", split_apks.len());
        for apk in &split_apks {
            eprintln!("[install_archive]   - {}", apk);
        }

        // 3. 解压所有 APK 到临时目录
        let temp_dir = std::env::temp_dir().join(format!("xapk_install_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| AdbError::ExecutionFailed(format!("创建临时目录失败: {}", e)))?;

        let mut apk_paths: Vec<String> = Vec::new();

        for apk_name in &split_apks {
            let mut entry = archive.by_name(apk_name)
                .map_err(|e| AdbError::ExecutionFailed(format!("无法读取分包 {}: {}", apk_name, e)))?;

            let out_path = temp_dir.join(apk_name);
            if let Some(parent) = out_path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| AdbError::ExecutionFailed(format!("创建目录失败: {}", e)))?;
            }

            let mut out_file = std::fs::File::create(&out_path)
                .map_err(|e| AdbError::ExecutionFailed(format!("创建文件失败: {}", e)))?;

            let mut buffer = Vec::new();
            entry.read_to_end(&mut buffer)
                .map_err(|e| AdbError::ExecutionFailed(format!("解压失败: {}", e)))?;

            out_file.write_all(&buffer)
                .map_err(|e| AdbError::ExecutionFailed(format!("写入文件失败: {}", e)))?;

            apk_paths.push(out_path.to_string_lossy().to_string());
        }

        // 在 await 之前提取 OBB 信息（archive 不能跨 await 边界）
        let obb_files: Vec<String> = archive.file_names()
            .filter(|n| n.ends_with(".obb"))
            .map(|s| s.to_string())
            .collect();
        let package_name = Self::read_package_from_manifest(&mut archive)
            .unwrap_or_default();

        progress_callback(30, &format!("正在安装 {} 个分包...", apk_paths.len()));

        // 4. 用 adb install-multiple 安装所有分包
        let result = self.install_multiple_with_progress(serial, &apk_paths, |pct, msg| {
            // 将 install-multiple 的进度映射到 30-90 范围
            let mapped_pct = 30 + (pct as u32 * 60 / 100);
            progress_callback(mapped_pct, msg);
        }).await;

        // 5. 清理临时目录
        let _ = std::fs::remove_dir_all(&temp_dir);

        // 6. 处理 OBB 文件（如果有）- 重新打开 ZIP
        if result.is_ok() && !obb_files.is_empty() && !package_name.is_empty() {
            progress_callback(92, "正在安装 OBB 扩展文件...");
            eprintln!("[install_archive] Found {} OBB files", obb_files.len());

            // 先提取所有 OBB 文件到临时目录（不跨 await 边界持有 ZipFile）
            let obb_temp_paths: Vec<(String, String)> = {
                let mut paths = Vec::new();
                if let Ok(file) = std::fs::File::open(path) {
                    if let Ok(mut archive) = zip::ZipArchive::new(file) {
                        for obb_name in &obb_files {
                            if let Ok(mut entry) = archive.by_name(obb_name) {
                                let obb_temp = temp_dir.join(obb_name);
                                let _ = std::fs::create_dir_all(&temp_dir);
                                if let Some(parent) = obb_temp.parent() {
                                    let _ = std::fs::create_dir_all(parent);
                                }
                                if let Ok(mut out_file) = std::fs::File::create(&obb_temp) {
                                    let mut buf = Vec::new();
                                    let _ = entry.read_to_end(&mut buf);
                                    let _ = out_file.write_all(&buf);
                                    paths.push((obb_name.clone(), obb_temp.to_string_lossy().to_string()));
                                }
                            }
                        }
                    }
                }
                paths
            };

            // 推送 OBB 文件到设备
            for (obb_name, obb_temp_path) in obb_temp_paths {
                let device_path = format!("/sdcard/Android/obb/{}/{}", package_name, obb_name);
                let _ = self.execute(&[
                    "-s", serial, "shell", "mkdir", "-p",
                    &format!("/sdcard/Android/obb/{}", package_name),
                ]).await;
                let _ = self.execute(&[
                    "-s", serial, "push",
                    &obb_temp_path,
                    &device_path,
                ]).await;
            }

            let _ = std::fs::remove_dir_all(&temp_dir);
        }

        result?;

        progress_callback(100, "安装完成");
        Ok("Success".to_string())
    }

    /// 从 ZIP 归档中读取分包 APK 列表（智能选择匹配设备的分包）
    fn read_split_apks_from_archive(
        archive: &mut zip::ZipArchive<std::fs::File>,
        device_abi: Option<&str>,
        device_density: Option<&str>,
    ) -> AdbResult<Vec<String>> {
        // 尝试读取 manifest.json
        let manifest_names = ["manifest.json", "info.json", "meta.json"];
        let mut manifest_json: Option<serde_json::Value> = None;

        for name in &manifest_names {
            if let Ok(mut entry) = archive.by_name(name) {
                let mut content = String::new();
                if entry.read_to_string(&mut content).is_ok() {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        manifest_json = Some(json);
                        break;
                    }
                }
            }
        }

        let mut split_apks = Vec::new();

        if let Some(manifest) = manifest_json {
            // 从 manifest 中提取分包列表
            let split_keys = ["split_apks", "apks", "splits"];
            for key in &split_keys {
                if let Some(splits) = manifest.get(*key).and_then(|v| v.as_array()) {
                    for item in splits {
                        let file_name = if let Some(s) = item.as_str() {
                            s.to_string()
                        } else if let Some(obj) = item.as_object() {
                            obj.get("file").or(obj.get("path")).or(obj.get("apk")).or(obj.get("name"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("")
                                .to_string()
                        } else {
                            continue;
                        };
                        if !file_name.is_empty() {
                            split_apks.push(file_name);
                        }
                    }
                    break;
                }
            }
        }

        // 如果 manifest 中没有分包信息，直接列出所有 .apk 文件
        if split_apks.is_empty() {
            split_apks = archive.file_names()
                .filter(|n| {
                    let lower = n.to_lowercase();
                    lower.ends_with(".apk") && !lower.contains("__MACOSX")
                })
                .map(|s| s.to_string())
                .collect();
        }

        // 智能过滤：只保留 base + 匹配设备 ABI 的分包 + 匹配设备 density 的分包
        if !split_apks.is_empty() && (device_abi.is_some() || device_density.is_some()) {
            let filtered = Self::filter_split_apks(&split_apks, device_abi, device_density);
            if !filtered.is_empty() {
                eprintln!("[split_apks] Filtered from {} to {} APKs", split_apks.len(), filtered.len());
                for apk in &filtered {
                    eprintln!("[split_apks]   + {}", apk);
                }
                return Ok(filtered);
            }
        }

        Ok(split_apks)
    }

    /// 根据设备 ABI 和 density 过滤分包
    fn filter_split_apks(
        apks: &[String],
        device_abi: Option<&str>,
        device_density: Option<&str>,
    ) -> Vec<String> {
        let mut result = Vec::new();

        // ABI 映射：文件名关键词 → ABI
        let abi_keywords = ["arm64_v8a", "armeabi_v7a", "x86_64", "x86"];

        // Density 映射：文件名关键词 → 典型 density 值
        let density_map = [
            ("ldpi", 120),
            ("mdpi", 160),
            ("hdpi", 240),
            ("tvdpi", 213),
            ("xhdpi", 320),
            ("xxhdpi", 480),
            ("xxxhdpi", 640),
        ];

        let device_abi_lower = device_abi.map(|a| a.to_lowercase());
        let device_density_num = device_density.and_then(|d| d.parse::<i32>().ok()).unwrap_or(160);

        // 分类所有 APK
        let mut base_apks: Vec<String> = Vec::new();
        let mut abi_apks: Vec<(String, bool)> = Vec::new(); // (name, is_match)
        let mut density_apks: Vec<(String, i32, i32)> = Vec::new(); // (name, apk_density, distance)
        let mut other_apks: Vec<String> = Vec::new();

        for apk in apks {
            let apk_lower = apk.to_lowercase();

            // 判断是否是 base APK
            if apk_lower.contains("base") || (!apk_lower.contains("config.") && !apk_lower.contains("split.")) {
                base_apks.push(apk.clone());
                continue;
            }

            // 判断是否是 ABI 分包
            let is_abi = abi_keywords.iter().any(|k| apk_lower.contains(k));
            if is_abi {
                let is_match = device_abi_lower.as_ref().map(|abi| {
                    abi_keywords.iter().any(|keyword| {
                        apk_lower.contains(keyword) && abi.contains(keyword)
                    })
                }).unwrap_or(false);
                abi_apks.push((apk.clone(), is_match));
                continue;
            }

            // 判断是否是 density 分包
            let density_match = density_map.iter().find(|(keyword, _)| apk_lower.contains(keyword));
            if density_match.is_some() {
                let (_, apk_density) = density_match.unwrap();
                let distance = (*apk_density as i32 - device_density_num).abs();
                density_apks.push((apk.clone(), *apk_density, distance));
                continue;
            }

            other_apks.push(apk.clone());
        }

        // 1. 始终包含 base APK
        result.extend(base_apks);

        // 2. 只包含匹配设备 ABI 的分包
        for (apk, is_match) in &abi_apks {
            if *is_match {
                result.push(apk.clone());
            }
        }

        // 3. 只包含最接近设备 density 的一个分包
        if !density_apks.is_empty() {
            density_apks.sort_by_key(|(_, _, distance)| *distance);
            result.push(density_apks[0].0.clone());
            eprintln!("[filter_split_apks] Selected density APK: {} (distance: {})", density_apks[0].0, density_apks[0].2);
        }

        // 4. 包含其他非 ABI/density 分包（如语言包等）
        result.extend(other_apks);

        result
    }

    /// 从 manifest 中读取包名
    fn read_package_from_manifest(archive: &mut zip::ZipArchive<std::fs::File>) -> AdbResult<String> {
        let manifest_names = ["manifest.json", "info.json", "meta.json"];
        for name in &manifest_names {
            if let Ok(mut entry) = archive.by_name(name) {
                let mut content = String::new();
                if entry.read_to_string(&mut content).is_ok() {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        if let Some(pkg) = json.get("package_name").or(json.get("packageName"))
                            .and_then(|v| v.as_str()) {
                            return Ok(pkg.to_string());
                        }
                    }
                }
            }
        }
        Ok(String::new())
    }

    /// 使用 adb install-multiple 安装多个分包
    pub async fn install_multiple_with_progress<F>(
        &self,
        serial: &str,
        apk_paths: &[String],
        mut progress_callback: F,
    ) -> AdbResult<String>
    where
        F: FnMut(u32, &str),
    {
        let mut args = vec!["-s".to_string(), serial.to_string(), "install-multiple".to_string()];
        for path in apk_paths {
            args.push(path.clone());
        }

        let mut cmd = tokio::process::Command::new(&self.adb_path);
        cmd.args(&args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        
        // 在 Windows 上设置 CREATE_NO_WINDOW 标志，防止 cmd 窗口弹出
        #[cfg(target_os = "windows")]
        { cmd.creation_flags(CREATE_NO_WINDOW); }
        
        let mut child = cmd.spawn()
            .map_err(|e| AdbError::ExecutionFailed(e.to_string()))?;

        use tokio::io::{AsyncBufReadExt, BufReader};

        // 读取 stderr
        let mut stderr_output = String::new();
        if let Some(stderr) = child.stderr.take() {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let line_trimmed = line.trim();
                eprintln!("[install_multiple] {}", line_trimmed);
                stderr_output.push_str(line_trimmed);
                stderr_output.push('\n');

                if let Some(pct_str) = line_trimmed.strip_suffix('%') {
                    let parts: Vec<&str> = pct_str.split(':').collect();
                    if let Some(last) = parts.last() {
                        if let Ok(pct) = last.trim().parse::<u32>() {
                            progress_callback(pct, line_trimmed);
                        }
                    }
                }
            }
        }

        let stdout_output = if let Some(stdout) = child.stdout.take() {
            let mut buf = String::new();
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                buf.push_str(&line);
                buf.push('\n');
            }
            buf
        } else {
            String::new()
        };

        let status = child.wait().await.map_err(|e| AdbError::ExecutionFailed(e.to_string()))?;

        if !status.success() {
            let error_detail = stderr_output.lines()
                .find(|l| l.contains("INSTALL_FAILED") || l.contains("Failure") || l.contains("Error"))
                .unwrap_or(&stderr_output)
                .trim();
            return Err(AdbError::ExecutionFailed(format!(
                "adb install-multiple failed: {}",
                error_detail
            )));
        }

        Ok(stdout_output.trim().to_string())
    }

    /// 卸载应用
    pub async fn uninstall(&self, serial: &str, package: &str) -> AdbResult<String> {
        let output = self.execute(&["-s", serial, "uninstall", package]).await?;
        Ok(output.trim().to_string())
    }

    /// 列出已安装的应用包
    pub async fn list_packages(&self, serial: &str) -> AdbResult<Vec<String>> {
        let output = self
            .execute(&["-s", serial, "shell", "pm", "list", "packages", "-3"])
            .await?;

        let packages: Vec<String> = output
            .lines()
            .filter_map(|line| line.strip_prefix("package:"))
            .map(|s| s.trim().to_string())
            .collect();
        Ok(packages)
    }

    /// 列出所有应用包（包括系统应用）
    pub async fn list_all_packages(&self, serial: &str) -> AdbResult<Vec<String>> {
        let output = self
            .execute(&["-s", serial, "shell", "pm", "list", "packages"])
            .await?;

        let packages: Vec<String> = output
            .lines()
            .filter_map(|line| line.strip_prefix("package:"))
            .map(|s| s.trim().to_string())
            .collect();
        Ok(packages)
    }

    /// 获取设备基本属性（轻量版，只获取 getprop 值，1个 ADB 命令）
    pub async fn get_device_props(&self, serial: &str) -> AdbResult<AdbDevice> {
        let mut device = AdbDevice::default();
        device.serial = serial.to_string();

        // 用唯一标记分隔，避免与 getprop 输出内容冲突
        let cmd = "echo '===PROP1==='; getprop ro.product.model; echo '===PROP2==='; getprop ro.product.brand; echo '===PROP3==='; getprop ro.build.version.release; echo '===PROP4==='; getprop ro.build.version.sdk; echo '===PROP5==='; getprop ro.build.characteristics";
        eprintln!("[get_device_props] Executing...");
        let output = self.execute(&["-s", serial, "shell", cmd]).await
            .map_err(|e| {
                eprintln!("[get_device_props] Failed: {}", e);
                e
            })?;

        // 去掉 \r 避免 Windows 换行符干扰
        let output = output.replace("\r", "");
        eprintln!("[get_device_props] Output ({} chars): {}", output.len(), &output[..output.len().min(300)]);

        let parts: Vec<&str> = output.split("===PROP").collect();
        eprintln!("[get_device_props] Split into {} parts", parts.len());
        for (i, p) in parts.iter().enumerate() {
            eprintln!("[get_device_props]   part[{}] = '{}'", i, &p[..p.len().min(50)]);
        }

        // part[0] 是空的（===PROP1=== 之前），part[1] 以 "1===\n" 开头
        // 格式: part[1] = "1===\nF1A600\n", part[2] = "2===\nBOE\n", ...
        for (i, p) in parts.iter().enumerate().skip(1) {
            // 去掉 "N===\n" 前缀，取第一行
            let value = p.trim_start();
            // 跳过数字和 === 前缀
            let value = value.trim_start_matches(|c: char| c.is_ascii_digit() || c == '=');
            let value = value.trim();
            let value = value.lines().next().unwrap_or("").trim();

            match i {
                1 => device.model = value.to_string(),
                2 => device.brand = value.to_string(),
                3 => device.android_version = value.to_string(),
                4 => device.sdk_version = value.to_string(),
                5 => {
                    if value.contains("phone") { device.device_type = "phone".to_string(); }
                    else if value.contains("tablet") { device.device_type = "tablet".to_string(); }
                    else if value.contains("tv") { device.device_type = "tv".to_string(); }
                    else if value.contains("watch") { device.device_type = "watch".to_string(); }
                    else if !value.is_empty() { device.device_type = value.to_string(); }
                }
                _ => {}
            }
        }

        eprintln!("[get_device_props] Done: model='{}', brand='{}', android='{}', sdk='{}', type='{}'",
            device.model, device.brand, device.android_version, device.sdk_version, device.device_type);

        Ok(device)
    }

    /// 获取设备详细信息（合并为 2 个 ADB 命令，避免设备 offline）
    pub async fn get_device_info(&self, serial: &str) -> AdbResult<AdbDevice> {
        let mut device = AdbDevice::default();
        device.serial = serial.to_string();

        // 命令1：所有 getprop 值（用唯一标记分隔）
        // 注意：不使用 shell_command，因为它会检测到 & 并用 sh -c 包装
        // 直接用 execute 传多个 shell 参数
        let props_cmd = "echo '===M1==='; getprop ro.product.model; echo '===M2==='; getprop ro.product.brand; echo '===M3==='; getprop ro.build.version.release; echo '===M4==='; getprop ro.build.version.sdk; echo '===M5==='; getprop ro.build.characteristics";
        eprintln!("[get_device_info] Executing props_cmd...");
        let props_output = self.execute(&["-s", serial, "shell", props_cmd]).await
            .map_err(|e| {
                eprintln!("[get_device_info] props_cmd failed: {}", e);
                e
            })?;
        eprintln!("[get_device_info] props_output length: {} chars", props_output.len());
        eprintln!("[get_device_info] props_output first 500 chars:\n{}", &props_output[..props_output.len().min(500)]);

        // 命令2：系统信息（cpuinfo/meminfo/df/wm/battery）
        let sys_cmd = "echo '===S1==='; cat /proc/cpuinfo; echo '===S2==='; cat /proc/meminfo; echo '===S3==='; df /data; echo '===S4==='; wm size; echo '===S5==='; dumpsys battery";
        eprintln!("[get_device_info] Executing sys_cmd...");
        let sys_output = self.execute(&["-s", serial, "shell", sys_cmd]).await
            .map_err(|e| {
                eprintln!("[get_device_info] sys_cmd failed: {}", e);
                e
            })?;
        eprintln!("[get_device_info] sys_output length: {} chars", sys_output.len());

        // 解析 getprop 值
        let props: Vec<&str> = props_output.split("===M").collect();
        eprintln!("[get_device_info] props split into {} parts", props.len());
        for (i, p) in props.iter().enumerate() {
            eprintln!("[get_device_info]   props[{}] = '{}'", i, &p[..p.len().min(100)]);
        }

        if props.len() > 1 { device.model = props[1].trim().lines().next().unwrap_or("").trim().to_string(); }
        if props.len() > 2 { device.brand = props[2].trim().lines().next().unwrap_or("").trim().to_string(); }
        if props.len() > 3 { device.android_version = props[3].trim().lines().next().unwrap_or("").trim().to_string(); }
        if props.len() > 4 { device.sdk_version = props[4].trim().lines().next().unwrap_or("").trim().to_string(); }
        if props.len() > 5 {
            let dt = props[5].trim().lines().next().unwrap_or("").trim();
            if dt.contains("phone") { device.device_type = "phone".to_string(); }
            else if dt.contains("tablet") { device.device_type = "tablet".to_string(); }
            else if dt.contains("tv") { device.device_type = "tv".to_string(); }
            else if dt.contains("watch") { device.device_type = "watch".to_string(); }
            else { device.device_type = "other".to_string(); }
        }

        eprintln!("[get_device_info] Parsed props: model='{}', brand='{}', android='{}', sdk='{}', type='{}'",
            device.model, device.brand, device.android_version, device.sdk_version, device.device_type);

        // 解析系统信息
        let sys_parts: Vec<&str> = sys_output.split("===S").collect();
        eprintln!("[get_device_info] sys split into {} parts", sys_parts.len());
        for (i, p) in sys_parts.iter().enumerate() {
            eprintln!("[get_device_info]   sys[{}] = {} chars, first 100: '{}'", i, p.len(), &p[..p.len().min(100)]);
        }

        // CPU info (section 1)
        if sys_parts.len() > 1 {
            let cpu_text = sys_parts[1];
            let mut cpu_models = std::collections::HashSet::new();
            for line in cpu_text.lines() {
                if line.starts_with("Hardware") || line.starts_with("model name") {
                    if let Some(model) = line.split(':').nth(1) {
                        cpu_models.insert(model.trim().to_string());
                    }
                }
            }
            device.cpu_info = cpu_models.into_iter().collect::<Vec<_>>().join(", ");
            if device.cpu_info.is_empty() {
                let core_count = cpu_text.lines().filter(|l| l.starts_with("processor")).count();
                if core_count > 0 {
                    device.cpu_info = format!("{} cores", core_count);
                }
            }
            eprintln!("[get_device_info] CPU info: '{}'", device.cpu_info);
        }

        // Memory info (section 2)
        if sys_parts.len() > 2 {
            let (total, _, _) = crate::utils::parse_memory_info(sys_parts[2]);
            device.total_memory = crate::utils::format_file_size(total);
            eprintln!("[get_device_info] Total memory: {} ({})", device.total_memory, total);
        }

        // Storage info (section 3)
        if sys_parts.len() > 3 {
            for line in sys_parts[3].lines() {
                if line.contains("/data") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 4 {
                        device.total_storage = crate::utils::format_file_size(crate::utils::parse_size_string(parts[1]));
                        device.available_storage = crate::utils::format_file_size(crate::utils::parse_size_string(parts[3]));
                        eprintln!("[get_device_info] Storage: total={}, avail={}", device.total_storage, device.available_storage);
                    }
                    break;
                }
            }
        }

        // Screen resolution (section 4)
        if sys_parts.len() > 4 {
            for line in sys_parts[4].lines() {
                if line.contains("Physical size:") {
                    if let Some(res) = line.split(':').nth(1) {
                        device.screen_resolution = res.trim().to_string();
                        eprintln!("[get_device_info] Screen resolution: '{}'", device.screen_resolution);
                    }
                }
            }
        }

        // Battery info (section 5)
        if sys_parts.len() > 5 {
            for line in sys_parts[5].lines() {
                if line.contains("level:") {
                    if let Some(v) = line.split(':').nth(1) {
                        if let Ok(level) = v.trim().parse::<u8>() {
                            device.battery_level = Some(level);
                            eprintln!("[get_device_info] Battery level: {}%", level);
                        }
                    }
                }
            }
        }

        eprintln!("[get_device_info] Final device: serial={}, model={}, brand={}, android={}, battery={:?}",
            device.serial, device.model, device.brand, device.android_version, device.battery_level);

        Ok(device)
    }

    /// 启动应用
    pub async fn start_app(&self, serial: &str, package: &str, activity: &str) -> AdbResult<String> {
        let component = if activity.contains("/") {
            activity.to_string()
        } else {
            format!("{}/{}", package, activity)
        };
        let output = self
            .execute(&["-s", serial, "shell", "am", "start", "-n", &component])
            .await?;
        Ok(output.trim().to_string())
    }

    /// 启动应用（使用 monkey 方式，不需要 activity）
    pub async fn start_app_monkey(&self, serial: &str, package: &str) -> AdbResult<String> {
        let output = self
            .execute(&["-s", serial, "shell", "monkey", "-p", package, "-c", "android.intent.category.LAUNCHER", "1"])
            .await?;
        Ok(output.trim().to_string())
    }

    /// 停止应用
    pub async fn stop_app(&self, serial: &str, package: &str) -> AdbResult<String> {
        let output = self
            .execute(&["-s", serial, "shell", "am", "force-stop", package])
            .await?;
        Ok(output.trim().to_string())
    }

    /// 清除应用数据
    pub async fn clear_app_data(&self, serial: &str, package: &str) -> AdbResult<String> {
        let output = self
            .execute(&["-s", serial, "shell", "pm", "clear", package])
            .await?;
        Ok(output.trim().to_string())
    }

    /// 获取应用详细信息
    pub async fn get_app_info(&self, serial: &str, package: &str) -> AdbResult<AppInfo> {
        let mut app_info = AppInfo {
            package_name: package.to_string(),
            app_name: String::new(),
            version_name: String::new(),
            version_code: String::new(),
            icon_base64: None,
            install_time: String::new(),
            app_size: String::new(),
            is_system: false,
            uid: 0,
        };

        // 获取 dumpsys package 信息
        let dump_output = self
            .shell_command(
                serial,
                &format!("dumpsys package {}", package),
            )
            .await
            .unwrap_or_default();

        // 解析版本名
        for line in dump_output.lines() {
            if line.contains("versionName=") {
                if let Some(v) = line.split("versionName=").nth(1) {
                    app_info.version_name = v.split_whitespace().next().unwrap_or("").to_string();
                }
            }
            if line.contains("versionCode=") {
                if let Some(v) = line.split("versionCode=").nth(1) {
                    app_info.version_code = v.split_whitespace().next().unwrap_or("").to_string();
                }
            }
            if line.contains("userId=") || line.contains("User 0:") {
                if let Some(v) = line.split('=').nth(1).or_else(|| line.split(':').nth(1)) {
                    if let Ok(uid) = v.trim().parse::<u32>() {
                        app_info.uid = uid;
                    }
                }
            }
            if line.contains("flags=[") && line.contains("SYSTEM") {
                app_info.is_system = true;
            }
        }

        // 获取应用名称（通过 dumpsys package 中的 label）
        let label_output = self
            .shell_command(
                serial,
                &format!("dumpsys package {} | grep -A1 'Application Label'", package),
            )
            .await
            .unwrap_or_default();
        for line in label_output.lines() {
            if !line.contains("Application Label") && !line.trim().is_empty() {
                app_info.app_name = line.trim().to_string();
                break;
            }
        }

        // 获取应用大小
        let size_output = self
            .shell_command(serial, &format!("du -s /data/data/{} 2>/dev/null || du -s /data/user/0/{} 2>/dev/null", package, package))
            .await
            .unwrap_or_default();
        for line in size_output.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if !parts.is_empty() {
                if let Ok(kb) = parts[0].parse::<u64>() {
                    app_info.app_size = crate::utils::format_file_size(kb * 1024);
                }
                break;
            }
        }

        // 获取首次安装时间
        let time_output = self
            .shell_command(
                serial,
                &format!("dumpsys package {} | grep 'firstInstallTime'", package),
            )
            .await
            .unwrap_or_default();
        for line in time_output.lines() {
            if line.contains("firstInstallTime") {
                if let Some(t) = line.split('=').nth(1) {
                    app_info.install_time = t.trim().to_string();
                }
                break;
            }
        }

        // 尝试获取图标 (base64)
        let icon_output = self
            .shell_command(
                serial,
                &format!(
                    "dumpsys package {} | grep -A2 'iconRes'",
                    package
                ),
            )
            .await
            .unwrap_or_default();
        app_info.icon_base64 = crate::utils::extract_base64_icon(&icon_output);

        Ok(app_info)
    }

    /// 截屏并返回 base64 编码的 PNG 图片
    /// 直接 shell 执行：screencap 写文件 + base64 读文件（覆盖写，不 rm）
    /// 不检查退出码，只要 stdout 有有效 PNG base64 数据就算成功
    pub async fn screenshot(&self, serial: &str) -> AdbResult<String> {
        let _permit = ADB_SEMAPHORE.acquire().await
            .map_err(|_| AdbError::ExecutionFailed("ADB 并发限制获取失败".to_string()))?;

        // 直接传给 shell，不用 sh -c（Android 9 兼容性更好）
        // 覆盖写，不 rm（减少失败点）
        let cmd = "screencap -p /data/local/tmp/sc.png; base64 /data/local/tmp/sc.png";
        let args = ["-s", serial, "shell", cmd];

        let cmd_str = args.join(" ");
        eprintln!("[adb] +{} | {}", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str);

        let start = std::time::Instant::now();
        let mut cmd = Command::new(&self.adb_path);
        cmd.args(args);
        
        // 在 Windows 上设置 CREATE_NO_WINDOW 标志，防止 cmd 窗口弹出
        #[cfg(target_os = "windows")]
        { cmd.creation_flags(CREATE_NO_WINDOW); }
        
        let output = cmd.output()
            .await
            .map_err(|e| {
                eprintln!("[adb] -{} | {} FAILED after {}ms", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str, start.elapsed().as_millis());
                AdbError::ExecutionFailed(format!("截图失败: {}", e))
            })?;

        let elapsed = start.elapsed().as_millis();

        // 不检查退出码！只要 stdout 有有效 PNG base64 数据就算成功
        let stdout = String::from_utf8_lossy(&output.stdout);
        let b64 = stdout.replace("\r", "").replace("\n", "");

        if b64.len() > 100 && b64.starts_with("iVBOR") {
            eprintln!("[screenshot] base64 {} chars ({}ms)", b64.len(), elapsed);
            Ok(b64)
        } else if !b64.is_empty() && b64.len() > 100 {
            eprintln!("[screenshot] base64 {} chars ({}ms, non-PNG header)", b64.len(), elapsed);
            Ok(b64)
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("[adb] -{} | {} ERROR ({}ms): {}", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str, elapsed, stderr.trim());
            Err(AdbError::ExecutionFailed("截图返回无效数据".to_string()))
        }
    }

    /// 快速截图（PNG 格式，通过 adb pull 传输）
    /// 注意：此方法用 3 个 ADB 命令，不如 screenshot() 稳定
    /// 仅用于 screen stream（需要二进制数据做 PNG 尺寸解析）
    pub async fn screenshot_fast(&self, serial: &str) -> AdbResult<Vec<u8>> {
        let _permit = ADB_SEMAPHORE.acquire().await
            .map_err(|_| AdbError::ExecutionFailed("ADB 并发限制获取失败".to_string()))?;

        let remote_file = "/data/local/tmp/sc.png";
        let local_dir = std::env::temp_dir().join("phone-toolbox");
        let local_file = local_dir.join("sc.png");

        // 确保本地目录存在
        let _ = std::fs::create_dir_all(&local_dir);

        // 步骤1：设备端截图
        let mut cmd = Command::new(&self.adb_path);
        cmd.args(["-s", serial, "shell", "screencap", "-p", remote_file]);
        
        // 在 Windows 上设置 CREATE_NO_WINDOW 标志，防止 cmd 窗口弹出
        #[cfg(target_os = "windows")]
        { cmd.creation_flags(CREATE_NO_WINDOW); }
        
        let output = cmd.output()
            .await
            .map_err(|e| AdbError::ExecutionFailed(format!("截图失败: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("[screenshot_fast] screencap failed: {}", stderr.trim());
            return Err(AdbError::ExecutionFailed(format!("截图失败: {}", stderr.trim())));
        }

        // 步骤2：adb pull 到本地
        let mut cmd = Command::new(&self.adb_path);
        cmd.args(["-s", serial, "pull", remote_file, local_file.to_str().unwrap_or("/tmp/sc.png")]);
        
        // 在 Windows 上设置 CREATE_NO_WINDOW 标志，防止 cmd 窗口弹出
        #[cfg(target_os = "windows")]
        { cmd.creation_flags(CREATE_NO_WINDOW); }
        
        let pull_output = cmd.output()
            .await
            .map_err(|e| AdbError::ExecutionFailed(format!("pull 失败: {}", e)))?;

        if !pull_output.status.success() {
            let stderr = String::from_utf8_lossy(&pull_output.stderr);
            eprintln!("[screenshot_fast] pull failed: {}", stderr.trim());
            return Err(AdbError::ExecutionFailed(format!("pull 失败: {}", stderr.trim())));
        }

        // 步骤3：读取本地文件
        let data = std::fs::read(&local_file)
            .map_err(|e| AdbError::ExecutionFailed(format!("读取本地文件失败: {}", e)))?;

        // 清理设备端文件
        let mut cmd = Command::new(&self.adb_path);
        cmd.args(["-s", serial, "shell", "rm", "-f", remote_file]);
        
        // 在 Windows 上设置 CREATE_NO_WINDOW 标志，防止 cmd 窗口弹出
        #[cfg(target_os = "windows")]
        { cmd.creation_flags(CREATE_NO_WINDOW); }
        
        let _ = cmd.spawn();

        if data.is_empty() {
            return Err(AdbError::ExecutionFailed("截图返回空数据".to_string()));
        }

        // 检查 PNG 头
        if data.len() < 4 || &data[0..4] != &[0x89, 0x50, 0x4E, 0x47] {
            eprintln!("[screenshot_fast] Not PNG! {} bytes", data.len());
            return Err(AdbError::ExecutionFailed(format!("截图返回了非 PNG 数据 ({} bytes)", data.len())));
        }

        eprintln!("[screenshot_fast] {} bytes (valid PNG)", data.len());
        Ok(data)
    }

    /// 启动 screenrecord 录制到设备文件（后台），并启动 tail -f 实时读取
    /// 返回 tail 进程的句柄（stdout 输出 H264 数据）
    pub async fn stream_screenrecord(
        &self,
        serial: &str,
        bit_rate: u32,
        max_size: u32,
    ) -> AdbResult<tokio::process::Child> {
        let _permit = ADB_SEMAPHORE.acquire().await
            .map_err(|_| AdbError::ExecutionFailed("ADB 并发限制获取失败".to_string()))?;

        let remote_file = "/data/local/tmp/screen_record.mp4";

        // 先清理旧文件并创建空文件（确保 tail 不会报 No such file）
        let _ = self.execute(&["-s", serial, "shell", "rm", "-f", remote_file]).await;
        let _ = self.execute(&["-s", serial, "shell", "touch", remote_file]).await;

        // 用 nohup 后台启动 screenrecord，确保 adb shell 退出后进程不被杀
        let rec_cmd = if max_size > 0 {
            format!("nohup screenrecord --output-format=h264 --bit-rate={} --max-size={} {} > /dev/null 2>&1 &", bit_rate, max_size, remote_file)
        } else {
            format!("nohup screenrecord --output-format=h264 --bit-rate={} {} > /dev/null 2>&1 &", bit_rate, remote_file)
        };

        eprintln!("[stream_screenrecord] Starting recorder: {}", rec_cmd);
        let mut cmd = Command::new(&self.adb_path);
        cmd.args(&["-s", serial, "shell", &rec_cmd])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        
        // 在 Windows 上设置 CREATE_NO_WINDOW 标志，防止 cmd 窗口弹出
        #[cfg(target_os = "windows")]
        { cmd.creation_flags(CREATE_NO_WINDOW); }
        
        let _ = cmd.spawn()
            .map_err(|e| AdbError::ExecutionFailed(format!("启动 screenrecord 失败: {}", e)))?;

        // 等待 screenrecord 启动并写入文件头（MP4 文件头约 32 bytes）
        eprintln!("[stream_screenrecord] Waiting for recorder to start...");
        for i in 1..=10 {
            tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
            // 检查文件是否有内容
            let check = self.execute(&["-s", serial, "shell", "wc", "-c", remote_file]).await;
            if let Ok(size_str) = check {
                let size: u64 = size_str.trim().parse().unwrap_or(0);
                if size > 0 {
                    eprintln!("[stream_screenrecord] File ready after {}ms ({} bytes)", i * 300, size);
                    break;
                }
            }
        }

        // 用 tail -f 实时读取文件内容
        let tail_cmd = format!("tail -c +0 -f {}", remote_file);
        eprintln!("[stream_screenrecord] Starting tail: {}", tail_cmd);
        let mut cmd = Command::new(&self.adb_path);
        cmd.args(&["-s", serial, "exec-out", &tail_cmd])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        
        // 在 Windows 上设置 CREATE_NO_WINDOW 标志，防止 cmd 窗口弹出
        #[cfg(target_os = "windows")]
        { cmd.creation_flags(CREATE_NO_WINDOW); }
        
        let child = cmd.spawn()
            .map_err(|e| AdbError::ExecutionFailed(format!("启动 tail 失败: {}", e)))?;

        eprintln!("[stream_screenrecord] Process spawned");
        Ok(child)
    }

    /// 从设备拉取文件
    pub async fn pull_file(&self, serial: &str, remote_path: &str, local_path: &str) -> AdbResult<String> {
        let output = self
            .execute(&["-s", serial, "pull", remote_path, local_path])
            .await?;
        Ok(output.trim().to_string())
    }

    /// 推送文件到设备
    pub async fn push_file(&self, serial: &str, local_path: &str, remote_path: &str) -> AdbResult<String> {
        let output = self
            .execute(&["-s", serial, "push", local_path, remote_path])
            .await?;
        Ok(output.trim().to_string())
    }

    /// 执行 Shell 命令
    /// 对于包含管道、重定向等特殊字符的命令，使用 sh -c 包装
    pub async fn shell_command(&self, serial: &str, cmd: &str) -> AdbResult<String> {
        let _permit = ADB_SEMAPHORE.acquire().await
            .map_err(|_| AdbError::ExecutionFailed("ADB 并发限制获取失败".to_string()))?;

        // 如果命令包含管道、重定向等 shell 特殊字符，使用 sh -c 包装
        let args: Vec<&str> = if cmd.contains('|') || cmd.contains('>') || cmd.contains('<') || cmd.contains('&') || cmd.contains(';') {
            vec!["-s", serial, "shell", "sh", "-c", cmd]
        } else {
            vec!["-s", serial, "shell", cmd]
        };

        let mut cmd = Command::new(&self.adb_path);
        cmd.args(&args);
        
        // 在 Windows 上设置 CREATE_NO_WINDOW 标志，防止 cmd 窗口弹出
        #[cfg(target_os = "windows")]
        { cmd.creation_flags(CREATE_NO_WINDOW); }
        
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            cmd.output()
        ).await;

        match result {
            Ok(Ok(output)) => Ok(String::from_utf8_lossy(&output.stdout).to_string()),
            Ok(Err(e)) => Err(AdbError::ExecutionFailed(format!("shell 命令执行失败: {}", e))),
            Err(_) => Err(AdbError::ExecutionFailed("命令执行超时（30秒），可能是交互式命令，请使用非交互式参数（如 top -n 1）".into())),
        }
    }

    /// 终端 shell 命令（不走信号量，用户手动执行优先级最高）
    pub async fn shell_command_direct(&self, serial: &str, cmd: &str) -> AdbResult<String> {
        let args: Vec<&str> = if cmd.contains('|') || cmd.contains('>') || cmd.contains('<') || cmd.contains('&') || cmd.contains(';') {
            vec!["-s", serial, "shell", "sh", "-c", cmd]
        } else {
            vec!["-s", serial, "shell", cmd]
        };

        let result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            self.execute_fast(&args)
        ).await;

        match result {
            Ok(Ok(output)) => Ok(output),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(AdbError::ExecutionFailed("命令执行超时（30秒）".into())),
        }
    }

    /// 获取 logcat 日志
    pub async fn logcat(&self, serial: &str, lines: u32) -> AdbResult<String> {
        let lines_arg = format!("-t{}", lines);
        let output = self
            .execute(&["-s", serial, "logcat", "-d", &lines_arg])
            .await?;
        Ok(output)
    }

    /// 获取电池信息
    pub async fn get_battery_info(&self, serial: &str) -> AdbResult<BatteryInfo> {
        let output = self
            .shell_command(serial, "dumpsys battery")
            .await?;

        let mut info = BatteryInfo {
            level: 0,
            temperature: None,
            status: String::new(),
            health: String::new(),
            voltage: 0,
            technology: String::new(),
        };

        for line in output.lines() {
            let line = line.trim();
            if let Some(val) = line.strip_prefix("level:") {
                info.level = val.trim().parse().unwrap_or(0);
            } else if let Some(val) = line.strip_prefix("temperature:") {
                info.temperature = val.trim().parse::<f32>().ok().map(|t| t / 10.0);
            } else if let Some(val) = line.strip_prefix("status:") {
                info.status = val.trim().to_string();
            } else if let Some(val) = line.strip_prefix("health:") {
                info.health = val.trim().to_string();
            } else if let Some(val) = line.strip_prefix("voltage:") {
                info.voltage = val.trim().parse().unwrap_or(0);
            } else if let Some(val) = line.strip_prefix("technology:") {
                info.technology = val.trim().to_string();
            }
        }

        Ok(info)
    }

    /// 获取 CPU 使用率
    pub async fn get_cpu_usage(&self, serial: &str) -> AdbResult<f32> {
        // 直接从 /proc/stat 读取（可靠且快速，不依赖 top 命令）
        let stat_output = self
            .shell_command(serial, "cat /proc/stat")
            .await?;

        for line in stat_output.lines() {
            if line.starts_with("cpu ") {
                let values: Vec<u64> = line
                    .split_whitespace()
                    .skip(1)
                    .filter_map(|v| v.parse().ok())
                    .collect();

                if values.len() >= 4 {
                    let idle = values[3];
                    let total: u64 = values.iter().sum();
                    if total > 0 {
                        return Ok(((total - idle) as f32 / total as f32) * 100.0);
                    }
                }
                break;
            }
        }

        Ok(0.0)
    }

    /// 获取内存信息
    pub async fn get_memory_info(&self, serial: &str) -> AdbResult<(u64, u64, u64)> {
        let output = self
            .shell_command(serial, "cat /proc/meminfo")
            .await?;

        Ok(crate::utils::parse_memory_info(&output))
    }

    /// 获取存储信息（用户可用容量）
    /// 总大小 = /data 分区的 Size（向上取整到 16 的倍数 GB）
    /// 可用 = /data 分区的 Avail
    pub async fn get_storage_info(&self, serial: &str) -> AdbResult<(u64, u64)> {
        let output = self
            .shell_command(serial, "df -h /data 2>/dev/null || df -h /")
            .await?;

        for line in output.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("Filesystem") || trimmed.is_empty() {
                continue;
            }
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            if parts.len() >= 4 {
                let total = parse_df_size(parts[1]);
                let available = parse_df_size(parts[3]);
                if total > 0 {
                    return Ok((total, available));
                }
            }
        }

        Ok((0, 0))
    }

    /// 启用 WiFi ADB 调试
    pub async fn enable_wifi_adb(&self, serial: &str, port: u16) -> AdbResult<String> {
        // 先确保 TCP/IP 模式
        self.execute(&["-s", serial, "tcpip", &port.to_string()])
            .await?;

        // 获取设备 IP
        let ip_output = self
            .shell_command(
                serial,
                "ip addr show wlan0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1",
            )
            .await
            .unwrap_or_default();

        let ip = ip_output.trim().to_string();
        if ip.is_empty() {
            return Err(AdbError::ExecutionFailed(
                "无法获取设备 WiFi IP 地址，请确保设备已连接 WiFi".to_string(),
            ));
        }

        // 连接
        let addr = format!("{}:{}", ip, port);
        let output = self.execute(&["connect", &addr]).await?;
        Ok(output.trim().to_string())
    }

    /// 获取文件列表
    pub async fn get_file_list(&self, serial: &str, path: &str) -> AdbResult<Vec<FileInfo>> {
        let output = self
            .shell_command(serial, &format!("ls -la {}", path))
            .await?;

        let mut files = Vec::new();

        for line in output.lines().skip(1) {
            // 跳过 "total" 行
            if line.starts_with("total") || line.trim().is_empty() {
                continue;
            }

            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() < 6 {
                continue;
            }

            let permissions = parts[0].to_string();
            let is_directory = permissions.starts_with('d');
            let size = parts[4].parse::<u64>().unwrap_or(0);
            let name = parts[parts.len() - 1].to_string();
            let full_path = if path.ends_with('/') {
                format!("{}{}", path, name)
            } else {
                format!("{}/{}", path, name)
            };

            // 解析日期（简化处理）
            let last_modified = format!("{} {} {}", parts[5], parts[6], parts.get(7).unwrap_or(&""));

            files.push(FileInfo {
                name,
                path: full_path,
                is_directory,
                size: crate::utils::format_file_size(size),
                permissions,
                last_modified,
            });
        }

        Ok(files)
    }

    /// 从 xapk 归档中解压 base APK 并用 aapt 解析信息（用于提取 min_sdk 等）
    pub async fn extract_xapk_base_apk_info(&self, file_path: &str) -> AdbResult<ApkInfo> {
        let file = std::fs::File::open(file_path).map_err(|e| {
            AdbError::ExecutionFailed(format!("无法打开文件: {}", e))
        })?;

        let mut archive = zip::ZipArchive::new(file).map_err(|e| {
            AdbError::ExecutionFailed(format!("无法解析 ZIP: {}", e))
        })?;

        // 找到 base APK（不含 config. 或 split. 的第一个 .apk 文件）
        let base_apk_name = archive.file_names()
            .find(|n| {
                let lower = n.to_lowercase();
                lower.ends_with(".apk") && !lower.contains("config.") && !lower.contains("split.") && !lower.contains("__macosx")
            })
            .map(|s| s.to_string());

        let base_apk_name = match base_apk_name {
            Some(name) => name,
            None => return Err(AdbError::ExecutionFailed("归档中未找到 base APK".into())),
        };

        eprintln!("[extract_xapk_base] Found base APK: {}", base_apk_name);

        // 解压到临时文件
        let temp_dir = std::env::temp_dir().join(format!("xapk_base_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&temp_dir).ok();

        let temp_apk = temp_dir.join("base.apk");
        if let Ok(mut entry) = archive.by_name(&base_apk_name) {
            if let Ok(mut out_file) = std::fs::File::create(&temp_apk) {
                let mut buf = Vec::new();
                let _ = entry.read_to_end(&mut buf);
                let _ = out_file.write_all(&buf);
            }
        }

        // 用已有的 parse_apk_info_local 解析
        let result = self.parse_apk_info_local(temp_apk.to_str().unwrap_or("")).await;

        // 清理
        let _ = std::fs::remove_dir_all(&temp_dir);

        result
    }

    /// 解析 xapk/apks/apkm 归档文件信息（从 manifest.json 读取）
    pub fn parse_xapk_info_local(&self, file_path: &str) -> AdbResult<ApkInfo> {
        let metadata = std::fs::metadata(file_path).map_err(|e| {
            AdbError::ExecutionFailed(format!("无法读取文件: {}", e))
        })?;

        let file = std::fs::File::open(file_path).map_err(|e| {
            AdbError::ExecutionFailed(format!("无法打开文件: {}", e))
        })?;

        let mut archive = zip::ZipArchive::new(file).map_err(|e| {
            AdbError::ExecutionFailed(format!("无法解析 ZIP: {}", e))
        })?;

        // 读取 manifest.json
        let manifest_names = ["manifest.json", "info.json", "meta.json"];
        let mut manifest: Option<serde_json::Value> = None;

        for name in &manifest_names {
            if let Ok(mut entry) = archive.by_name(name) {
                let mut content = String::new();
                if entry.read_to_string(&mut content).is_ok() {
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                        manifest = Some(json);
                        eprintln!("[parse_xapk] Read manifest from {}", name);
                        break;
                    }
                }
            }
        }

        let mut apk_info = ApkInfo {
            package_name: String::new(),
            app_name: String::new(),
            version_name: String::new(),
            version_code: String::new(),
            permissions: Vec::new(),
            icon_base64: None,
            file_size: crate::utils::format_file_size(metadata.len()),
            min_sdk_version: None,
            target_sdk_version: None,
        };

        if let Some(manifest) = manifest {
            // 包名
            if let Some(pkg) = manifest.get("package_name").or(manifest.get("packageName"))
                .and_then(|v| v.as_str()) {
                apk_info.package_name = pkg.to_string();
            }

            // 应用名
            if let Some(name) = manifest.get("name").or(manifest.get("app_name"))
                .and_then(|v| v.as_str()) {
                apk_info.app_name = name.to_string();
            }

            // 版本
            if let Some(ver) = manifest.get("version_name").or(manifest.get("versionName"))
                .and_then(|v| v.as_str()) {
                apk_info.version_name = ver.to_string();
            }
            if let Some(vc) = manifest.get("version_code").or(manifest.get("versionCode"))
                .and_then(|v| v.as_str()) {
                apk_info.version_code = vc.to_string();
            }

            // min_sdk_version
            if let Some(min_sdk) = manifest.get("min_sdk_version").or(manifest.get("minSdkVersion")) {
                if let Some(v) = min_sdk.as_i64() {
                    apk_info.min_sdk_version = Some(v as i32);
                } else if let Some(v) = min_sdk.as_str().and_then(|s| s.parse::<i32>().ok()) {
                    apk_info.min_sdk_version = Some(v);
                }
            }

            // target_sdk_version
            if let Some(target_sdk) = manifest.get("target_sdk_version").or(manifest.get("targetSdkVersion")) {
                if let Some(v) = target_sdk.as_i64() {
                    apk_info.target_sdk_version = Some(v as i32);
                } else if let Some(v) = target_sdk.as_str().and_then(|s| s.parse::<i32>().ok()) {
                    apk_info.target_sdk_version = Some(v);
                }
            }

            // 分包数量
            let split_count = manifest.get("split_apks").or(manifest.get("apks"))
                .and_then(|v| v.as_array())
                .map(|a| a.len())
                .unwrap_or(0);

            if split_count > 0 {
                eprintln!("[parse_xapk] Found {} split APKs", split_count);
            }
        }

        // 如果 manifest 中没有应用名，尝试从文件名提取
        if apk_info.app_name.is_empty() {
            if let Some(file_name) = std::path::Path::new(file_path).file_stem() {
                let name = file_name.to_string_lossy().to_string();
                // 去掉版本号等后缀，如 "Duolingo_6.74.5_apkcombo.com" → "Duolingo"
                let clean_name = name.split('_').next().unwrap_or(&name);
                apk_info.app_name = clean_name.to_string();
            }
        }

        Ok(apk_info)
    }

    /// 解析本地 APK 文件信息
    pub async fn parse_apk_info_local(&self, file_path: &str) -> AdbResult<ApkInfo> {
        // 获取文件大小
        let metadata = tokio::fs::metadata(file_path).await.map_err(|e| {
            eprintln!("[parse_apk_info_local] Cannot read file '{}': {}", file_path, e);
            AdbError::ExecutionFailed(format!("无法读取文件: {}", e))
        })?;

        eprintln!("[parse_apk_info_local] File size: {} bytes", metadata.len());

        // 检查是否为 HarmonyOS 安装包（.hap）
        if Self::is_hap_file(file_path) {
            eprintln!("[parse_apk_info_local] Detected HAP file, parsing module.json...");
            return self.parse_hap_info_local(file_path, metadata.len());
        }

        let mut apk_info = ApkInfo {
            package_name: String::new(),
            app_name: String::new(),
            version_name: String::new(),
            version_code: String::new(),
            permissions: Vec::new(),
            icon_base64: None,
            file_size: crate::utils::format_file_size(metadata.len()),
            min_sdk_version: None,
            target_sdk_version: None,
        };

        // 优先尝试内置 tools 目录中的 aapt
        if let Some(builtin_aapt) = crate::utils::find_builtin_tool("aapt") {
            eprintln!("[parse_apk_info_local] Trying builtin aapt: {}", builtin_aapt);
            if let Ok(output) = Command::new(&builtin_aapt)
                .args(["dump", "badging", file_path])
                .output()
                .await
            {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    eprintln!("[parse_apk_info_local] builtin aapt success, stdout len: {}", stdout.len());
                    return self.parse_aapt_output(&stdout, metadata.len());
                }
            }
        }

        // 尝试使用 aapt 解析 APK
        eprintln!("[parse_apk_info_local] Trying aapt...");
        let aapt_output = Command::new("aapt")
            .args(["dump", "badging", file_path])
            .output()
            .await;

        if let Ok(output) = aapt_output {
            eprintln!("[parse_apk_info_local] aapt exit code: {:?}, stdout len: {}, stderr: '{}'", 
                output.status.code(), output.stdout.len(), 
                String::from_utf8_lossy(&output.stderr).trim());
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                eprintln!("[parse_apk_info_local] aapt output first line: '{}'", stdout.lines().next().unwrap_or(""));
                return self.parse_aapt_output(&stdout, metadata.len());
            }
        } else {
            eprintln!("[parse_apk_info_local] aapt not found or failed to execute");
        }

        // 尝试使用 aapt2
        eprintln!("[parse_apk_info_local] Trying aapt2...");
        let aapt2_output = Command::new("aapt2")
            .args(["dump", "badging", file_path])
            .output()
            .await;

        if let Ok(output) = aapt2_output {
            eprintln!("[parse_apk_info_local] aapt2 exit code: {:?}, stderr: '{}'", 
                output.status.code(), String::from_utf8_lossy(&output.stderr).trim());
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                return self.parse_aapt_output(&stdout, metadata.len());
            }
        } else {
            eprintln!("[parse_apk_info_local] aapt2 not found or failed to execute");
        }

        // 尝试使用 Android SDK build-tools 中的 aapt（Windows 常见路径）
        let sdk_aapt_paths = if cfg!(target_os = "windows") {
            vec![
                "%LOCALAPPDATA%\\Android\\Sdk\\build-tools\\30.0.3\\aapt.exe",
                "%LOCALAPPDATA%\\Android\\Sdk\\build-tools\\33.0.2\\aapt.exe",
                "%LOCALAPPDATA%\\Android\\Sdk\\build-tools\\34.0.0\\aapt.exe",
                "%ANDROID_HOME%\\build-tools\\30.0.3\\aapt.exe",
                "%ANDROID_HOME%\\build-tools\\33.0.2\\aapt.exe",
            ]
        } else {
            vec![
                "$HOME/Android/Sdk/build-tools/30.0.3/aapt",
                "$HOME/Android/Sdk/build-tools/33.0.2/aapt",
                "$HOME/Android/Sdk/build-tools/34.0.0/aapt",
                "$ANDROID_HOME/build-tools/30.0.3/aapt",
            ]
        };

        for aapt_path in &sdk_aapt_paths {
            // 手动展开环境变量 %VAR% (Windows) 或 $VAR (Unix)
            let mut expanded = aapt_path.to_string();
            if cfg!(target_os = "windows") {
                // 替换 %LOCALAPPDATA% 等
                while let Some(start) = expanded.find('%') {
                    if let Some(end) = expanded[start+1..].find('%') {
                        let var_name = &expanded[start+1..start+1+end];
                        if let Ok(val) = std::env::var(var_name) {
                            expanded = format!("{}{}{}", &expanded[..start], val, &expanded[start+1+end+1..]);
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }
            } else {
                // 替换 $HOME 等
                while let Some(start) = expanded.find('$') {
                    let rest = &expanded[start+1..];
                    let var_name: String = rest.chars().take_while(|c| c.is_ascii_uppercase() || *c == '_').collect();
                    if !var_name.is_empty() {
                        if let Ok(val) = std::env::var(&var_name) {
                            expanded = format!("{}{}{}", &expanded[..start], val, &expanded[start+1+var_name.len()..]);
                        } else {
                            break;
                        }
                    } else {
                        break;
                    }
                }
            }
            eprintln!("[parse_apk_info_local] Trying SDK aapt: {}", expanded);
            if let Ok(output) = Command::new(&expanded)
                .args(["dump", "badging", file_path])
                .output()
                .await
            {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    eprintln!("[parse_apk_info_local] SDK aapt success, stdout len: {}", stdout.len());
                    return self.parse_aapt_output(&stdout, metadata.len());
                }
            }
        }

        // 如果 aapt 不可用，尝试使用 unzip + strings 提取信息
        eprintln!("[parse_apk_info_local] Both aapt and aapt2 unavailable, trying unzip...");
        
        // 方法1: 用 unzip -p 提取 AndroidManifest.xml，用 strings 提取可读文本
        if let Ok(output) = Command::new("unzip")
            .args(["-p", file_path, "AndroidManifest.xml"])
            .output()
            .await
        {
            if output.status.success() {
                let raw = output.stdout;
                // 从二进制 XML 中提取 UTF-16LE 字符串
                let text = Self::extract_strings_from_binary_xml(&raw);
                eprintln!("[parse_apk_info_local] Extracted strings ({} chars)", text.len());
                
                // 提取包名 (格式: com.example.app)
                for part in text.split(|c: char| !c.is_alphanumeric() && c != '.' && c != '_') {
                    if part.contains('.') && part.matches('.').count() >= 2 {
                        let segments: Vec<&str> = part.split('.').collect();
                        if segments.iter().all(|s| !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '_')) {
                            if apk_info.package_name.is_empty() {
                                apk_info.package_name = part.to_string();
                            }
                        }
                    }
                }
                
                // 提取版本名 (通常在包名附近，格式如 1.0.0)
                // 用正则匹配版本号模式
                for part in text.split(|c: char| !c.is_ascii_digit() && c != '.') {
                    let parts: Vec<&str> = part.split('.').collect();
                    if parts.len() >= 2 && parts.len() <= 4 && parts.iter().all(|s| s.parse::<u32>().is_ok()) {
                        if apk_info.version_name.is_empty() {
                            apk_info.version_name = part.to_string();
                        }
                    }
                }
            }
        }

        // 方法2: 尝试 python 解析
        if apk_info.package_name.is_empty() {
            eprintln!("[parse_apk_info_local] Trying python fallback...");
            let script = r#"
import zipfile, struct, sys

def read_manifest_strings(apk_path):
    try:
        z = zipfile.ZipFile(apk_path)
        data = z.read('AndroidManifest.xml')
        # Binary XML: extract string pool
        strings = []
        i = 0
        while i < len(data) - 4:
            chunk_type = struct.unpack_from('<H', data, i)[0]
            chunk_size = struct.unpack_from('<H', data, i + 2)[0]
            if chunk_type == 0x0001:  # RES_STRING_POOL_TYPE
                string_count = struct.unpack_from('<I', data, i + 8)[0]
                style_offset = struct.unpack_from('<I', data, i + 12)[0]
                flags = struct.unpack_from('<I', data, i + 16)[0]
                is_utf8 = (flags & (1 << 8)) != 0
                strings_offset = struct.unpack_from('<I', data, i + 20)[0]
                offsets_start = i + 28
                for j in range(min(string_count, 500)):
                    offset_pos = offsets_start + j * 4
                    if offset_pos + 4 > len(data):
                        break
                    str_offset = struct.unpack_from('<I', data, offset_pos)[0]
                    abs_pos = i + strings_offset + str_offset
                    if abs_pos >= len(data):
                        continue
                    if is_utf8:
                        # UTF-8: first 2 bytes are char count (can be >1 byte), then 1 byte flags, then string
                        str_len = data[abs_pos]
                        if str_len == 0 or str_len > 255:
                            continue
                        abs_pos += 1
                        if abs_pos + str_len > len(data):
                            continue
                        s = data[abs_pos:abs_pos+str_len].decode('utf-8', errors='ignore')
                    else:
                        # UTF-16
                        str_len = struct.unpack_from('<H', data, abs_pos)[0]
                        abs_pos += 2
                        if str_len == 0 or str_len > 1000:
                            continue
                        if abs_pos + str_len * 2 > len(data):
                            continue
                        s = data[abs_pos:abs_pos+str_len*2].decode('utf-16-le', errors='ignore')
                    if s and len(s) > 1 and any(c.isalpha() for c in s):
                        strings.append(s)
                break
            i += 4
        return strings
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return []

strings = read_manifest_strings(sys.argv[1])
for s in strings:
    print(s)
"#;
            if let Ok(output) = Command::new("python3")
                .args(["-c", script, file_path])
                .output()
                .await
            {
                if output.status.success() {
                    let text = String::from_utf8_lossy(&output.stdout);
                    for part in text.split(|c: char| !c.is_alphanumeric() && c != '.' && c != '_') {
                        if part.contains('.') && part.matches('.').count() >= 2 {
                            let segments: Vec<&str> = part.split('.').collect();
                            if segments.iter().all(|s| !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '_')) {
                                if apk_info.package_name.is_empty() {
                                    apk_info.package_name = part.to_string();
                                }
                            }
                        }
                    }
                    for part in text.split(|c: char| !c.is_ascii_digit() && c != '.') {
                        let parts: Vec<&str> = part.split('.').collect();
                        if parts.len() >= 2 && parts.len() <= 4 && parts.iter().all(|s| s.parse::<u32>().is_ok()) {
                            if apk_info.version_name.is_empty() {
                                apk_info.version_name = part.to_string();
                            }
                        }
                    }
                }
            } else {
                // 尝试 python (Windows)
                if let Ok(output) = Command::new("python")
                    .args(["-c", script, file_path])
                    .output()
                    .await
                {
                    if output.status.success() {
                        let text = String::from_utf8_lossy(&output.stdout);
                        for part in text.split(|c: char| !c.is_alphanumeric() && c != '.' && c != '_') {
                            if part.contains('.') && part.matches('.').count() >= 2 {
                                let segments: Vec<&str> = part.split('.').collect();
                                if segments.iter().all(|s| !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '_')) {
                                    if apk_info.package_name.is_empty() {
                                        apk_info.package_name = part.to_string();
                                    }
                                }
                            }
                        }
                        for part in text.split(|c: char| !c.is_ascii_digit() && c != '.') {
                            let parts: Vec<&str> = part.split('.').collect();
                            if parts.len() >= 2 && parts.len() <= 4 && parts.iter().all(|s| s.parse::<u32>().is_ok()) {
                                if apk_info.version_name.is_empty() {
                                    apk_info.version_name = part.to_string();
                                }
                            }
                        }
                    }
                }
            }
        }

        eprintln!("[parse_apk_info_local] Final: pkg={}, name={}, ver={}", 
            apk_info.package_name, apk_info.app_name, apk_info.version_name);
        Ok(apk_info)
    }

    /// 从二进制 XML 中提取可读字符串
    fn extract_strings_from_binary_xml(data: &[u8]) -> String {
        let mut result = String::new();
        let mut i = 0;
        while i < data.len() {
            // 尝试读取 UTF-16LE 字符串（Android Binary XML 使用 UTF-16）
            if i + 1 < data.len() {
                let b0 = data[i] as u16;
                let b1 = data[i + 1] as u16;
                let ch = b0 | (b1 << 8);
                if ch >= 0x20 && ch < 0x7F {
                    result.push(char::from_u32(ch as u32).unwrap_or('?'));
                } else if ch == 0 && result.ends_with(|c: char| c.is_ascii_alphanumeric()) {
                    // null terminator after a word
                    result.push(' ');
                }
            }
            i += 2;
        }
        result
    }

    fn parse_aapt_output(&self, output: &str, file_size: u64) -> AdbResult<ApkInfo> {
        let mut apk_info = ApkInfo {
            package_name: String::new(),
            app_name: String::new(),
            version_name: String::new(),
            version_code: String::new(),
            permissions: Vec::new(),
            icon_base64: None,
            file_size: crate::utils::format_file_size(file_size),
            min_sdk_version: None,
            target_sdk_version: None,
        };

        for line in output.lines() {
            // package: name='com.example' versionCode='1' versionName='1.0' minSdkVersion='29' targetSdkVersion='35'
            if line.starts_with("package:") {
                if let Some(name) = Self::extract_aapt_value(line, "name") {
                    apk_info.package_name = name;
                }
                if let Some(vc) = Self::extract_aapt_value(line, "versionCode") {
                    apk_info.version_code = vc;
                }
                if let Some(vn) = Self::extract_aapt_value(line, "versionName") {
                    apk_info.version_name = vn;
                }
                if let Some(min_sdk) = Self::extract_aapt_value(line, "minSdkVersion") {
                    apk_info.min_sdk_version = min_sdk.parse::<i32>().ok();
                }
                if let Some(target_sdk) = Self::extract_aapt_value(line, "targetSdkVersion") {
                    apk_info.target_sdk_version = target_sdk.parse::<i32>().ok();
                }
            }
            // 也可能单独一行: sdkVersion:'29' 或 targetSdkVersion:'35'
            if line.starts_with("sdkVersion:") {
                if let Some(v) = line.split(':').nth(1) {
                    apk_info.min_sdk_version = v.trim().trim_matches('\'').parse::<i32>().ok();
                }
            }
            if line.starts_with("targetSdkVersion:") {
                if let Some(v) = line.split(':').nth(1) {
                    apk_info.target_sdk_version = v.trim().trim_matches('\'').parse::<i32>().ok();
                }
            }
            // application-label:'App Name' 或 application-label-zh:'名称'
            if line.starts_with("application-label") {
                // 优先取无语言后缀的，或中文的
                if apk_info.app_name.is_empty() || line.contains("-zh") {
                    if let Some(label) = line.split(':').nth(1) {
                        apk_info.app_name = label.trim().trim_matches('\'').to_string();
                    }
                }
            }
            // uses-permission: name='android.permission.XXX'
            if line.starts_with("uses-permission:") {
                if let Some(perm) = Self::extract_aapt_value(line, "name") {
                    apk_info.permissions.push(perm);
                }
            }
            // uses-permission-sdk-23: name='android.permission.XXX'
            if line.starts_with("uses-permission-sdk-23:") {
                if let Some(perm) = Self::extract_aapt_value(line, "name") {
                    apk_info.permissions.push(perm);
                }
            }
            // application-icon-120:'res/drawable/icon.png'
            if line.starts_with("application-icon") && apk_info.icon_base64.is_none() {
                if let Some(_icon_path) = Self::extract_aapt_value(line, "") {
                    // 图标提取需要 aapt 的额外命令，这里先记录路径
                }
            }
        }

        Ok(apk_info)
    }

    fn extract_aapt_value(line: &str, key: &str) -> Option<String> {
        let pattern = format!("{}='", key);
        if let Some(start) = line.find(&pattern) {
            let rest = &line[start + pattern.len()..];
            if let Some(end) = rest.find('\'') {
                return Some(rest[..end].to_string());
            }
        }
        None
    }

    /// 解析本地 HAP 文件信息（从 module.json 读取）
    pub fn parse_hap_info_local(&self, file_path: &str, file_size: u64) -> AdbResult<ApkInfo> {
        let file = std::fs::File::open(file_path).map_err(|e| {
            AdbError::ExecutionFailed(format!("无法打开文件: {}", e))
        })?;

        let mut archive = zip::ZipArchive::new(file).map_err(|e| {
            AdbError::ExecutionFailed(format!("无法解析 ZIP: {}", e))
        })?;

        // 读取 module.json
        let mut module_json: Option<serde_json::Value> = None;

        if let Ok(mut entry) = archive.by_name("module.json") {
            let mut content = String::new();
            if entry.read_to_string(&mut content).is_ok() {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    module_json = Some(json);
                    eprintln!("[parse_hap] Read module.json successfully");
                }
            }
        }

        let mut apk_info = ApkInfo {
            package_name: String::new(),
            app_name: String::new(),
            version_name: String::new(),
            version_code: String::new(),
            permissions: Vec::new(),
            icon_base64: None,
            file_size: crate::utils::format_file_size(file_size),
            min_sdk_version: None,
            target_sdk_version: None,
        };

        if let Some(module) = module_json {
            // 从 app 部分提取信息
            if let Some(app) = module.get("app") {
                // 包名
                if let Some(pkg) = app.get("bundleName").and_then(|v| v.as_str()) {
                    apk_info.package_name = pkg.to_string();
                }

                // 应用名（label）
                if let Some(label) = app.get("label").and_then(|v| v.as_str()) {
                    // 处理 $string:app_name 格式
                    if label.starts_with("$string:") {
                        let string_name = label.strip_prefix("$string:").unwrap_or("app_name");
                        // 尝试从 resources/base/element/string.json 读取
                        if let Ok(mut entry) = archive.by_name("resources/base/element/string.json") {
                            let mut string_content = String::new();
                            if entry.read_to_string(&mut string_content).is_ok() {
                                if let Ok(string_json) = serde_json::from_str::<serde_json::Value>(&string_content) {
                                    if let Some(strings) = string_json.get("string") {
                                        if let Some(string_array) = strings.as_array() {
                                            for item in string_array {
                                                if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                                                    if name == string_name {
                                                        if let Some(value) = item.get("value").and_then(|v| v.as_str()) {
                                                            apk_info.app_name = value.to_string();
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        apk_info.app_name = label.to_string();
                    }
                }

                // 版本信息
                if let Some(ver) = app.get("versionName").and_then(|v| v.as_str()) {
                    apk_info.version_name = ver.to_string();
                }
                if let Some(vc) = app.get("versionCode").and_then(|v| v.as_i64()) {
                    apk_info.version_code = vc.to_string();
                }

                // 最小 SDK 版本
                if let Some(min_sdk) = app.get("compileSdkVersion").and_then(|v| v.as_i64()) {
                    apk_info.min_sdk_version = Some(min_sdk as i32);
                } else if let Some(min_sdk) = app.get("minAPIVersion").and_then(|v| v.as_i64()) {
                    apk_info.min_sdk_version = Some(min_sdk as i32);
                }

                // 目标 SDK 版本
                if let Some(target_sdk) = app.get("targetAPIVersion").and_then(|v| v.as_i64()) {
                    apk_info.target_sdk_version = Some(target_sdk as i32);
                }
            }

            // 从 module 部分提取信息
            if let Some(module_info) = module.get("module") {
                // 权限信息
                if let Some(permissions) = module_info.get("requestPermissions").and_then(|v| v.as_array()) {
                    for perm in permissions {
                        if let Some(name) = perm.get("name").and_then(|v| v.as_str()) {
                            apk_info.permissions.push(name.to_string());
                        }
                    }
                }
            }
        }

        // 如果没有应用名，尝试从文件名提取
        if apk_info.app_name.is_empty() {
            if let Some(file_name) = std::path::Path::new(file_path).file_stem() {
                let name = file_name.to_string_lossy().to_string();
                apk_info.app_name = name;
            }
        }

        eprintln!("[parse_hap] Final: pkg={}, name={}, ver={}, min_sdk={:?}", 
            apk_info.package_name, apk_info.app_name, apk_info.version_name, apk_info.min_sdk_version);
        Ok(apk_info)
    }

    /// 检查 ADB 是否可用
    pub async fn check_available(&self) -> bool {
        self.execute(&["version"]).await.is_ok()
    }

    /// 获取 ADB 版本
    pub async fn get_version(&self) -> AdbResult<String> {
        let output = self.execute(&["version"]).await?;
        // 从输出中提取版本号，格式：Android Debug Bridge version 1.0.41
        if let Some(version) = output.trim().lines().next() {
            if let Some(version_part) = version.split("version ").nth(1) {
                if let Some(actual_version) = version_part.split_whitespace().next() {
                    return Ok(actual_version.to_string());
                }
            }
        }
        Ok(output.trim().to_string())
    }

    /// 获取设备 IP 地址
    pub async fn get_device_ip(&self, serial: &str) -> AdbResult<String> {
        let output = self
            .shell_command(
                serial,
                "ip addr show wlan0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1",
            )
            .await?;

        let ip = output.trim().to_string();
        if ip.is_empty() {
            return Err(AdbError::ExecutionFailed(
                "无法获取设备 IP 地址".to_string(),
            ));
        }
        Ok(ip)
    }

    /// 获取网络统计信息
    pub async fn get_network_stats(&self, serial: &str) -> AdbResult<(u64, u64)> {
        let output = self
            .shell_command(serial, "cat /proc/net/dev | grep -E 'wlan0|eth0'")
            .await
            .unwrap_or_default();

        let mut rx_total = 0u64;
        let mut tx_total = 0u64;

        for line in output.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            // /proc/net/dev 格式: iface: rx_bytes rx_packets ... tx_bytes tx_packets ...
            if parts.len() >= 10 {
                if let Ok(rx) = parts[1].parse::<u64>() {
                    rx_total += rx;
                }
                if let Ok(tx) = parts[9].parse::<u64>() {
                    tx_total += tx;
                }
            }
        }

        Ok((rx_total, tx_total))
    }

    /// 获取 CPU 温度
    pub async fn get_cpu_temperature(&self, serial: &str) -> AdbResult<Option<f32>> {
        let output = self
            .shell_command(
                serial,
                "cat /sys/class/thermal/thermal_zone*/temp 2>/dev/null | head -1",
            )
            .await
            .unwrap_or_default();

        let temp_str = output.trim();
        if temp_str.is_empty() {
            return Ok(None);
        }

        // 温度通常以毫摄氏度为单位
        if let Ok(temp) = temp_str.parse::<f32>() {
            if temp > 1000.0 {
                Ok(Some(temp / 1000.0))
            } else {
                Ok(Some(temp))
            }
        } else {
            Ok(None)
        }
    }

    // ==================== Feature 1: 重启命令 ====================

    /// 重启设备
    pub async fn reboot(&self, serial: &str) -> AdbResult<String> {
        let output = self.execute(&["-s", serial, "reboot"]).await?;
        Ok(output.trim().to_string())
    }

    /// 重启到 Recovery 模式
    pub async fn reboot_recovery(&self, serial: &str) -> AdbResult<String> {
        let output = self.execute(&["-s", serial, "reboot", "recovery"]).await?;
        Ok(output.trim().to_string())
    }

    /// 重启到 Bootloader 模式
    pub async fn reboot_bootloader(&self, serial: &str) -> AdbResult<String> {
        let output = self.execute(&["-s", serial, "reboot", "bootloader"]).await?;
        Ok(output.trim().to_string())
    }

    /// 导出 bugreport 到指定文件
    /// `adb -s serial bugreport` 输出写入文件
    pub async fn bugreport(&self, serial: &str, output_path: &str) -> AdbResult<String> {
        let args = ["-s", serial, "bugreport"];
        let cmd_str = args.join(" ");
        eprintln!("[adb] +{} | {}", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str);

        let start = std::time::Instant::now();
        let mut cmd = tokio::process::Command::new(&self.adb_path);
        cmd.args(&args);
        
        // 在 Windows 上设置 CREATE_NO_WINDOW 标志，防止 cmd 窗口弹出
        #[cfg(target_os = "windows")]
        { cmd.creation_flags(CREATE_NO_WINDOW); }
        
        let output = cmd.output()
            .await
            .map_err(|e| {
                eprintln!("[adb] -{} | {} FAILED after {}ms", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str, start.elapsed().as_millis());
                if e.kind() == std::io::ErrorKind::NotFound {
                    AdbError::AdbNotFound
                } else {
                    AdbError::ExecutionFailed(format!("执行 adb bugreport 失败: {}", e))
                }
            })?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        // 写入文件
        tokio::fs::write(output_path, &stdout).await
            .map_err(|e| AdbError::ExecutionFailed(format!("写入文件失败 {}: {}", output_path, e)))?;

        eprintln!("[adb] -{} | {} OK ({}ms, {} bytes -> {})",
            chrono::Local::now().format("%H:%M:%S%.3f"),
            cmd_str, start.elapsed().as_millis(), stdout.len(), output_path);

        if !output.status.success() && !stderr.is_empty() {
            return Err(AdbError::ExecutionFailed(stderr));
        }

        Ok(format!("bugreport saved to {}", output_path))
    }

    /// 重置 ADB 服务（kill-server + start-server）
    pub async fn reset_adb(&self) -> AdbResult<String> {
        eprintln!("[reset_adb] Killing ADB server...");
        let _ = self.execute_fast(&["kill-server"]).await;
        eprintln!("[reset_adb] Starting ADB server...");
        let output = self.execute_fast(&["start-server"]).await?;
        eprintln!("[reset_adb] ADB server restarted: {}", output.trim());
        Ok(output.trim().to_string())
    }

    /// 停止 ADB 服务
    pub async fn kill_server(&self) -> AdbResult<String> {
        let output = self.execute_fast(&["kill-server"]).await?;
        Ok(output.trim().to_string())
    }

    /// 启动 ADB 服务
    pub async fn start_server(&self) -> AdbResult<String> {
        let output = self.execute(&["start-server"]).await?;
        Ok(output.trim().to_string())
    }

    // ==================== Feature 3: 帧率检测 ====================

    /// 获取 dumpsys gfxinfo 输出并解析帧率
    /// 如果 gfxinfo 无效，回退到 SurfaceFlinger --latency
    pub async fn get_gfxinfo(&self, serial: &str, package: &str) -> AdbResult<String> {
        let output = self
            .shell_command(serial, &format!("dumpsys gfxinfo {} reset", package))
            .await?;
        Ok(output)
    }

    /// 获取 SurfaceFlinger latency 数据用于计算帧率
    pub async fn get_surfaceflinger_latency(&self, serial: &str) -> AdbResult<String> {
        // 直接执行，不用 sh -c（避免引号转义问题）
        let output = self
            .execute(&["-s", serial, "shell", "dumpsys", "SurfaceFlinger", "--latency"])
            .await?;
        Ok(output)
    }

    /// 从 SurfaceFlinger --latency 输出解析帧率
    /// 输出格式：可能包含多个窗口的数据段，每段之间有空行分隔
    /// 每行三列纳秒时间戳（desired present, actual present, frame ready）
    /// 通过相邻两帧的 actual present 时间差计算帧间隔
    pub fn parse_fps_from_latency(latency: &str) -> Option<f32> {
        // 按空行分割成多个窗口的数据段
        let segments: Vec<&str> = latency.split("\n\n").collect();

        let mut best_fps: Option<f32> = None;

        for segment in segments {
            let mut timestamps: Vec<u64> = Vec::new();

            for line in segment.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                // 跳过标题行和无效行
                if parts.len() < 3 {
                    continue;
                }
                // 第二列是 actual present time
                if let Ok(t) = parts[1].parse::<u64>() {
                    // 跳过无效值（9223372036854775807 = i64::MAX）
                    if t < 9223372036854775807u64 {
                        timestamps.push(t);
                    }
                }
            }

            if timestamps.len() < 2 {
                continue;
            }

            // 取最近的帧计算平均帧间隔
            let recent = if timestamps.len() > 30 {
                &timestamps[timestamps.len() - 30..]
            } else {
                &timestamps[..]
            };

            let mut total_delta_ns: u64 = 0;
            let mut count = 0;
            for i in 1..recent.len() {
                let delta = recent[i].saturating_sub(recent[i - 1]);
                if delta > 0 && delta < 1_000_000_000u64 {
                    // 过滤异常值（>1秒的帧间隔视为掉帧/暂停）
                    total_delta_ns += delta;
                    count += 1;
                }
            }

            if count == 0 {
                continue;
            }

            let avg_delta_ns = total_delta_ns as f64 / count as f64;
            let fps = 1_000_000_000.0 / avg_delta_ns;

            if fps > 0.0 && fps < 500.0 {
                // 取帧数最多的窗口（最可能是前台应用）
                if best_fps.is_none() || timestamps.len() > 10 {
                    best_fps = Some(fps as f32);
                }
            }
        }

        best_fps
    }

    /// 从 gfxinfo 输出中解析帧率
    /// 正确方式：FPS = Total frames rendered / (当前时间 - Stats since)
    pub fn parse_fps_from_gfxinfo(gfxinfo: &str) -> Option<f32> {
        let mut total_frames: u64 = 0;
        let mut stats_since_ns: u64 = 0;
        let mut found_frames = false;
        let mut found_stats = false;

        for line in gfxinfo.lines() {
            // "Total frames rendered: 17625"
            if line.contains("Total frames rendered") {
                if let Some(val) = line.split(':').nth(1) {
                    if let Ok(frames) = val.trim().parse::<u64>() {
                        total_frames = frames;
                        found_frames = true;
                    }
                }
            }

            // "Stats since: 573121582148193ns"
            if line.contains("Stats since:") {
                if let Some(val) = line.split(':').nth(1) {
                    let val = val.trim();
                    // 去掉末尾的 "ns"
                    let val = val.trim_end_matches("ns").trim();
                    if let Ok(ns) = val.parse::<u64>() {
                        stats_since_ns = ns;
                        found_stats = true;
                    }
                }
            }
        }

        // 用 Total frames / 经过时间 计算 FPS
        if found_frames && found_stats && total_frames > 0 && stats_since_ns > 0 {
            // Android 的 Stats since 是系统启动后的纳秒时间
            // 但我们不知道系统启动时间，所以用两次采样之间的帧数差来算
            // 这里直接用 Total frames 作为当前采样周期的帧数（因为用了 reset）
            // reset 后 Stats since 会更新为 reset 时刻
            // 所以 total_frames 就是 reset 后渲染的总帧数

            // 由于我们每秒采样一次并 reset，total_frames 大致就是这一秒的帧数
            if total_frames > 0 && total_frames < 500 {
                return Some(total_frames as f32);
            }
        }

        // 回退：无有效数据
        None
    }

    // ==================== Feature 4: 增强设备信息 ====================

    /// 获取内存占用 Top 应用
    pub async fn get_top_memory_apps(&self, serial: &str) -> AdbResult<Vec<TopMemoryApp>> {
        // 使用 dumpsys meminfo 获取内存使用情况
        let output = self
            .shell_command(serial, "dumpsys meminfo")
            .await
            .unwrap_or_default();

        let mut apps: Vec<TopMemoryApp> = Vec::new();

        // 解析 "Total PSS by process:" 部分
        // 格式示例：
        // Total PSS by process:
        //    125,123K: com.example.app (pid 1234)
        //     45,678K: com.example.app2 (pid 5678)
        let mut in_pss_section = false;

        for line in output.lines() {
            let line = line.trim();

            if line.starts_with("Total PSS by process:") {
                in_pss_section = true;
                continue;
            }

            if in_pss_section {
                // 遇到空行或新 section 结束
                if line.is_empty() || line.contains("Total PSS by OOM adjustment:") {
                    break;
                }

                // 解析格式: "   125,123K: com.example.app (pid 1234)"
                if let Some(colon_pos) = line.find(':') {
                    let mem_part = line[..colon_pos].trim();
                    let pkg_part = line[colon_pos + 1..].trim();

                    // 提取包名（去掉 pid 部分）
                    let pkg = pkg_part.split('(').next().unwrap_or(pkg_part).trim();

                    // 跳过无效包名
                    if !pkg.starts_with("com.") && !pkg.starts_with("org.") && !pkg.starts_with("android.") && !pkg.contains('.') {
                        continue;
                    }

                    // 解析内存值（如 "125,123K"）
                    // 必须以 K 结尾
                    if !mem_part.ends_with('K') && !mem_part.ends_with('k') {
                        continue;
                    }
                    let mem_str = mem_part.replace(',', "").replace('K', "").replace('k', "");
                    if let Ok(mem_kb) = mem_str.parse::<u64>() {
                        // 验证合理性：单个应用内存应在 1MB ~ 4GB 之间
                        if mem_kb >= 1024 && mem_kb < 4 * 1024 * 1024 {
                            let bytes = mem_kb * 1024;
                            apps.push(TopMemoryApp {
                                package_name: pkg.to_string(),
                                memory_used: crate::utils::format_file_size(bytes),
                                memory_used_bytes: bytes,
                            });
                        }
                    }
                }
            }
        }

        // 按内存使用排序，取前 3
        apps.sort_by(|a, b| b.memory_used_bytes.cmp(&a.memory_used_bytes));
        apps.truncate(3);

        Ok(apps)
    }

    /// 获取 CPU 架构
    pub async fn get_cpu_architecture(&self, serial: &str) -> AdbResult<String> {
        let abi = self
            .shell_command(serial, "getprop ro.product.cpu.abi")
            .await
            .unwrap_or_default();

        let abi = abi.trim().to_string();

        // 如果 getprop 返回了有效的 ABI，直接使用
        if !abi.is_empty() && abi != "unknown" {
            // 获取 CPU 信息作为补充
            let cpuinfo = self
                .shell_command(serial, "cat /proc/cpuinfo")
                .await
                .unwrap_or_default();

            // 提取硬件信息
            let mut hardware = String::new();
            for line in cpuinfo.lines() {
                if line.starts_with("Hardware") {
                    if let Some(val) = line.split(':').nth(1) {
                        hardware = val.trim().to_string();
                    }
                    break;
                }
            }

            let processor_count = cpuinfo.lines()
                .filter(|l| l.starts_with("processor"))
                .count();

            if hardware.is_empty() {
                Ok(format!("{} ({} cores)", abi, processor_count))
            } else {
                Ok(format!("{} / {} ({} cores)", abi, hardware, processor_count))
            }
        } else {
            // Fallback: 从 /proc/cpuinfo 推断
            let cpuinfo = self
                .shell_command(serial, "cat /proc/cpuinfo")
                .await
                .unwrap_or_default();

            let mut arch = String::new();
            for line in cpuinfo.lines() {
                if line.starts_with("model name") || line.starts_with("Hardware") {
                    if let Some(val) = line.split(':').nth(1) {
                        arch = val.trim().to_string();
                    }
                    break;
                }
            }

            if arch.is_empty() {
                Ok("Unknown".to_string())
            } else {
                Ok(arch)
            }
        }
    }

    /// 获取设备屏幕密度
    pub async fn get_device_density(&self, serial: &str) -> AdbResult<String> {
        let output = self
            .execute(&["-s", serial, "shell", "wm density"])
            .await?;
        // 输出格式: "Physical density: 320" 或 "Override density: 320"
        for line in output.lines() {
            if let Some(density) = line.split(':').nth(1) {
                let density = density.trim().to_string();
                if !density.is_empty() {
                    return Ok(density);
                }
            }
        }
        Ok("160".to_string()) // 默认 mdpi
    }

    /// 获取屏幕分辨率
    pub async fn get_screen_resolution(&self, serial: &str) -> AdbResult<String> {
        let output = self
            .execute(&["-s", serial, "shell", "wm size"])
            .await?;
        // 去掉 \r 避免 Windows 换行符干扰匹配
        let output = output.replace("\r", "");
        eprintln!("[get_screen_resolution] output: '{}'", output.trim());
        for line in output.lines() {
            if line.contains("Physical size:") {
                if let Some(res) = line.split(':').nth(1) {
                    let res = res.trim().to_string();
                    eprintln!("[get_screen_resolution] parsed: '{}'", res);
                    return Ok(res);
                }
            }
            // 某些设备可能只有 Override size
            if line.contains("Override size:") {
                if let Some(res) = line.split(':').nth(1) {
                    let res = res.trim().to_string();
                    eprintln!("[get_screen_resolution] override: '{}'", res);
                    return Ok(res);
                }
            }
        }
        eprintln!("[get_screen_resolution] WARNING: no resolution found in output");
        Ok(String::new())
    }

    /// 恢复设备原分辨率
    pub async fn reset_screen_resolution(&self, serial: &str) -> AdbResult<String> {
        // 先获取物理分辨率
        let physical = self.get_physical_resolution(serial).await?;

        if physical.is_empty() {
            return Err(AdbError::ParseError("无法获取物理分辨率".into()));
        }

        // 用物理分辨率恢复
        let size_output = self
            .execute(&["-s", serial, "shell", &format!("wm size {}", physical)])
            .await?;

        // 同时重置 density
        let _ = self
            .execute(&["-s", serial, "shell", "wm density reset"])
            .await;

        Ok(size_output.trim().to_string())
    }

    /// 获取设备物理分辨率（Override 或 Physical size）
    async fn get_physical_resolution(&self, serial: &str) -> AdbResult<String> {
        let output = self
            .shell_command(serial, "wm size")
            .await
            .unwrap_or_default();

        // 优先取 Physical size
        for line in output.lines() {
            if line.contains("Physical size:") {
                if let Some(res) = line.split(':').nth(1) {
                    let res = res.trim().to_string();
                    if res.contains('x') {
                        return Ok(res);
                    }
                }
            }
        }

        // 回退：取 Override（当前生效的分辨率）
        for line in output.lines() {
            if line.contains("Override:") {
                if let Some(res) = line.split(':').nth(1) {
                    let res = res.trim().to_string();
                    if res.contains('x') && !res.starts_with('0') {
                        return Ok(res);
                    }
                }
            }
        }

        Ok(String::new())
    }

    /// 获取屏幕旋转方向（0=竖屏, 1=横屏左旋90°, 2=倒置, 3=横屏右旋270°）
    pub async fn get_screen_rotation(&self, serial: &str) -> AdbResult<u32> {
        // 使用 settings get system user_rotation 更轻量
        let output = self
            .execute(&["-s", serial, "shell", "settings get system user_rotation"])
            .await?;
        let val = output.trim();
        eprintln!("[get_screen_rotation] raw='{}'", val);
        if let Ok(rot) = val.parse::<u32>() {
            return Ok(rot);
        }
        Ok(0)
    }

    /// 设置屏幕分辨率和密度
    pub async fn set_screen_resolution(
        &self,
        serial: &str,
        width: u32,
        height: u32,
        density: u32,
    ) -> AdbResult<String> {
        let size = format!("{}x{}", width, height);
        eprintln!("[set_screen_resolution] Setting size={} density={}", size, density);

        let size_output = self
            .execute(&["-s", serial, "shell", "wm", "size", &size])
            .await?;
        eprintln!("[set_screen_resolution] Size result: {}", size_output.trim());

        let density_output = self
            .execute(&["-s", serial, "shell", "wm", "density", &density.to_string()])
            .await?;
        eprintln!("[set_screen_resolution] Density result: {}", density_output.trim());

        Ok(format!("Resolution set to {}x{}, density {}", width, height, density))
    }

    /// 获取当前前台应用
    pub async fn get_running_apps(&self, serial: &str) -> AdbResult<String> {
        // 方案1: dumpsys activity top（最快，通常 < 200ms）
        let output = self
            .shell_command(serial, "dumpsys activity top 2>/dev/null | head -5")
            .await
            .unwrap_or_default();

        for line in output.lines() {
            if line.contains("ACTIVITY") || line.contains("TASK") {
                if let Some(pkg) = Self::extract_package_from_activity_line(line) {
                    return Ok(pkg);
                }
            }
        }

        // 方案2: dumpsys activity activities（较慢）
        let output = self
            .shell_command(serial, "dumpsys activity activities 2>/dev/null | grep mResumedActivity")
            .await
            .unwrap_or_default();

        let trimmed = output.trim();
        if !trimmed.is_empty() {
            if let Some(pkg) = Self::extract_package_from_activity_line(trimmed) {
                return Ok(pkg);
            }
        }

        // 方案3: dumpsys window windows（最慢，最后手段）
        let output = self
            .shell_command(serial, "dumpsys window windows 2>/dev/null | grep mCurrentFocus")
            .await
            .unwrap_or_default();

        let trimmed = output.trim();
        if !trimmed.is_empty() {
            if let Some(pkg) = Self::extract_package_from_activity_line(trimmed) {
                return Ok(pkg);
            }
        }

        Ok(String::new())
    }

    /// 从 activity 记录行中提取包名
    fn extract_package_from_activity_line(line: &str) -> Option<String> {
        // 查找类似 "com.example.app/.MainActivity" 或 "com.example.app/com.example.app.MainActivity" 的模式
        // 先去掉前缀（如 "mResumedActivity=ActivityRecord{xxx u0 "）
        let rest = if let Some(eq_pos) = line.find('=') {
            &line[eq_pos + 1..]
        } else {
            line
        };

        // 去掉 ActivityRecord{...} 包装
        let rest = if let Some(brace_pos) = rest.find('}') {
            &rest[brace_pos + 1..]
        } else {
            rest
        };

        let rest = rest.trim();

        // 现在应该是 "u0 com.example.app/.MainActivity" 或 "com.example.app/.MainActivity"
        // 提取包名部分
        let parts: Vec<&str> = rest.split_whitespace().collect();
        for part in &parts {
            if part.contains('/') && part.matches('.').count() >= 2 {
                // 这是 component name，取 '/' 前面的部分作为包名
                if let Some(slash_pos) = part.find('/') {
                    let pkg = &part[..slash_pos];
                    if pkg.contains('.') && pkg.matches('.').count() >= 2 {
                        return Some(pkg.to_string());
                    }
                }
            }
        }

        None
    }

    // ==================== Feature 5: 设备控制 ====================

    /// 发送点击事件
    pub async fn send_tap(&self, serial: &str, x: u32, y: u32) -> AdbResult<String> {
        let output = self
            .execute(&["-s", serial, "shell", "input", "tap", &x.to_string(), &y.to_string()])
            .await?;
        Ok(output.trim().to_string())
    }

    /// 发送滑动事件
    pub async fn send_swipe(
        &self,
        serial: &str,
        x1: u32,
        y1: u32,
        x2: u32,
        y2: u32,
        duration_ms: u32,
    ) -> AdbResult<String> {
        eprintln!("[send_swipe] Swiping from ({}, {}) to ({}, {}) duration={}ms on device: {}", x1, y1, x2, y2, duration_ms, serial);
        let output = self
            .execute(&[
                "-s", serial, "shell", "input", "swipe",
                &x1.to_string(), &y1.to_string(),
                &x2.to_string(), &y2.to_string(),
                &duration_ms.to_string(),
            ])
            .await?;
        Ok(output.trim().to_string())
    }

    /// 发送按键事件
    pub async fn send_keyevent(&self, serial: &str, keycode: u32) -> AdbResult<String> {
        let output = self
            .execute(&["-s", serial, "shell", "input", "keyevent", &keycode.to_string()])
            .await?;
        Ok(output.trim().to_string())
    }

    /// 发送文本输入（通过剪贴板方式，支持中文和特殊字符）
    pub async fn send_text(&self, serial: &str, text: &str) -> AdbResult<String> {
        // input text 不支持中文和很多特殊字符
        // 改用剪贴板方式：写入剪贴板 → 模拟长按粘贴
        // 使用 service call clipboard 或 am broadcast
        let escaped = text.replace("'", "'\\''");
        eprintln!("[send_text] Sending text via clipboard: '{}' ({} chars)", &text[..text.len().min(50)], text.len());

        // 方案：用 am broadcast 设置剪贴板，然后 input keyevent 粘贴
        let set_clipboard = format!(
            "am broadcast -a clipper.set -e text '{}' --ez copy true",
            escaped
        );
        let _ = self.execute(&["-s", serial, "shell", &set_clipboard]).await;

        // 备用方案：直接用 service call 设置剪贴板（Android 9+）
        let set_clipboard2 = format!(
            "service call clipboard 2 i32 1 s '{}' i32 1",
            escaped
        );
        let result = self.execute(&["-s", serial, "shell", &set_clipboard2]).await;

        match result {
            Ok(_) => {
                // 粘贴：模拟 Ctrl+V (keyevent 279)
                let _ = self.execute(&["-s", serial, "shell", "input", "keyevent", "279"]).await;
                Ok("ok".to_string())
            }
            Err(_) => {
                // 如果 service call 也失败，回退到 input text（仅支持 ASCII）
                let encoded: String = text
                    .chars()
                    .filter(|c| c.is_ascii())
                    .map(|c| {
                        if c.is_alphanumeric() || c == '.' || c == ',' || c == '!' || c == '?' || c == '@' {
                            c.to_string()
                        } else if c == ' ' {
                            "%s".to_string()
                        } else {
                            format!("{:02X}", c as u32)
                        }
                    })
                    .collect();
                eprintln!("[send_text] Fallback to input text: '{}'", &encoded[..encoded.len().min(50)]);
                let output = self
                    .execute(&["-s", serial, "shell", "input", "text", &encoded])
                    .await?;
                Ok(output.trim().to_string())
            }
        }
    }

    /// 设置屏幕亮度
    pub async fn set_brightness(&self, serial: &str, level: u32) -> AdbResult<String> {
        let output = self
            .shell_command(serial, &format!("settings put system screen_brightness {}", level))
            .await?;
        Ok(output.trim().to_string())
    }

    /// 获取屏幕亮度
    pub async fn get_brightness(&self, serial: &str) -> AdbResult<String> {
        let output = self
            .shell_command(serial, "settings get system screen_brightness")
            .await?;
        Ok(output.trim().to_string())
    }

    /// 设置音量
    pub async fn set_volume(&self, serial: &str, level: u32, stream: &str) -> AdbResult<String> {
        let output = self
            .shell_command(serial, &format!("media volume --set {} --stream {}", level, stream))
            .await?;
        Ok(output.trim().to_string())
    }

    /// 获取音量
    pub async fn get_volume(&self, serial: &str, stream: &str) -> AdbResult<u32> {
        let output = self
            .shell_command(serial, &format!("settings get system volume_{}", stream))
            .await?;
        let vol = output.trim().parse::<u32>().unwrap_or(0);
        Ok(vol)
    }

    /// 获取 WiFi 状态
    pub async fn get_wifi_state(&self, serial: &str) -> AdbResult<String> {
        let output = self
            .shell_command(serial, "settings get global wifi_on")
            .await?;
        Ok(output.trim().to_string())
    }

    /// 设置 WiFi 状态
    pub async fn set_wifi_state(&self, serial: &str, enabled: bool) -> AdbResult<String> {
        let action = if enabled { "enable" } else { "disable" };
        let output = self
            .shell_command(serial, &format!("svc wifi {}", action))
            .await?;
        Ok(output.trim().to_string())
    }

    /// 获取飞行模式状态
    pub async fn get_airplane_mode(&self, serial: &str) -> AdbResult<bool> {
        let output = self
            .shell_command(serial, "settings get global airplane_mode_on")
            .await?;
        Ok(output.trim() == "1")
    }

    /// 设置飞行模式
    pub async fn set_airplane_mode(&self, serial: &str, enabled: bool) -> AdbResult<String> {
        let value = if enabled { "1" } else { "0" };
        let output = self
            .shell_command(serial, &format!("settings put global airplane_mode_on {}", value))
            .await?;

        // 广播飞行模式变更
        let _ = self
            .shell_command(serial, "am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true")
            .await;

        Ok(output.trim().to_string())
    }
}

/// 电池信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatteryInfo {
    pub level: u8,
    pub temperature: Option<f32>,
    pub status: String,
    pub health: String,
    pub voltage: u32,
    pub technology: String,
}

/// FPS 记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FpsRecord {
    pub timestamp: f64,  // 毫秒，从监控开始算起
    pub fps: f32,
    #[serde(default)]
    pub foreground_app: String,  // 采样时的前台应用包名
}

/// 内存占用 Top 应用
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopMemoryApp {
    pub package_name: String,
    pub memory_used: String,
    pub memory_used_bytes: u64,
}
