use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::process::Command;
use tokio::sync::Semaphore;
use std::sync::LazyLock;

/// 全局 HDC 命令并发限制（严格串行，同一时间只允许 1 个 HDC 命令执行）
/// 这是核心机制：确保上一条 HDC 命令完全结束后才执行下一条，防止设备 offline
static HDC_SEMAPHORE: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(1));

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
    pub android_version: String,
    pub sdk_version: String,
    pub battery_level: Option<u8>,
    pub screen_resolution: String,
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
            android_version: String::new(),
            sdk_version: String::new(),
            battery_level: None,
            screen_resolution: String::new(),
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
            self.execute(&["list", "targets", "-v"])
        ).await;

        let output = match result {
            Ok(Ok(output)) => output,
            Ok(Err(e)) => return Err(e),
            Err(_) => {
                eprintln!("[devices] hdc list targets timed out (5s), device likely offline");
                return Err(HdcError::ExecutionFailed("HDC 命令超时，设备可能离线".to_string()));
            }
        };

        let valid_statuses = ["Connected", "Ready", "Offline", "Unauthorized"];
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

                // 如果 label 是资源引用（如 $string:app_name），用 vendor 或 bundleName 代替
                let vendor = app_info.get("vendor")
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

    /// 快速获取已安装应用列表（仅包名）
    /// `hdc -t serial shell bm dump -a`
    pub async fn get_installed_apps_list(&self, serial: &str) -> HdcResult<Vec<String>> {
        let output = self
            .execute(&["-t", serial, "shell", "bm", "dump", "-a"])
            .await?;

        let packages: Vec<String> = output
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty() && l.contains('.'))
            .collect();

        eprintln!("[get_installed_apps_list] Found {} packages", packages.len());
        Ok(packages)
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

        let vendor = app_info.get("vendor")
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
            raw_data: json_str.clone(),
        })
    }

    /// 启动应用
    /// `hdc -t serial shell aa start -a EntryAbility -b package`
    pub async fn start_app(&self, serial: &str, package: &str) -> HdcResult<String> {
        let output = self
            .execute(&["-t", serial, "shell", "aa", "start", "-a", "EntryAbility", "-b", package])
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
        Ok(output.trim().to_string())
    }

    /// 从设备拉取文件
    /// `hdc -t serial file recv remote local`
    pub async fn pull_file(&self, serial: &str, remote: &str, local: &str) -> HdcResult<String> {
        let output = self
            .execute(&["-t", serial, "file", "recv", remote, local])
            .await?;
        Ok(output.trim().to_string())
    }

    /// 获取文件列表
    /// `hdc -t serial shell ls -la path`
    pub async fn get_file_list(&self, serial: &str, path: &str) -> HdcResult<Vec<HdcFileInfo>> {
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

            files.push(HdcFileInfo {
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
        let mut device = HdcDevice::default();
        device.serial = serial.to_string();

        // ===== 方案：每个信息单独获取，避免分隔符解析问题 =====

        // 1. 设备属性（每条 param get 单独执行，避免解析问题）
        let get_param = |key: &str| {
            let serial = serial.to_string();
            let key = key.to_string();
            async move {
                match self.execute(&["-t", &serial, "shell", &format!("param get {}", key)]).await {
                    Ok(output) => {
                        let val = output.trim().to_string();
                        // 过滤错误信息：[Fail]、fail!、空值
                        if val.is_empty() || val.contains("[Fail]") || val.contains("fail!") || val.contains("Fail]") || val.contains("connect-key") {
                            eprintln!("[get_param] {} => FAILED", key);
                            None
                        } else {
                            let last_line = val.lines().last().unwrap_or("").trim().to_string();
                            // 再次检查最后一行
                            if last_line.is_empty() || last_line.contains("[Fail]") || last_line.contains("fail!") || last_line.contains("connect-key") {
                                None
                            } else {
                                eprintln!("[get_param] {} => '{}'", key, last_line);
                                Some(last_line)
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("[get_param] {} => ERROR: {}", key, e);
                        None
                    }
                }
            }
        };

        device.model = get_param("const.product.model").await.unwrap_or_default();
        device.brand = get_param("const.product.brand").await.unwrap_or_default();
        device.device_type = get_param("const.product.devicetype").await.unwrap_or_default();
        device.android_version = get_param("const.build.version").await.unwrap_or_default();
        device.sdk_version = get_param("ohos.apiversion").await.unwrap_or_default();
        eprintln!("[get_device_info] props: model='{}', brand='{}', type='{}', ver='{}', api='{}'",
            device.model, device.brand, device.device_type, device.android_version, device.sdk_version);

        // 2. CPU 核心数和频率（hidumper --cpufreq 最准确，包含所有核心）
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

        // 7. 分辨率
        match self.execute(&["-t", serial, "shell", "hidumper -s RenderService -a screen"]).await {
            Ok(output) => {
                for line in output.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() || trimmed.starts_with("---") || trimmed.starts_with("[") {
                        continue;
                    }
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
            }
            Err(_) => {}
        }
        // 分辨率备选：param get
        if device.screen_resolution.is_empty() {
            match self.execute(&["-t", serial, "shell", "param get persist.sys.screen.resolution"]).await {
                Ok(output) => {
                    let val = output.trim();
                    if val.contains('x') && !val.contains("fail!") {
                        device.screen_resolution = val.lines().last().unwrap_or("").trim().to_string();
                    }
                }
                Err(_) => {}
            }
        }

        eprintln!("[get_device_info] Final device: serial={}, model={}, brand={}, battery={:?}",
            device.serial, device.model, device.brand, device.battery_level);

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

        let remote_file = "/data/local/tmp/screen.png";
        let local_dir = std::env::temp_dir().join("hdc-toolbox");
        let local_file = local_dir.join("screen.png");

        // 确保本地目录存在
        let _ = std::fs::create_dir_all(&local_dir);

        // 步骤1：设备端截图
        let args = ["-t", serial, "shell", "screencap", "-p", remote_file];
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
            eprintln!("[screenshot] screencap failed: {}", stderr.trim());
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

        // 检查 PNG 头
        if data.len() < 4 || &data[0..4] != &[0x89, 0x50, 0x4E, 0x47] {
            eprintln!("[screenshot] Not PNG! {} bytes", data.len());
            return Err(HdcError::ExecutionFailed(format!("截图返回了非 PNG 数据 ({} bytes)", data.len())));
        }

        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        eprintln!("[screenshot] base64 {} chars ({}ms)", b64.len(), elapsed);
        Ok(b64)
    }

    /// 获取电池信息
    /// `hdc shell hidumper -s BatteryService`
    pub async fn get_battery_info(&self, serial: &str) -> HdcResult<String> {
        let output = self
            .shell_command(serial, "hidumper -s BatteryService")
            .await?;
        Ok(output)
    }

    /// 获取存储信息
    /// `hdc shell df`
    pub async fn get_storage_info(&self, serial: &str) -> HdcResult<String> {
        let output = self
            .shell_command(serial, "df /data 2>/dev/null || df /")
            .await?;
        Ok(output)
    }

    /// 获取内存信息
    /// `hdc shell hidumper -s MemMgrService`
    pub async fn get_memory_info(&self, serial: &str) -> HdcResult<String> {
        let output = self
            .shell_command(serial, "hidumper -s MemMgrService")
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

    // ==================== 工具方法 ====================

    /// 检查 HDC 是否可用
    pub async fn check_available(&self) -> bool {
        self.execute(&["version"]).await.is_ok()
    }

    /// 获取 HDC 版本
    pub async fn get_version(&self) -> HdcResult<String> {
        let output = self.execute(&["version"]).await?;
        Ok(output.trim().to_string())
    }
}
