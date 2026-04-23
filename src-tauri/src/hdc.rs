use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::process::Command;
use tokio::sync::Semaphore;
use std::sync::LazyLock;
use std::collections::HashMap;
use tokio::sync::Mutex;

/// 全局 HDC 命令并发限制（严格串行，同一时间只允许 1 个 HDC 命令执行）
/// 这是核心机制：确保上一条 HDC 命令完全结束后才执行下一条，防止设备 offline
static HDC_SEMAPHORE: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(1));

/// get_device_info 结果缓存（serial -> (result_json, timestamp)）
/// 5 秒内同一设备不重复获取
static DEVICE_INFO_CACHE: LazyLock<Mutex<HashMap<String, (String, std::time::Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// get_device_info 调用级别的去重锁（同一 serial 同时只允许一个调用执行）
static DEVICE_INFO_LOCK: LazyLock<Mutex<HashMap<String, ()>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// HDC 错误类型
#[derive(Debug, Error)]
pub enum HdcError {
    #[error("HDC 命令执行失败: {0}")]
    ExecutionFailed(String),

    #[error("设备未找到: {0}")]
    DeviceNotFound(String),

    #[error("解析输出失败: {0}")]
    ParseError(String),

    #[error("HDC 未安装或不在 PATH 中")]
    HdcNotFound,

    #[error("设备无响应: {0}")]
    DeviceUnresponsive(String),

    #[error("超时: {0}")]
    Timeout(String),

    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
}

pub type HdcResult<T> = Result<T, HdcError>;

/// HDC 设备信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HdcDevice {
    pub serial: String,
    pub status: String,
    pub model: String,
    pub brand: String,
    pub market_name: String,        // Brand + MarketName，如 "HUAWEI nova 14 Ultra"
    pub android_version: String,    // OSFullName，如 "OpenHarmony-6.0.0.328"
    pub sdk_version: String,        // SDKAPIVersion
    pub security_patch: String,     // 安全补丁，如 "2026/03/01"
    pub kernel_version: String,     // Hongmeng version，如 "HongMeng Kernel 1.12.0"
    pub incremental_version: String,// IncrementalVersion
    pub abi_list: String,           // ABIList，如 "arm64-v8a"
    pub battery_level: Option<u8>,
    pub screen_resolution: String,
    pub max_refresh_rate: Option<u32>,
    pub cpu_info: String,
    pub total_memory: String,
    pub available_storage: String,
    pub total_storage: String,
    pub device_type: String,
    pub platform: String,
}

impl Default for HdcDevice {
    fn default() -> Self {
        Self {
            serial: String::new(),
            status: String::new(),
            model: String::new(),
            brand: String::new(),
            market_name: String::new(),
            android_version: String::new(),
            sdk_version: String::new(),
            security_patch: String::new(),
            kernel_version: String::new(),
            incremental_version: String::new(),
            abi_list: String::new(),
            battery_level: None,
            screen_resolution: String::new(),
            max_refresh_rate: None,
            cpu_info: String::new(),
            total_memory: String::new(),
            available_storage: String::new(),
            total_storage: String::new(),
            device_type: String::new(),
            platform: "harmonyos".to_string(),
        }
    }
}

/// 文件信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HdcFileInfo {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: String,
    pub permissions: String,
    pub last_modified: String,
    pub links: String,
    pub owner: String,
    pub group: String,
    pub full_info: String,
}

/// HDC 应用详细信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HdcAppInfo {
    pub package_name: String,
    pub app_name: String,
    pub version_name: String,
    pub version_code: String,
    pub vendor: String,
    pub is_system: bool,
    pub removable: bool,
    pub install_source: String,
    pub code_path: String,
    pub cpu_abi: String,
    pub uid: i64,
    pub compile_sdk: String,
    pub app_distribution_type: String,
    pub install_time: String,
    pub main_ability: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    pub raw_data: String,
}

/// HDC 命令构建器
pub struct HdcCommand {
    hdc_path: String,
}

impl HdcCommand {
    /// 创建新的 HDC 命令构建器
    pub fn new(hdc_path: &str) -> Self {
        Self {
            hdc_path: hdc_path.to_string(),
        }
    }

    /// 执行 HDC 命令（走全局信号量，串行执行）
    /// 用于所有可能影响设备稳定性的命令
    pub async fn execute(&self, args: &[&str]) -> HdcResult<String> {
        let _permit = HDC_SEMAPHORE.acquire().await
            .map_err(|_| HdcError::ExecutionFailed("HDC 并发限制获取失败".to_string()))?;

        self.run_command(args).await
    }

    /// 执行轻量 HDC 命令（不走信号量，可并发）
    /// 仅用于 hdc list targets 等不会影响设备稳定性的只读查询
    pub async fn execute_fast(&self, args: &[&str]) -> HdcResult<String> {
        self.run_command(args).await
    }

    /// 实际执行 HDC 命令
    async fn run_command(&self, args: &[&str]) -> HdcResult<String> {
        let cmd_str = args.join(" ");
        eprintln!("[hdc] +{} | {:?}", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str);

        let start = std::time::Instant::now();
        let output = Command::new(&self.hdc_path)
            .args(args)
            .output()
            .await
            .map_err(|e| {
                eprintln!("[hdc] -{} | {:?} FAILED after {}ms", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str, start.elapsed().as_millis());
                if e.kind() == std::io::ErrorKind::NotFound {
                    HdcError::HdcNotFound
                } else {
                    HdcError::ExecutionFailed(format!("执行 hdc {:?} 失败: {}", args, e))
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
            eprintln!("[hdc] -{} | {:?} ERROR ({}ms): {}", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str, elapsed, &err_msg[..err_msg.len().min(200)]);
            return Err(HdcError::ExecutionFailed(err_msg));
        }

        eprintln!("[hdc] -{} | {:?} OK ({}ms, {} bytes)", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str, elapsed, output.stdout.len());
        Ok(stdout)
    }

    // ==================== 设备管理 ====================

    /// 获取已连接的设备列表（带 5 秒超时，避免设备 offline 时卡住）
    /// 解析 `hdc list targets -v` 输出
    /// 输出格式: serial    USB    Connected    localhost    hdc
    pub async fn devices(&self) -> HdcResult<Vec<HdcDevice>> {
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            self.execute_fast(&["list", "targets", "-v"])
        ).await;

        let output = match result {
            Ok(Ok(output)) => output,
            Ok(Err(e)) => return Err(e),
            Err(_) => {
                eprintln!("[devices] hdc list targets timed out (5s), device likely offline");
                return Err(HdcError::ExecutionFailed("HDC 命令超时，设备可能离线".to_string()));
            }
        };

        let valid_statuses = ["Connected", "Ready"];
        let devices: Vec<HdcDevice> = output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .filter_map(|line| {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    let serial = parts[0].to_string();
                    let status = parts[2].to_string();

                    // 过滤无效设备：状态必须是已知的，序列号不能是 COM 端口等
                    if !valid_statuses.contains(&status.as_str()) {
                        return None;
                    }
                    // 过滤掉 Windows COM 端口等非设备标识
                    if serial.starts_with("COM") {
                        return None;
                    }

                    let mut device = HdcDevice::default();
                    device.serial = serial;
                    device.status = status;
                    Some(device)
                } else {
                    None
                }
            })
            .collect();
        Ok(devices)
    }

    /// 通过 WiFi 连接设备
    /// `hdc tconn IP:port`
    pub async fn connect_wifi(&self, ip_port: &str) -> HdcResult<String> {
        let output = self.execute(&["tconn", ip_port]).await?;
        Ok(output.trim().to_string())
    }

    // ==================== 应用管理 ====================

    /// 安装应用
    /// `hdc -t serial install path`
    pub async fn install(&self, serial: &str, path: &str) -> HdcResult<String> {
        let output = self.execute(&["-t", serial, "install", path]).await?;
        Ok(output.trim().to_string())
    }

    /// 卸载应用
    /// `hdc -t serial uninstall package`
    pub async fn uninstall(&self, serial: &str, package: &str) -> HdcResult<String> {
        let output = self.execute(&["-t", serial, "uninstall", package]).await?;
        Ok(output.trim().to_string())
    }

    /// 清除应用缓存数据
    /// `hdc -t serial shell bm clean -c -n package`
    pub async fn clear_cache(&self, serial: &str, package: &str) -> HdcResult<String> {
        let output = self.execute(&["-t", serial, "shell", "bm", "clean", "-c", "-n", package]).await?;
        Ok(output.trim().to_string())
    }

    /// 清除应用用户数据
    /// `hdc -t serial shell bm clean -d -n package`
    pub async fn clear_data(&self, serial: &str, package: &str) -> HdcResult<String> {
        let output = self.execute(&["-t", serial, "shell", "bm", "clean", "-d", "-n", package]).await?;
        Ok(output.trim().to_string())
    }

    /// 获取已安装的应用列表（含详细信息）
    /// 1. `bm dump -a` 获取所有包名
    /// 2. 对每个包名 `bm dump -n <package>` 获取 JSON 详情
    /// 3. 并行查询（并发限制 10）
    pub async fn get_installed_apps(&self, serial: &str) -> HdcResult<Vec<HdcAppInfo>> {
        // 步骤1：获取所有包名
        let output = self
            .execute(&["-t", serial, "shell", "bm", "dump", "-a"])
            .await?;

        let packages: Vec<String> = output
            .lines()
            .map(|line| line.trim())
            .filter(|line| !line.is_empty() && line.contains('.'))
            .map(|line| line.to_string())
            .collect();

        eprintln!("[get_installed_apps] Found {} packages from bm dump -a", packages.len());

        if packages.is_empty() {
            return Ok(Vec::new());
        }

        // 步骤2：并行查询每个包的详情（并发限制 10）
        let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(10));
        let mut handles = Vec::new();

        for package in packages {
            let sem = semaphore.clone();
            let hdc_path = self.hdc_path.clone();
            let serial = serial.to_string();

            let handle = tokio::spawn(async move {
                let _permit = sem.acquire().await.ok()?;

                // 执行 bm dump -n <package>
                let output = tokio::process::Command::new(&hdc_path)
                    .args(["-t", &serial, "shell", "bm", "dump", "-n", &package])
                    .output()
                    .await
                    .ok()?;

                if !output.status.success() {
                    return None;
                }

                let stdout = String::from_utf8_lossy(&output.stdout).to_string();

                // 从输出中提取 JSON 部分（从第一个 { 到最后一个 }）
                let json_str = if let Some(start) = stdout.find('{') {
                    if let Some(end) = stdout.rfind('}') {
                        Some(stdout[start..=end].to_string())
                    } else {
                        None
                    }
                } else {
                    None
                };

                let json_str = match json_str {
                    Some(s) => s,
                    None => return None,
                };

                // 解析 JSON
                let json_val: serde_json::Value = match serde_json::from_str(&json_str) {
                    Ok(v) => v,
                    Err(e) => {
                        eprintln!("[get_installed_apps] JSON parse error for {}: {}", package, e);
                        return None;
                    }
                };

                // 提取 applicationInfo
                let app_info = match json_val.get("applicationInfo") {
                    Some(info) => info,
                    None => {
                        eprintln!("[get_installed_apps] No applicationInfo for {}", package);
                        return None;
                    }
                };

                // 提取各字段
                let bundle_name = app_info.get("bundleName")
                    .and_then(|v| v.as_str())
                    .unwrap_or(&package)
                    .to_string();

                let label_raw = app_info.get("label")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                // organization 是开发公司名（如"杭州随笔记网络技术有限公司"）
                let vendor = app_info.get("organization")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let app_name = if label_raw.starts_with("$string:") || label_raw.starts_with("$") || label_raw.is_empty() {
                    // label 是资源引用或为空，用 bundleName 作为回退（不用 vendor，那是公司名）
                    bundle_name.clone()
                } else {
                    label_raw
                };

                let version_name = app_info.get("versionName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let version_code = match app_info.get("versionCode") {
                    Some(v) => v.to_string(),
                    None => String::new(),
                };

                let is_system = app_info.get("isSystemApp")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                let removable = app_info.get("removable")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);

                let install_source = app_info.get("installSource")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let code_path = app_info.get("codePath")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let cpu_abi = app_info.get("cpuAbi")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                let uid = app_info.get("uid")
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);

                let compile_sdk = match app_info.get("compileSdkVersion") {
                    Some(v) => v.to_string(),
                    None => String::new(),
                };

                let app_distribution_type = app_info.get("appDistributionType")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();

                // installTime 是毫秒时间戳，转为可读格式
                let install_time = if let Some(ts) = json_val.get("installTime").and_then(|v| v.as_i64()) {
                    chrono::DateTime::from_timestamp_millis(ts)
                        .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                        .unwrap_or_else(|| ts.to_string())
                } else {
                    String::new()
                };

                let main_ability = json_val.get("mainAbility")
                    .and_then(|v| v.as_str())
                    .unwrap_or("EntryAbility")
                    .to_string();

                Some(HdcAppInfo {
                    package_name: bundle_name,
                    app_name,
                    version_name,
                    version_code,
                    vendor,
                    is_system,
                    removable,
                    install_source,
                    code_path,
                    cpu_abi,
                    uid,
                    compile_sdk,
                    app_distribution_type,
                    install_time,
                    main_ability,
                    raw_data: json_str.clone(),
                })
            });

            handles.push(handle);
        }

        // 步骤3：收集所有结果
        let mut apps = Vec::new();
        for handle in handles {
            if let Ok(Some(app)) = handle.await {
                apps.push(app);
            }
        }

        eprintln!("[get_installed_apps] Successfully parsed {} apps", apps.len());
        Ok(apps)
    }

    /// 快速获取已安装应用列表（包名和应用名称）
    /// `hdc -t serial shell bm dump -a -l`
    pub async fn get_installed_apps_list(&self, serial: &str) -> HdcResult<Vec<serde_json::Value>> {
        let output = self
            .execute(&["-t", serial, "shell", "bm", "dump", "-a", "-l"])
            .await?;

        // 解析 JSON 输出
        let apps: Vec<serde_json::Value> = serde_json::from_str(&output)
            .map_err(|e| HdcError::ParseError(format!("解析 bm dump -a -l 输出失败: {}", e)))?;

        eprintln!("[get_installed_apps_list] Found {} apps", apps.len());
        Ok(apps)
    }

    /// 获取单个应用的详细信息
    /// `hdc -t serial shell bm dump -n <package>`
    /// 复用 get_installed_apps 中的 JSON 解析逻辑
    pub async fn get_app_detail(&self, serial: &str, package: &str) -> HdcResult<HdcAppInfo> {
        let output = self
            .execute(&["-t", serial, "shell", "bm", "dump", "-n", package])
            .await?;

        // 从输出中提取 JSON 部分（从第一个 { 到最后一个 }）
        let json_str = if let Some(start) = output.find('{') {
            if let Some(end) = output.rfind('}') {
                Some(output[start..=end].to_string())
            } else {
                None
            }
        } else {
            None
        };

        let json_str = match json_str {
            Some(s) => s,
            None => return Err(HdcError::ParseError(format!("无法从 bm dump -n {} 输出中提取 JSON", package))),
        };

        // 解析 JSON
        let json_val: serde_json::Value = serde_json::from_str(&json_str)
            .map_err(|e| HdcError::ParseError(format!("JSON 解析失败 for {}: {}", package, e)))?;

        // 提取 applicationInfo
        let app_info = json_val.get("applicationInfo")
            .ok_or_else(|| HdcError::ParseError(format!("无 applicationInfo for {}", package)))?;

        // 提取各字段
        let bundle_name = app_info.get("bundleName")
            .and_then(|v| v.as_str())
            .unwrap_or(package)
            .to_string();

        let label_raw = app_info.get("label")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let vendor = app_info.get("organization")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // label 是资源引用或为空时，用 bundleName 作为回退（不用 vendor，那是公司名）
        let app_name = if label_raw.starts_with("$string:") || label_raw.starts_with("$") || label_raw.is_empty() {
            bundle_name.clone()
        } else {
            label_raw
        };

        let version_name = app_info.get("versionName")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let version_code = match app_info.get("versionCode") {
            Some(v) => v.to_string(),
            None => String::new(),
        };

        let is_system = app_info.get("isSystemApp")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let removable = app_info.get("removable")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let install_source = app_info.get("installSource")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let code_path = app_info.get("codePath")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let cpu_abi = app_info.get("cpuAbi")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let uid = app_info.get("uid")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);

        let compile_sdk = match app_info.get("compileSdkVersion") {
            Some(v) => v.to_string(),
            None => String::new(),
        };

        let app_distribution_type = app_info.get("appDistributionType")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        // installTime 是毫秒时间戳，转为可读格式
        let install_time = if let Some(ts) = json_val.get("installTime").and_then(|v| v.as_i64()) {
            chrono::DateTime::from_timestamp_millis(ts)
                .map(|dt| dt.format("%Y-%m-%d %H:%M:%S").to_string())
                .unwrap_or_else(|| ts.to_string())
        } else {
            String::new()
        };

        let main_ability = json_val.get("mainAbility")
            .and_then(|v| v.as_str())
            .unwrap_or("EntryAbility")
            .to_string();

        Ok(HdcAppInfo {
            package_name: bundle_name,
            app_name,
            version_name,
            version_code,
            vendor,
            is_system,
            removable,
            install_source,
            code_path,
            cpu_abi,
            uid,
            compile_sdk,
            app_distribution_type,
            install_time,
            main_ability,
            raw_data: json_str.clone(),
        })
    }

    /// 启动应用
    /// `hdc -t serial shell aa start -a <ability> -b <package>`
    pub async fn start_app(&self, serial: &str, package: &str, ability: &str) -> HdcResult<String> {
        let output = self
            .execute(&["-t", serial, "shell", "aa", "start", "-a", ability, "-b", package])
            .await?;
        Ok(output.trim().to_string())
    }

    /// 停止应用
    /// `hdc -t serial shell aa force-stop package`
    pub async fn stop_app(&self, serial: &str, package: &str) -> HdcResult<String> {
        let output = self
            .execute(&["-t", serial, "shell", "aa", "force-stop", package])
            .await?;
        Ok(output.trim().to_string())
    }

    // ==================== 文件操作 ====================

    /// 推送文件到设备
    /// `hdc -t serial file send local remote`
    pub async fn push_file(&self, serial: &str, local: &str, remote: &str) -> HdcResult<String> {
        let output = self
            .execute(&["-t", serial, "file", "send", local, remote])
            .await?;
        let trimmed = output.trim();
        if trimmed.contains("[Fail]") {
            return Err(HdcError::ExecutionFailed(trimmed.to_string()));
        }
        Ok(trimmed.to_string())
    }

    /// 从设备拉取文件
    /// `hdc -t serial file recv remote local`
    pub async fn pull_file(&self, serial: &str, remote: &str, local: &str) -> HdcResult<String> {
        let output = self
            .execute(&["-t", serial, "file", "recv", remote, local])
            .await?;
        let trimmed = output.trim();
        if trimmed.contains("[Fail]") {
            return Err(HdcError::ExecutionFailed(trimmed.to_string()));
        }
        Ok(trimmed.to_string())
    }

    /// 获取文件列表
    /// `hdc -t serial shell ls -la path`
    pub async fn get_file_list(&self, serial: &str, path: &str) -> HdcResult<Vec<HdcFileInfo>> {
        let output = self
            .shell_command(serial, &format!("ls -la {}", path))
            .await?;

        // 检查输出是否包含错误信息
        for line in output.lines() {
            let line = line.trim();
            if line.starts_with("ls:") && (line.contains("Permission denied") || line.contains("权限")) {
                return Err(HdcError::ExecutionFailed(line.to_string()));
            }
        }

        let mut files = Vec::new();

        for line in output.lines() {
            // 跳过 "total" 行和空行
            if line.starts_with("total") || line.trim().is_empty() {
                continue;
            }

            // 直接使用整行作为 full_info
            let full_info = line.to_string();

            // 提取权限字符串
            let permissions = line.split_whitespace().next().unwrap_or("").to_string();
            let is_directory = permissions.starts_with('d');

            // 提取文件名（从第8个空格开始）
            let parts: Vec<&str> = line.split_whitespace().collect();
            // 确保至少有8个部分（权限、链接数、所有者、组、大小、日期、时间、文件名）
            let name = if parts.len() >= 8 {
                // 从第8个部分开始，剩下的都是文件名
                parts[7..].join(" ").to_string()
            } else {
                // 如果部分不足，尝试使用最后一个部分作为文件名
                parts.last().unwrap_or(&"").to_string()
            };
            
            // 跳过 . 和 .. 特殊目录
            if name == "." || name == ".." {
                continue;
            }
            
            let full_path = if path.ends_with('/') {
                format!("{}{}", path, name)
            } else {
                format!("{}/{}", path, name)
            };

            // 提取大小（第5个部分）
            let size_str = line.split_whitespace().nth(4).unwrap_or("0").to_string();

            // 提取修改时间（第6-8个部分）
            let time_parts: Vec<&str> = line.split_whitespace().skip(5).take(3).collect();
            let last_modified = time_parts.join(" ");

            // 提取链接数、所有者、组
            let links = line.split_whitespace().nth(1).unwrap_or("0").to_string();
            let owner = line.split_whitespace().nth(2).unwrap_or("").to_string();
            let group = line.split_whitespace().nth(3).unwrap_or("").to_string();

            files.push(HdcFileInfo {
                name,
                path: full_path,
                is_directory,
                size: size_str,
                permissions,
                last_modified,
                links,
                owner,
                group,
                full_info,
            });
        }

        Ok(files)
    }

    /// 批量检查路径权限
    /// `hdc -t serial shell stat -c "%n : %A (%a)" path1 path2 path3`
    pub async fn check_paths_permission(&self, serial: &str, paths: &[&str]) -> HdcResult<HashMap<String, String>> {
        if paths.is_empty() {
            return Ok(HashMap::new());
        }

        let paths_str = paths.join(" ");
        let output = self
            .shell_command(serial, &format!("stat -c \"%n : %A (%a)\" {}", paths_str))
            .await?;

        let mut result = HashMap::new();

        // 解析 stat 输出，格式为 "路径 : drwxrwxrwx (777)"
        for line in output.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            // 检查是否是权限错误信息（stat 也会输出错误）
            if line.starts_with("stat:") && (line.contains("Permission denied") || line.contains("权限")) {
                // 提取路径
                if let Some(colon_pos) = line.find(':') {
                    let path_part = &line[colon_pos + 1..].trim();
                    // 移除末尾的冒号和错误信息
                    let path = path_part.split(|c| c == ':' || c == ' ').next().unwrap_or("").trim();
                    if !path.is_empty() {
                        result.insert(path.to_string(), "Permission denied".to_string());
                    }
                }
                continue;
            }

            // 解析正常的 stat 输出
            if let Some(colon_pos) = line.find(" : ") {
                let path = line[..colon_pos].trim();
                let permissions_part = &line[colon_pos + 3..];
                result.insert(path.to_string(), permissions_part.to_string());
            }
        }

        // 确保所有输入路径都在结果中，默认有执行权限
        for path in paths {
            if !result.contains_key(*path) {
                result.insert(path.to_string(), "Permission denied".to_string());
            }
        }

        Ok(result)
    }

    // ==================== Shell ====================

    /// 执行 Shell 命令
    /// `hdc -t serial shell cmd`
    /// 对于包含管道、重定向等特殊字符的命令，使用 sh -c 包装
    /// 带 30 秒超时保护
    pub async fn shell_command(&self, serial: &str, cmd: &str) -> HdcResult<String> {
        // 如果命令包含管道、重定向等 shell 特殊字符，使用 sh -c 包装
        let args: Vec<&str> = if cmd.contains('|') || cmd.contains('>') || cmd.contains('<') || cmd.contains('&') || cmd.contains(';') {
            vec!["-t", serial, "shell", "sh", "-c", cmd]
        } else {
            vec!["-t", serial, "shell", cmd]
        };

        // 30 秒超时保护，防止交互式命令卡死
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            self.execute(&args)
        ).await;

        match result {
            Ok(Ok(output)) => Ok(output),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(HdcError::ExecutionFailed("命令执行超时（30秒），可能是交互式命令，请使用非交互式参数".into())),
        }
    }

    // ==================== 设备信息 ====================

    /// 获取设备详细信息
    /// 通过 `hdc shell param get` 获取设备属性
    pub async fn get_device_info(&self, serial: &str) -> HdcResult<HdcDevice> {
        // 检查缓存（5 秒内不重复获取）
        {
            let cache = DEVICE_INFO_CACHE.lock().await;
            if let Some((cached_json, ts)) = cache.get(serial) {
                if ts.elapsed().as_secs() < 5 {
                    eprintln!("[get_device_info] cache hit for {}", serial);
                    if let Ok(cached_device) = serde_json::from_str::<HdcDevice>(cached_json) {
                        return Ok(cached_device);
                    }
                }
            }
        }

        // 调用级去重：同一 serial 同时只允许一个 get_device_info 执行
        // 其他调用等待完成后直接读缓存
        let need_execute = {
            let mut locks = DEVICE_INFO_LOCK.lock().await;
            if locks.contains_key(serial) {
                // 已有调用在执行，释放锁后等待一小段时间再读缓存
                drop(locks);
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                // 再次检查缓存
                let cache = DEVICE_INFO_CACHE.lock().await;
                if let Some((cached_json, ts)) = cache.get(serial) {
                    if ts.elapsed().as_secs() < 5 {
                        eprintln!("[get_device_info] cache hit after waiting for {}", serial);
                        if let Ok(cached_device) = serde_json::from_str::<HdcDevice>(cached_json) {
                            return Ok(cached_device);
                        }
                    }
                }
                false
            } else {
                locks.insert(serial.to_string(), ());
                true
            }
        };

        if !need_execute {
            // 等待后仍然没有缓存，直接返回默认设备（避免重复执行）
            let mut device = HdcDevice::default();
            device.serial = serial.to_string();
            return Ok(device);
        }

        let result = self.get_device_info_inner(serial).await;

        // 执行完毕，释放去重锁
        {
            let mut locks = DEVICE_INFO_LOCK.lock().await;
            locks.remove(serial);
        }

        result
    }

    /// get_device_info 实际执行逻辑
    async fn get_device_info_inner(&self, serial: &str) -> HdcResult<HdcDevice> {
        let mut device = HdcDevice::default();
        device.serial = serial.to_string();

        // 1. 设备属性：hidumper -c base 一次获取所有信息（比 5 个 param get 高效）
        match self.execute(&["-t", serial, "shell", "hidumper -c base"]).await {
            Ok(output) => {
                // 检查设备是否断开
                if output.contains("connect-key") || output.contains("Device not found") {
                    eprintln!("[get_device_info] device {} disconnected", serial);
                    return Ok(device);
                }
                // 检查是否包含有效数据
                if !output.contains("Brand:") && !output.contains("ProductModel:") {
                    eprintln!("[get_device_info] hidumper -c base returned invalid data");
                    return Ok(device);
                }

                // 解析键值对
                for line in output.lines() {
                    let line = line.trim();
                    if let Some(colon_pos) = line.find(':') {
                        let key = line[..colon_pos].trim();
                        let val = line[colon_pos + 1..].trim();

                        match key {
                            "Brand" => device.brand = val.to_string(),
                            "MarketName" => device.market_name = val.to_string(),
                            "ProductModel" | "SoftwareModel" => {
                                if device.model.is_empty() { device.model = val.to_string(); }
                            }
                            "DeviceType" => device.device_type = val.to_string(),
                            "OSFullName" => device.android_version = val.to_string(),
                            "SDKAPIVersion" => device.sdk_version = val.to_string(),
                            "SecurityPatch" => device.security_patch = val.to_string(),
                            "IncrementalVersion" => device.incremental_version = val.to_string(),
                            "ABIList" => device.abi_list = val.to_string(),
                            _ => {}
                        }
                    }
                }

                // 组合设备名称：Brand + MarketName
                if !device.brand.is_empty() && !device.market_name.is_empty() {
                    device.market_name = format!("{} {}", device.brand, device.market_name);
                }

                eprintln!("[get_device_info] base info: model='{}', brand='{}', name='{}', type='{}', os='{}', sdk='{}', patch='{}'",
                    device.model, device.brand, device.market_name, device.device_type,
                    device.android_version, device.sdk_version, device.security_patch);
            }
            Err(e) => {
                eprintln!("[get_device_info] hidumper -c base failed: {}", e);
                return Ok(device);
            }
        }

        // 2. 鸿蒙内核版本（uname -r 不需要 root）
        match self.execute(&["-t", serial, "shell", "uname -r"]).await {
            Ok(output) => {
                let ver = output.trim();
                if !ver.is_empty() && !ver.contains("denied") && !ver.contains("[Fail]") {
                    // uname -r 可能返回 "HongMeng Kernel X.XX" 或纯版本号
                    if ver.contains("HongMeng") || ver.contains("Kernel") {
                        device.kernel_version = ver.to_string();
                    } else {
                        device.kernel_version = format!("HongMeng Kernel {}", ver);
                    }
                    eprintln!("[get_device_info] kernel: '{}'", device.kernel_version);
                } else {
                    eprintln!("[get_device_info] uname -r failed: {:?}", ver);
                }
            }
            Err(e) => {
                eprintln!("[get_device_info] uname -r error: {}", e);
            }
        }

        // 3. CPU 核心数和频率（hidumper --cpufreq 最准确，包含所有核心）
        match self.execute(&["-t", serial, "shell", "hidumper --cpufreq"]).await {
            Ok(output) => {
                // 统计核心数：从路径 /cpuN/cpufreq 中提取不同的 N
                let mut core_ids = std::collections::HashSet::new();
                let mut max_freq: u64 = 0;
                for line in output.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    // 统计核心数：匹配 cpuN/cpufreq 模式（在 cmd is 行中）
                    // 路径格式: cmd is: cat /sys/devices/system/cpu/cpuN/cpufreq/cpuinfo_cur_freq
                    // 需要找所有 "cpuN/cpufreq" 模式，不能只用 find（会匹配到 system/cpu）
                    let mut search_from = 0;
                    while let Some(idx) = line[search_from..].find("cpu") {
                        let abs_idx = search_from + idx;
                        let after = &line[abs_idx + 3..]; // skip "cpu"
                        if let Some(end) = after.find('/') {
                            let num = &after[..end];
                            if num.parse::<u32>().is_ok() {
                                let rest = &after[end + 1..];
                                if rest.starts_with("cpufreq") {
                                    core_ids.insert(num.to_string());
                                }
                            }
                        }
                        search_from = abs_idx + 3;
                    }
                    // 提取最大频率：跳过 cmd is 行，纯数字行是频率值
                    if !trimmed.starts_with("cmd is") && trimmed.chars().all(|c| c.is_ascii_digit()) {
                        if let Ok(freq) = trimmed.parse::<u64>() {
                            if freq > max_freq {
                                max_freq = freq;
                            }
                        }
                    }
                }
                let core_count = core_ids.len();
                if core_count > 0 {
                    if max_freq > 0 {
                        let ghz = max_freq as f64 / 1_000_000.0;
                        if ghz >= 1.0 {
                            device.cpu_info = format!("{} cores (max {:.1} GHz)", core_count, ghz);
                        } else {
                            device.cpu_info = format!("{} cores (max {} MHz)", core_count, max_freq / 1000);
                        }
                    } else {
                        device.cpu_info = format!("{} cores", core_count);
                    }
                }
                eprintln!("[get_device_info] CPU: cores={}, max_freq={}, info='{}'", core_count, max_freq, device.cpu_info);
            }
            Err(e) => {
                eprintln!("[get_device_info] hidumper --cpufreq failed: {}, trying nproc", e);
                // fallback: nproc（可能只返回在线核心数）
                match self.execute(&["-t", serial, "shell", "nproc"]).await {
                    Ok(output) => {
                        let nproc: usize = output.trim().lines()
                            .filter(|l| !l.trim().is_empty())
                            .last()
                            .and_then(|l| l.trim().parse::<usize>().ok())
                            .unwrap_or(0);
                        if nproc > 0 {
                            device.cpu_info = format!("{} cores", nproc);
                        }
                        eprintln!("[get_device_info] nproc fallback: {}", nproc);
                    }
                    Err(e2) => eprintln!("[get_device_info] nproc also failed: {}", e2),
                }
            }
        }

        // 4. 内存信息
        match self.execute(&["-t", serial, "shell", "cat /proc/meminfo"]).await {
            Ok(output) => {
                let (total, _, _) = crate::utils::parse_memory_info(&output);
                device.total_memory = crate::utils::format_file_size(total);
            }
            Err(_) => {}
        }

        // 5. 存储信息
        match self.execute(&["-t", serial, "shell", "df -h"]).await {
            Ok(output) => {
                for line in output.lines() {
                    if line.contains("Filesystem") || line.contains("Mounted on") {
                        continue;
                    }
                    if line.contains("/data") {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if parts.len() >= 4 {
                            device.total_storage = parts[1].to_string();
                            device.available_storage = parts[3].to_string();
                        }
                        break;
                    }
                }
            }
            Err(_) => {}
        }

        // 6. 电池信息
        match self.execute(&["-t", serial, "shell", "hidumper -s BatteryService"]).await {
            Ok(output) => {
                for line in output.lines() {
                    if line.contains("Capacity") || line.contains("level") {
                        if let Some(v) = line.split(':').nth(1) {
                            let v = v.trim();
                            let num_str: String = v.chars().take_while(|c| c.is_ascii_digit()).collect();
                            if let Ok(level) = num_str.parse::<u8>() {
                                device.battery_level = Some(level);
                                break;
                            }
                        }
                    }
                }
            }
            Err(_) => {}
        }

        // 7. 分辨率 + 最高帧率
        match self.execute(&["-t", serial, "shell", "hidumper -s RenderService -a screen"]).await {
            Ok(output) => {
                // 跳过包含错误信息的输出
                if output.contains("[Fail]") || output.contains("connect-key") || output.contains("Device not found") {
                    eprintln!("[get_device_info] screen resolution: device disconnected");
                } else {
                    let mut max_refresh_rate: u32 = 0;
                    for line in output.lines() {
                        let trimmed = line.trim();
                        if trimmed.is_empty() || trimmed.starts_with("---") || trimmed.starts_with("[") {
                            continue;
                        }
                        // 提取最高帧率：supportedMode[0]: 1272x2860, refreshRate=120
                        if let Some(rr_start) = trimmed.find("refreshRate=") {
                            let rr_str = &trimmed[rr_start + 12..];
                            let rr_num: String = rr_str.chars().take_while(|c| c.is_ascii_digit()).collect();
                            if let Ok(rr) = rr_num.parse::<u32>() {
                                if rr > max_refresh_rate {
                                    max_refresh_rate = rr;
                                }
                            }
                        }
                        // 提取分辨率
                        if let Some(idx) = trimmed.find(|c| c == 'x' || c == 'X') {
                            let before = trimmed[..idx].trim();
                            let after = trimmed[idx + 1..].trim();
                            let w: String = before.chars().rev().take_while(|c| c.is_ascii_digit()).collect::<Vec<_>>().into_iter().rev().collect();
                            let h: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
                            if !w.is_empty() && !h.is_empty() {
                                let w_val = w.parse::<u32>().unwrap_or(0);
                                let h_val = h.parse::<u32>().unwrap_or(0);
                                if w_val >= 320 && h_val >= 480 && w_val <= 7680 && h_val <= 4320 {
                                    device.screen_resolution = format!("{}x{}", w_val, h_val);
                                    break;
                                }
                            }
                        }
                    }
                    if max_refresh_rate > 0 {
                        device.max_refresh_rate = Some(max_refresh_rate);
                    }
                }
            }
            Err(_) => {}
        }
        // 分辨率备选：param get
        if device.screen_resolution.is_empty() {
            match self.execute(&["-t", serial, "shell", "param get persist.sys.screen.resolution"]).await {
                Ok(output) => {
                    let val = output.trim();
                    if val.contains('x') && !val.contains("fail!") && !val.contains("[Fail]") && !val.contains("connect-key") {
                        let last = val.lines().last().unwrap_or("").trim();
                        if last.contains('x') && !last.contains("[Fail]") {
                            device.screen_resolution = last.to_string();
                        }
                    }
                }
                Err(_) => {}
            }
        }

        eprintln!("[get_device_info] Final device: serial={}, model={}, brand={}, battery={:?}",
            device.serial, device.model, device.brand, device.battery_level);

        // 写入缓存
        if let Ok(json) = serde_json::to_string(&device) {
            let mut cache = DEVICE_INFO_CACHE.lock().await;
            cache.insert(serial.to_string(), (json, std::time::Instant::now()));
        }

        Ok(device)
    }

    /// 解析 param get 的输出值
    /// param get 输出格式: "key\nvalue" 或 "key\nvalue\n"
    /// 在分隔符后，第一行是 key（含数字和 === 前缀），第二行是 value
    fn parse_param_value(section: &str) -> String {
        // section 格式: "N##\nvalue\n" 或 "N##\nGet parameter fail! ..."
        // 去掉 "N##" 前缀
        let value = section.trim();
        // 去掉数字和 # 号前缀（如 "1##"）
        let value = value.trim_start_matches(|c: char| c.is_ascii_digit() || c == '#' || c == '=');
        let value = value.trim();
        // 取第一行作为值（如果包含错误信息则返回空）
        let first_line = value.lines().next().unwrap_or("").trim();
        if first_line.contains("fail!") || first_line.contains("Fail") || first_line.contains("errNum") || first_line.is_empty() {
            return String::new();
        }
        first_line.to_string()
    }

    /// 截屏并返回 base64 编码的 PNG 图片
    /// `hdc shell screencap -p /data/local/tmp/screen.png` + `hdc file recv`
    pub async fn screenshot(&self, serial: &str) -> HdcResult<String> {
        let _permit = HDC_SEMAPHORE.acquire().await
            .map_err(|_| HdcError::ExecutionFailed("HDC 并发限制获取失败".to_string()))?;

        let remote_file = "/data/local/tmp/screen.jpeg";
        let local_dir = std::env::temp_dir().join("hdc-toolbox");
        let local_file = local_dir.join("screen.jpeg");

        // 确保本地目录存在
        let _ = std::fs::create_dir_all(&local_dir);

        // 步骤1：设备端截图（鸿蒙使用 snapshot_display -f 指定存储路径）
        let args = ["-t", serial, "shell", "snapshot_display", "-f", remote_file];
        let cmd_str = args.join(" ");
        eprintln!("[hdc] +{} | {}", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str);

        let start = std::time::Instant::now();
        let output = Command::new(&self.hdc_path)
            .args(args)
            .output()
            .await
            .map_err(|e| {
                eprintln!("[hdc] -{} | {} FAILED after {}ms", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str, start.elapsed().as_millis());
                HdcError::ExecutionFailed(format!("截图失败: {}", e))
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("[screenshot] snapshot_display failed: {}", stderr.trim());
            return Err(HdcError::ExecutionFailed(format!("截图失败: {}", stderr.trim())));
        }

        // 步骤2：hdc file recv 到本地
        let recv_args = ["-t", serial, "file", "recv", remote_file, local_file.to_str().unwrap_or("/tmp/screen.png")];
        let recv_cmd_str = recv_args.join(" ");
        eprintln!("[hdc] +{} | {}", chrono::Local::now().format("%H:%M:%S%.3f"), recv_cmd_str);

        let pull_output = Command::new(&self.hdc_path)
            .args(recv_args)
            .output()
            .await
            .map_err(|e| HdcError::ExecutionFailed(format!("file recv 失败: {}", e)))?;

        if !pull_output.status.success() {
            let stderr = String::from_utf8_lossy(&pull_output.stderr);
            eprintln!("[screenshot] file recv failed: {}", stderr.trim());
            return Err(HdcError::ExecutionFailed(format!("file recv 失败: {}", stderr.trim())));
        }

        let elapsed = start.elapsed().as_millis();
        eprintln!("[hdc] -{} | {} OK ({}ms)", chrono::Local::now().format("%H:%M:%S%.3f"), recv_cmd_str, elapsed);

        // 步骤3：读取本地文件并编码为 base64
        let data = std::fs::read(&local_file)
            .map_err(|e| HdcError::ExecutionFailed(format!("读取本地文件失败: {}", e)))?;

        // 清理设备端文件
        let _ = Command::new(&self.hdc_path)
            .args(["-t", serial, "shell", "rm", "-f", remote_file])
            .spawn();

        if data.is_empty() {
            return Err(HdcError::ExecutionFailed("截图返回空数据".to_string()));
        }

        // 检查 JPEG 头 (FF D8 FF)
        if data.len() < 3 || &data[0..3] != &[0xFF, 0xD8, 0xFF] {
            eprintln!("[screenshot] Not JPEG! {} bytes", data.len());
            return Err(HdcError::ExecutionFailed(format!("截图返回了非 JPEG 数据 ({} bytes)", data.len())));
        }

        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        eprintln!("[screenshot] base64 {} chars ({}ms)", b64.len(), elapsed);
        Ok(b64)
    }

    /// 获取存储信息
    /// `hdc shell df`
    pub async fn get_storage_info(&self, serial: &str) -> HdcResult<String> {
        let output = self
            .shell_command(serial, "df /data 2>/dev/null || df /")
            .await?;
        Ok(output)
    }

    /// 获取 CPU 使用率
    /// `hdc shell hidumper --cpuusage`
    pub async fn get_cpu_usage(&self, serial: &str) -> HdcResult<String> {
        let output = self
            .shell_command(serial, "hidumper --cpuusage")
            .await?;
        Ok(output)
    }

    /// 获取整机内存信息（用 /proc/meminfo，不需要 root）
    /// `hdc shell cat /proc/meminfo`
    pub async fn get_total_memory(&self, serial: &str) -> HdcResult<String> {
        let output = self
            .shell_command(serial, "cat /proc/meminfo")
            .await?;
        Ok(output)
    }

    /// 获取存储信息（用 df -h，避免 hidumper --storage 超时）
    /// `hdc shell df -h /data`
    pub async fn get_storage_detail(&self, serial: &str) -> HdcResult<String> {
        let output = self
            .shell_command(serial, "df -h /data")
            .await?;
        Ok(output)
    }

    /// 获取电池信息（需要 -a "-i" 参数）
    /// `hdc shell hidumper -s BatteryService -a "-i"`
    pub async fn get_battery_info(&self, serial: &str) -> HdcResult<String> {
        let output = self
            .shell_command(serial, "hidumper -s BatteryService -a \"-i\"")
            .await?;
        Ok(output)
    }

    /// 获取网络信息
    /// `hdc shell hidumper --net`
    pub async fn get_network_info(&self, serial: &str) -> HdcResult<String> {
        let output = self
            .shell_command(serial, "hidumper --net")
            .await?;
        Ok(output)
    }

    /// 获取进程列表
    /// `hdc shell hidumper -p`
    pub async fn get_process_list(&self, serial: &str) -> HdcResult<String> {
        let output = self
            .shell_command(serial, "hidumper -p")
            .await?;
        Ok(output)
    }

    /// 获取 hidumper -c base 完整设备基础信息
    pub async fn get_base_info(&self, serial: &str) -> HdcResult<String> {
        let output = self
            .shell_command(serial, "hidumper -c base")
            .await?;
        Ok(output)
    }

    /// 获取 GPU 信息（OpenGL ES）
    pub async fn get_gpu_info(&self, serial: &str) -> HdcResult<String> {
        let output = self
            .shell_command(serial, "hidumper -s RenderService -a \"gles\"")
            .await?;
        Ok(output)
    }

    // ==================== 设备控制 ====================

    /// 发送点击事件
    /// `hdc shell uinput tap x y`
    pub async fn send_tap(&self, serial: &str, x: u32, y: u32) -> HdcResult<String> {
        let output = self
            .execute(&["-t", serial, "shell", "uinput", "tap", &x.to_string(), &y.to_string()])
            .await?;
        Ok(output.trim().to_string())
    }

    /// 发送滑动事件
    /// `hdc shell uinput swipe x1 y1 x2 y2`
    pub async fn send_swipe(
        &self,
        serial: &str,
        x1: u32,
        y1: u32,
        x2: u32,
        y2: u32,
    ) -> HdcResult<String> {
        eprintln!("[send_swipe] Swiping from ({}, {}) to ({}, {}) on device: {}", x1, y1, x2, y2, serial);
        let output = self
            .execute(&[
                "-t", serial, "shell", "uinput", "swipe",
                &x1.to_string(), &y1.to_string(),
                &x2.to_string(), &y2.to_string(),
            ])
            .await?;
        Ok(output.trim().to_string())
    }

    /// 重启设备
    /// `hdc -t serial target boot`
    pub async fn reboot(&self, serial: &str) -> HdcResult<String> {
        let output = self.execute(&["-t", serial, "target", "boot"]).await?;
        Ok(output.trim().to_string())
    }

    /// 重启到 recovery 模式
    /// `hdc -t serial target boot -recovery`
    pub async fn reboot_recovery(&self, serial: &str) -> HdcResult<String> {
        let output = self.execute(&["-t", serial, "target", "boot", "-recovery"]).await?;
        Ok(output.trim().to_string())
    }

    /// 重启到 bootloader 模式
    /// `hdc -t serial target boot -bootloader`
    pub async fn reboot_bootloader(&self, serial: &str) -> HdcResult<String> {
        let output = self.execute(&["-t", serial, "target", "boot", "-bootloader"]).await?;
        Ok(output.trim().to_string())
    }

    /// 关机
    /// `hdc -t serial target boot shutdown`
    pub async fn shutdown(&self, serial: &str) -> HdcResult<String> {
        let output = self.execute(&["-t", serial, "target", "boot", "shutdown"]).await?;
        Ok(output.trim().to_string())
    }

    /// 导出 bugreport 到指定文件
    /// `hdc -t serial bugreport` 输出重定向到文件
    pub async fn bugreport(&self, serial: &str, output_path: &str) -> HdcResult<String> {
        let _permit = HDC_SEMAPHORE.acquire().await
            .map_err(|_| HdcError::ExecutionFailed("HDC 并发限制获取失败".to_string()))?;

        let args = ["-t", serial, "bugreport"];
        let cmd_str = args.join(" ");
        eprintln!("[hdc] +{} | {}", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str);

        let start = std::time::Instant::now();
        let output = tokio::process::Command::new(&self.hdc_path)
            .args(&args)
            .output()
            .await
            .map_err(|e| {
                eprintln!("[hdc] -{} | {} FAILED after {}ms", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str, start.elapsed().as_millis());
                if e.kind() == std::io::ErrorKind::NotFound {
                    HdcError::HdcNotFound
                } else {
                    HdcError::ExecutionFailed(format!("执行 hdc bugreport 失败: {}", e))
                }
            })?;

        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();

        // 写入文件
        tokio::fs::write(output_path, &stdout).await
            .map_err(|e| HdcError::ExecutionFailed(format!("写入文件失败 {}: {}", output_path, e)))?;

        eprintln!("[hdc] -{} | {} OK ({}ms, {} bytes -> {})",
            chrono::Local::now().format("%H:%M:%S%.3f"),
            cmd_str, start.elapsed().as_millis(), stdout.len(), output_path);

        if !output.status.success() && !stderr.is_empty() {
            return Err(HdcError::ExecutionFailed(stderr));
        }

        Ok(format!("bugreport saved to {}", output_path))
    }

    // ==================== 日志 ====================

    /// 获取日志
    /// `hdc -t serial shell hilog -t lines`
    pub async fn get_logcat(&self, serial: &str, lines: u32) -> HdcResult<String> {
        let lines_arg = format!("-t{}", lines);
        let output = self
            .execute(&["-t", serial, "shell", "hilog", &lines_arg])
            .await?;
        Ok(output)
    }

    /// 启动实时日志流
    /// `hdc -t serial shell hilog -x`
    pub async fn start_logcat_stream(&self, serial: &str) -> HdcResult<tokio::process::Child> {
        let args = &["-t", serial, "shell", "hilog", "-x"];
        let cmd_str = args.join(" ");
        eprintln!("[hdc] +{} | {:?}", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str);

        let child = tokio::process::Command::new(&self.hdc_path)
            .args(args)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| {
                eprintln!("[hdc] -{} | {:?} FAILED", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str);
                HdcError::ExecutionFailed(format!("启动 hilog 流失败: {}", e))
            })?;
        
        eprintln!("[hdc] -{} | {:?} OK (started stream)", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str);
        Ok(child)
    }

    // ==================== 工具方法 ====================

    /// 检查 HDC 是否可用
    pub async fn check_available(&self) -> bool {
        self.execute(&["version"]).await.is_ok()
    }

    /// 获取 HDC 版本
    pub async fn get_version(&self) -> HdcResult<String> {
        let output = self.execute_fast(&["-v"]).await?;
        // 从输出中提取版本号，格式：HDC version 1.0.0.0 或类似格式
        for line in output.trim().lines() {
            if let Some(version_part) = line.split_whitespace().nth(1) {
                if version_part.contains('.') {
                    return Ok(version_part.to_string());
                }
            }
        }
        Ok(output.trim().to_string())
    }

    /// 重启 HDC 服务（kill + start）
    pub async fn restart_hdc(&self) -> HdcResult<String> {
        eprintln!("[restart_hdc] Killing HDC server...");
        let _ = self.execute_fast(&["kill"]).await;
        // 等待进程完全退出
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        eprintln!("[restart_hdc] Starting HDC server...");
        let output = self.execute_fast(&["start"]).await?;
        eprintln!("[restart_hdc] HDC server restarted: {}", output.trim());
        Ok(output.trim().to_string())
    }
}
