use std::collections::HashMap;
use serde_json::{json, Value};
use tauri::{Emitter, State};
use tokio::sync::Mutex;
use tokio::process::Child;

use crate::adb::{AdbCommand, AdbDevice, AppInfo, ApkInfo, FileInfo, FpsRecord, PerformanceInfo, TopMemoryApp};
use crate::events::{
    DeviceConnected, DeviceDisconnected, InstallProgress, ShellOutput, TransferProgress,
    EVENT_DEVICE_CONNECTED, EVENT_DEVICE_DISCONNECTED, EVENT_INSTALL_PROGRESS,
    EVENT_SHELL_OUTPUT, EVENT_TRANSFER_PROGRESS,
};
use crate::state::AppState;

/// 全局存储 bugreport 子进程，用于取消
pub static BUGREPORT_CHILD: Mutex<Option<Child>> = Mutex::const_new(None);

/// 全局存储日志流子进程，用于取消
pub static LOGCAT_CHILD: Mutex<Option<Child>> = Mutex::const_new(None);

/// 获取已连接的设备列表（轻量版，只获取基本信息，不调用 getprop）
#[tauri::command]
pub async fn get_devices(state: State<'_, AppState>) -> Result<Vec<AdbDevice>, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    // 使用 adb devices -l 获取带基本信息的设备列表（轻量命令，不走信号量）
    let output = adb.execute_fast(&["devices", "-l"]).await.map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for line in output.lines().skip(1) {
        if line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let serial = parts[0].to_string();
        let status = parts[1].to_string();

        // 保留所有设备（包括 offline），前端需要显示 offline 设备
        if status != "device" && status != "offline" && status != "unauthorized" && status != "recovery" {
            continue;
        }

        let mut device = AdbDevice {
            serial: serial.clone(),
            status: status.clone(),
            ..Default::default()
        };

        // 从 -l 输出中解析基本信息
        // 格式: serial device product:model_name model:brand device:device usb:xxx
        for part in &parts[2..] {
            if let Some(val) = part.strip_prefix("model:") {
                device.model = val.to_string();
            } else if let Some(val) = part.strip_prefix("device:") {
                device.device_type = val.to_string();
            } else if let Some(val) = part.strip_prefix("product:") {
                if device.model.is_empty() {
                    device.model = val.to_string();
                }
            }
        }

        // brand 默认用 model 的第一段（大写）
        if device.brand.is_empty() && !device.model.is_empty() {
            device.brand = device.model.split_whitespace().next()
                .unwrap_or(&device.model)
                .to_uppercase();
        }

        result.push(device);
    }

    Ok(result)
}

/// 获取所有设备（Android + HarmonyOS）
#[tauri::command]
pub async fn get_all_devices(state: State<'_, AppState>) -> Result<Vec<serde_json::Value>, String> {
    let mut all_devices = Vec::new();

    // 并行获取 ADB 和 HDC 设备，避免 ADB 不可用时阻塞 HDC
    let adb_path = state.get_adb_path();
    let hdc_path = state.get_hdc_path();

    let adb_handle = tokio::spawn(async move {
        let adb = AdbCommand::new(&adb_path);
        adb.devices().await.ok()
    });

    let hdc_handle = tokio::spawn({
        let hdc_path = hdc_path.clone();
        async move {
            let hdc = crate::hdc::HdcCommand::new(&hdc_path);
            hdc.devices().await.ok()
        }
    });

    // ADB 设备
    if let Ok(Some(adb_devices)) = adb_handle.await {
        for device in adb_devices {
            all_devices.push(serde_json::to_value(device).unwrap_or_default());
        }
    }

    // HDC 设备（包含详细信息，3秒超时）
    if let Ok(Some(hdc_devices)) = hdc_handle.await {
        for device in hdc_devices {
            let device_status = device.status.clone();
            let serial_clone = device.serial.clone();
            let hdc_path_clone = hdc_path.clone();
            let mut detailed = match tokio::time::timeout(
                std::time::Duration::from_secs(3),
                crate::hdc::HdcCommand::new(&hdc_path_clone).get_device_info(&serial_clone)
            ).await {
                Ok(Ok(info)) => info,
                _ => {
                    if device.serial.is_empty() || device.serial.contains("[Fail]") {
                        continue;
                    }
                    eprintln!("[get_all_devices] get_device_info timeout for {}, using basic info", device.serial);
                    device
                }
            };
            detailed.status = device_status;
            // 即使 model/brand 为空也不跳过，至少显示 serial
            all_devices.push(serde_json::to_value(detailed).unwrap_or_default());
        }
    }

    Ok(all_devices)
}

/// 通过 WiFi 连接设备
#[tauri::command]
pub async fn connect_wifi_device(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    ip: String,
    port: Option<u16>,
) -> Result<String, String> {
    if !crate::utils::is_valid_ip(&ip) {
        return Err(format!("无效的 IP 地址: {}", ip));
    }

    let port = port.unwrap_or(5555);
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    let result = adb.connect_wifi(&ip, port).await.map_err(|e| e.to_string())?;

    // 获取设备信息并发送连接事件
    if let Ok(devices) = adb.devices().await {
        for (serial, _) in devices {
            if serial.contains(&ip) {
                if let Ok(device) = adb.get_device_info(&serial).await {
                    let _ = app.emit(
                        EVENT_DEVICE_CONNECTED,
                        DeviceConnected { device },
                    );
                }
                break;
            }
        }
    }

    Ok(result)
}

/// 断开设备连接
#[tauri::command]
pub async fn disconnect_device(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    serial: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    let result = adb.disconnect(&serial).await.map_err(|e| e.to_string())?;

    let _ = app.emit(
        EVENT_DEVICE_DISCONNECTED,
        DeviceDisconnected {
            serial: serial.clone(),
        },
    );

    Ok(result)
}

/// 安装应用（支持 .apk / .apks / .xapk / .apkm）
#[tauri::command]
pub async fn install_app(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    serial: String,
    file_path: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[install_app] Installing: {} to device: {}", file_path, serial);
    eprintln!("[install_app] File exists: {}", std::path::Path::new(&file_path).exists());

    let app_handle = app.clone();

    if AdbCommand::is_archive_apk(&file_path) {
        // 归档格式：.xapk / .apks / .apkm
        eprintln!("[install_app] Detected archive format, using install-multiple");

        // 获取设备 ABI 和 density 用于智能选择分包
        let device_abi = adb.get_cpu_architecture(&serial).await.ok();
        let device_density = adb.get_device_density(&serial).await.ok();

        eprintln!("[install_app] Device ABI: {:?}, density: {:?}", device_abi, device_density);

        let result = adb.install_archive(&serial, &file_path, device_abi.as_deref(), device_density.as_deref(), |percentage, message| {
            let _ = app_handle.emit(
                EVENT_INSTALL_PROGRESS,
                InstallProgress {
                    percentage,
                    message: message.to_string(),
                },
            );
        }).await.map_err(|e| {
            eprintln!("[install_app] Install failed: {}", e);
            e.to_string()
        })?;

        let _ = app.emit(
            EVENT_INSTALL_PROGRESS,
            InstallProgress {
                percentage: 100,
                message: "安装完成".to_string(),
            },
        );

        Ok(result)
    } else {
        // 普通 .apk 文件
        let result = adb.install_with_progress(&serial, &file_path, |percentage, message| {
            let _ = app_handle.emit(
                EVENT_INSTALL_PROGRESS,
                InstallProgress {
                    percentage,
                    message: message.to_string(),
                },
            );
        }).await.map_err(|e| {
            eprintln!("[install_app] Install failed: {}", e);
            e.to_string()
        })?;

        eprintln!("[install_app] Install result: {}", result);

        let _ = app.emit(
            EVENT_INSTALL_PROGRESS,
            InstallProgress {
                percentage: 100,
                message: "安装完成".to_string(),
            },
        );

        Ok(result)
    }
}

/// 卸载应用
#[tauri::command]
pub async fn uninstall_app(
    state: State<'_, AppState>,
    serial: String,
    package: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    adb.uninstall(&serial, &package).await.map_err(|e| e.to_string())
}

/// 获取已安装的应用列表（快速版：只返回包名和基本分类，详情异步加载）
#[tauri::command]
pub async fn get_installed_apps(
    state: State<'_, AppState>,
    serial: String,
    include_system: Option<bool>,
) -> Result<Vec<AppInfo>, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    let flag = if include_system.unwrap_or(false) { "" } else { "-3" };
    let cmd = format!("pm list packages -f {}", flag);
    eprintln!("[get_installed_apps] Executing: adb shell {}", cmd);
    let list_output = adb
        .shell_command(&serial, &cmd)
        .await
        .map_err(|e| {
            eprintln!("[get_installed_apps] Failed: {}", e);
            e.to_string()
        })?;

    eprintln!("[get_installed_apps] Got {} lines", list_output.lines().count());

    let mut apps = Vec::new();

    for line in list_output.lines() {
        let line = line.trim();
        if !line.starts_with("package:") {
            continue;
        }

        // 格式: package:/path/to/base.apk=com.example.pkg
        // 注意：路径中可能包含 '='（如 /data/app/~~xxx==/base.apk），
        // 所以必须用 rfind('=') 找到最后一个 '=' 作为分隔符
        let (apk_path, package) = if let Some(eq_pos) = line.rfind('=') {
            let pkg = &line[eq_pos + 1..];
            let path_part = &line[8..eq_pos]; // skip "package:"
            (path_part.to_string(), pkg.to_string())
        } else {
            let pkg = &line[8..];
            (String::new(), pkg.to_string())
        };

        if package.is_empty() {
            continue;
        }

        let is_system = apk_path.contains("/system/")
            || apk_path.contains("/vendor/")
            || apk_path.contains("/system_ext/");

        // 立即用包名最后一段作为显示名，后续可异步更新
        let display_name = if let Some(last) = package.rsplit('.').next() {
            let mut chars = last.chars();
            let first = chars.next().map(|c| c.to_uppercase().to_string()).unwrap_or_default();
            let rest: String = chars.collect();
            format!("{}{}", first, rest)
        } else {
            package.clone()
        };

        apps.push(AppInfo {
            package_name: package.clone(),
            app_name: display_name,
            version_name: String::new(),
            version_code: String::new(),
            icon_base64: None,
            install_time: String::new(),
            app_size: String::new(),
            is_system,
            uid: 0,
        });
    }

    eprintln!("[get_installed_apps] Returning {} apps (basic info only)", apps.len());
    Ok(apps)
}

/// 获取单个应用的详细信息（异步加载：名称、版本、大小等）
#[tauri::command]
pub async fn get_app_details(
    state: State<'_, AppState>,
    serial: String,
    package: String,
) -> Result<AppInfo, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[get_app_details] Getting details for: {}", package);

    let mut app_info = AppInfo {
        package_name: package.clone(),
        app_name: String::new(),
        version_name: String::new(),
        version_code: String::new(),
        icon_base64: None,
        install_time: String::new(),
        app_size: String::new(),
        is_system: false,
        uid: 0,
    };

    // 获取应用名称
    let label_cmd = format!("dumpsys package {} | grep -m1 'Application Label:'", package);
    if let Ok(label_output) = adb.shell_command(&serial, &label_cmd).await {
        let trimmed = label_output.trim();
        eprintln!("[get_app_details] Label raw output: '{}'", trimmed);
        if let Some(label) = trimmed.split("Application Label:").nth(1) {
            let name = label.trim().to_string();
            if !name.is_empty() {
                app_info.app_name = name;
                eprintln!("[get_app_details] Parsed label: '{}'", app_info.app_name);
            }
        }
    }

    // 获取版本等信息
    let ver_cmd = format!("dumpsys package {} | grep -E 'versionName=|versionCode=|firstInstallTime=|userId='", package);
    if let Ok(ver_output) = adb.shell_command(&serial, &ver_cmd).await {
        for line in ver_output.lines() {
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
            if line.contains("firstInstallTime=") {
                if let Some(t) = line.split('=').nth(1) {
                    app_info.install_time = t.trim().to_string();
                }
            }
            if line.contains("userId=") {
                if let Some(v) = line.split("userId=").nth(1) {
                    if let Ok(uid) = v.trim().parse::<u32>() {
                        app_info.uid = uid;
                    }
                }
            }
        }
    }

    // 获取应用大小
    let size_cmd = format!("du -s /data/data/{} 2>/dev/null || du -s /data/user/0/{} 2>/dev/null", package, package);
    if let Ok(size_output) = adb.shell_command(&serial, &size_cmd).await {
        for line in size_output.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if !parts.is_empty() {
                if let Ok(kb) = parts[0].parse::<u64>() {
                    app_info.app_size = crate::utils::format_file_size(kb * 1024);
                }
                break;
            }
        }
    }

    // Fallback
    if app_info.app_name.is_empty() {
        if let Some(last) = package.rsplit('.').next() {
            let mut chars = last.chars();
            let first = chars.next().map(|c| c.to_uppercase().to_string()).unwrap_or_default();
            let rest: String = chars.collect();
            app_info.app_name = format!("{}{}", first, rest);
        } else {
            app_info.app_name = package.clone();
        }
    }

    eprintln!("[get_app_details] Done: name={}, ver={}, size={}", 
        app_info.app_name, app_info.version_name, app_info.app_size);

    Ok(app_info)
}

/// 批量获取多个应用的详细信息（合并为一条 shell 命令执行）
#[tauri::command]
pub async fn get_apps_details_batch(
    state: State<'_, AppState>,
    serial: String,
    packages: Vec<String>,
) -> Result<Vec<AppInfo>, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    if packages.is_empty() {
        return Ok(Vec::new());
    }

    eprintln!("[get_apps_details_batch] Batch getting details for {} packages", packages.len());

    // 合并命令：echo MARKER_PKG; cmd; echo MARKER_PKG; cmd; ...
    let marker = "___PKG_SEP___";
    let mut combined_parts: Vec<String> = Vec::new();
    for pkg in &packages {
        combined_parts.push(format!("echo '{}{}'", marker, pkg));
        combined_parts.push(format!(
            "dumpsys package {} | grep -E 'Application Label:|versionName=|versionCode=|firstInstallTime=|userId=|flags=|codePath='",
            pkg
        ));
    }
    let combined_cmd = combined_parts.join("; ");

    // 一次性执行
    let output = adb.shell_command(&serial, &combined_cmd).await
        .map_err(|e| e.to_string())?;

    // 拆分结果：按 marker 分割
    let mut results: HashMap<String, AppInfo> = HashMap::new();

    let mut current_pkg: String = String::new();
    let mut current_lines: Vec<String> = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(pkg_name) = trimmed.strip_prefix(marker) {
            // 保存上一个包的结果
            if !current_pkg.is_empty() {
                results.insert(current_pkg.clone(), parse_app_detail_lines(&current_pkg, &current_lines));
            }
            current_pkg = pkg_name.to_string();
            current_lines.clear();
        } else if !current_pkg.is_empty() {
            current_lines.push(trimmed.to_string());
        }
    }
    // 最后一个包
    if !current_pkg.is_empty() {
        results.insert(current_pkg.clone(), parse_app_detail_lines(&current_pkg, &current_lines));
    }

    // 构建返回列表（保持原始顺序）
    let mut apps: Vec<AppInfo> = Vec::new();
    for pkg in &packages {
        if let Some(info) = results.remove(pkg) {
            apps.push(info);
        } else {
            // 解析失败，返回基本信息
            apps.push(AppInfo {
                package_name: pkg.clone(),
                app_name: pkg.rsplit('.').next()
                    .map(|s| {
                        let mut c = s.chars();
                        let f = c.next().map(|ch| ch.to_uppercase().to_string()).unwrap_or_default();
                        format!("{}{}", f, c.collect::<String>())
                    })
                    .unwrap_or_else(|| pkg.clone()),
                version_name: String::new(),
                version_code: String::new(),
                icon_base64: None,
                install_time: String::new(),
                app_size: String::new(),
                is_system: false,
                uid: 0,
            });
        }
    }

    eprintln!("[get_apps_details_batch] Done: {} packages processed", apps.len());
    Ok(apps)
}

/// 从 grep 输出行解析应用详情
fn parse_app_detail_lines(package: &str, lines: &[String]) -> AppInfo {
    let mut app_name = String::new();
    let mut version_name = String::new();
    let mut version_code = String::new();
    let mut install_time = String::new();
    let mut uid: u32 = 0;
    let mut is_system = false;
    let mut code_path = String::new();

    for line in lines {
        if let Some(label) = line.split("Application Label:").nth(1) {
            let name = label.trim().to_string();
            if !name.is_empty() {
                app_name = name;
            }
        }
        if let Some(v) = line.split("versionName=").nth(1) {
            version_name = v.split_whitespace().next().unwrap_or("").to_string();
        }
        if let Some(v) = line.split("versionCode=").nth(1) {
            version_code = v.split_whitespace().next().unwrap_or("").to_string();
        }
        if let Some(t) = line.split("firstInstallTime=").nth(1) {
            install_time = t.trim().to_string();
        }
        if let Some(v) = line.split("userId=").nth(1) {
            if let Ok(u) = v.trim().parse::<u32>() {
                uid = u;
            }
        }
        if let Some(v) = line.split("flags=").nth(1) {
            let flags_str = v.split_whitespace().next().unwrap_or("");
            // 系统应用标志包含 SYSTEM (0x400)
            if flags_str.contains("SYSTEM") {
                is_system = true;
            }
        }
        if let Some(v) = line.split("codePath=").nth(1) {
            code_path = v.trim().to_string();
        }
    }

    // 备用判断：codePath 包含 /system/ 或 /vendor/ 则为系统应用
    if !is_system && (code_path.contains("/system/") || code_path.contains("/vendor/")) {
        is_system = true;
    }

    if app_name.is_empty() {
        app_name = package.rsplit('.').next()
            .map(|s| {
                let mut c = s.chars();
                let f = c.next().map(|ch| ch.to_uppercase().to_string()).unwrap_or_default();
                format!("{}{}", f, c.collect::<String>())
            })
            .unwrap_or_else(|| package.to_string());
    }

    AppInfo {
        package_name: package.to_string(),
        app_name,
        version_name,
        version_code,
        icon_base64: None,
        install_time,
        app_size: String::new(),
        is_system,
        uid,
    }
}

/// 启动应用
#[tauri::command]
pub async fn start_application(
    state: State<'_, AppState>,
    serial: String,
    package: String,
    activity: Option<String>,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    if let Some(act) = activity {
        adb.start_app(&serial, &package, &act)
            .await
            .map_err(|e| e.to_string())
    } else {
        adb.start_app_monkey(&serial, &package)
            .await
            .map_err(|e| e.to_string())
    }
}

/// 停止应用
#[tauri::command]
pub async fn stop_application(
    state: State<'_, AppState>,
    serial: String,
    package: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    adb.stop_app(&serial, &package).await.map_err(|e| e.to_string())
}

/// 清除应用数据
#[tauri::command]
pub async fn clear_app_data(
    state: State<'_, AppState>,
    serial: String,
    package: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    adb.clear_app_data(&serial, &package)
        .await
        .map_err(|e| e.to_string())
}

/// 获取设备详细信息
#[tauri::command]
pub async fn get_device_details(
    state: State<'_, AppState>,
    serial: String,
) -> Result<AdbDevice, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    adb.get_device_info(&serial).await.map_err(|e| e.to_string())
}

/// 获取设备基本属性（轻量版：model, brand, android_version, sdk, device_type）
#[tauri::command]
pub async fn get_device_props(
    state: State<'_, AppState>,
    serial: String,
) -> Result<AdbDevice, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    adb.get_device_props(&serial).await.map_err(|e| e.to_string())
}

/// 截屏
#[tauri::command]
pub async fn take_screenshot(
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    adb.screenshot(&serial).await.map_err(|e| e.to_string())
}

/// 从设备拉取文件
#[tauri::command]
pub async fn pull_file(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    serial: String,
    remote_path: String,
    local_path: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    let _ = app.emit(
        EVENT_TRANSFER_PROGRESS,
        TransferProgress {
            percentage: 0,
            bytes_transferred: 0,
            total_bytes: 0,
            message: "开始拉取文件...".to_string(),
        },
    );

    let result = adb.pull_file(&serial, &remote_path, &local_path).await;

    let _ = app.emit(
        EVENT_TRANSFER_PROGRESS,
        TransferProgress {
            percentage: 100,
            bytes_transferred: 0,
            total_bytes: 0,
            message: "文件拉取完成".to_string(),
        },
    );

    result.map_err(|e| e.to_string())
}

/// 推送文件到设备
#[tauri::command]
pub async fn push_file(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    serial: String,
    local_path: String,
    remote_path: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    // 获取本地文件大小
    let file_size = tokio::fs::metadata(&local_path)
        .await
        .map(|m| m.len())
        .unwrap_or(0);

    let _ = app.emit(
        EVENT_TRANSFER_PROGRESS,
        TransferProgress {
            percentage: 0,
            bytes_transferred: 0,
            total_bytes: file_size,
            message: "开始推送文件...".to_string(),
        },
    );

    let result = adb.push_file(&serial, &local_path, &remote_path).await;

    let _ = app.emit(
        EVENT_TRANSFER_PROGRESS,
        TransferProgress {
            percentage: 100,
            bytes_transferred: file_size,
            total_bytes: file_size,
            message: "文件推送完成".to_string(),
        },
    );

    result.map_err(|e| e.to_string())
}

/// 执行 Shell 命令
#[tauri::command]
pub async fn execute_shell(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    serial: String,
    command: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    let output = adb.shell_command_direct(&serial, &command).await.map_err(|e| e.to_string())?;

    // 发送 shell 输出事件
    let _ = app.emit(EVENT_SHELL_OUTPUT, ShellOutput { output: output.clone() });

    Ok(output)
}

/// 获取 logcat 日志
#[tauri::command]
pub async fn get_logcat(
    state: State<'_, AppState>,
    serial: String,
    lines: Option<u32>,
) -> Result<String, String> {
    // 先检查是否为 HarmonyOS 设备
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    if let Ok(devices) = hdc.devices().await {
            if devices.iter().any(|d| d.serial == serial) {
                // HarmonyOS 设备使用 hilog
                let line_count = lines.unwrap_or(100);
                let output = hdc.shell_command(&serial, &format!("hilog -z {}", line_count)).await
                    .map_err(|e| e.to_string())?;
                return Ok(output);
            }
        }

    // Android 设备使用 logcat
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    let line_count = lines.unwrap_or(100);
    adb.logcat(&serial, line_count).await.map_err(|e| e.to_string())
}

/// 启动实时日志流
#[tauri::command]
pub async fn start_logcat_stream(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    serial: String,
) -> Result<(), String> {
    // 先停止之前的日志流
    stop_logcat_stream().await?;

    // 检查是否为 HarmonyOS 设备
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    if let Ok(devices) = hdc.devices().await {
        if devices.iter().any(|d| d.serial == serial) {
            // HarmonyOS 设备使用 hilog -x
            let child = hdc.start_logcat_stream(&serial).await.map_err(|e| e.to_string())?;
            
            // 存储子进程
            let mut logcat_child = LOGCAT_CHILD.lock().await;
            *logcat_child = Some(child);
            drop(logcat_child);

            // 读取日志流
            tokio::spawn(async move {
                let child = {
                    let mut logcat_child = LOGCAT_CHILD.lock().await;
                    logcat_child.take()
                };

                if let Some(mut child) = child {
                    let stdout = child.stdout.take().unwrap();
                    let reader = tokio::io::BufReader::new(stdout);
                    let mut lines = tokio::io::AsyncBufReadExt::lines(reader);

                    while let Ok(Some(line)) = lines.next_line().await {
                        // 发送日志事件
                        let _ = app.emit("log-output", crate::events::LogOutput { line });
                    }
                }
            });

            return Ok(());
        }
    }

    // Android 设备暂不支持实时日志流
    Ok(())
}

/// 停止实时日志流
#[tauri::command]
pub async fn stop_logcat_stream() -> Result<(), String> {
    let mut logcat_child = LOGCAT_CHILD.lock().await;
    if let Some(mut child) = logcat_child.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// 获取性能信息（CPU、内存、电池、存储）
#[tauri::command]
pub async fn get_performance_info(
    state: State<'_, AppState>,
    serial: String,
) -> Result<PerformanceInfo, String> {
    // 鸿蒙设备暂不支持 ADB 性能监控，返回默认值
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    if let Ok(devices) = hdc.devices().await {
        if devices.iter().any(|d| d.serial == serial) {
            eprintln!("[get_performance_info] HarmonyOS device {}, skipping ADB commands", serial);
            return Ok(PerformanceInfo {
                cpu_usage: 0.0,
                memory_total: String::new(),
                memory_used: String::new(),
                memory_free: String::new(),
                memory_total_bytes: 0,
                memory_used_bytes: 0,
                memory_free_bytes: 0,
                battery_level: 0,
                battery_temperature: String::new(),
                battery_status: String::new(),
                storage_total: String::new(),
                storage_used: String::new(),
                storage_free: String::new(),
                storage_total_bytes: 0,
                storage_used_bytes: 0,
                storage_free_bytes: 0,
            });
        }
    }

    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[get_performance_info] Starting for device: {}", serial);

    // 顺序执行，避免并发 ADB 命令导致设备掉线
    let cpu_result = adb.get_cpu_usage(&serial).await;
    eprintln!("[get_performance_info] CPU result: {:?}", cpu_result);

    let memory_result = adb.get_memory_info(&serial).await;
    eprintln!("[get_performance_info] Memory result: {:?}", memory_result);

    let battery_result = adb.get_battery_info(&serial).await;
    eprintln!("[get_performance_info] Battery result: {:?}", battery_result);

    let storage_result = adb.get_storage_info(&serial).await;
    eprintln!("[get_performance_info] Storage result: {:?}", storage_result);

    let cpu_usage = cpu_result.unwrap_or(0.0);
    let (mem_total, mem_used, mem_free) = memory_result.unwrap_or((0, 0, 0));
    let battery = battery_result.unwrap_or_else(|e| {
        eprintln!("[get_performance_info] Battery error: {}, using default", e);
        crate::adb::BatteryInfo {
            level: 0,
            temperature: None,
            status: String::new(),
            health: String::new(),
            voltage: 0,
            technology: String::new(),
        }
    });
    let (storage_total, storage_available) = storage_result.unwrap_or_else(|e| {
        eprintln!("[get_performance_info] Storage error: {}, using default", e);
        (0, 0)
    });
    let storage_used = storage_total.saturating_sub(storage_available);

    let battery_temperature = match battery.temperature {
        Some(temp) => format!("{:.1}°C", temp),
        None => String::new(),
    };

    eprintln!("[get_performance_info] Final values: cpu={}, mem={}/{}/{}, battery={}%, storage={}/{}", 
        cpu_usage, mem_total, mem_used, mem_free, battery.level, storage_total, storage_available);

    Ok(PerformanceInfo {
        cpu_usage,
        memory_total: crate::utils::format_file_size(crate::utils::round_up_memory_gb(mem_total)),
        memory_used: crate::utils::format_file_size(mem_used),
        memory_free: crate::utils::format_file_size(mem_free),
        memory_total_bytes: crate::utils::round_up_memory_gb(mem_total),
        memory_used_bytes: mem_used,
        memory_free_bytes: mem_free,
        battery_level: battery.level,
        battery_temperature,
        battery_status: battery.status,
        storage_total: crate::utils::format_file_size(storage_total),
        storage_used: crate::utils::format_file_size(storage_used),
        storage_free: crate::utils::format_file_size(storage_available),
        storage_total_bytes: storage_total,
        storage_used_bytes: storage_used,
        storage_free_bytes: storage_available,
    })
}

/// 获取文件列表
#[tauri::command]
pub async fn get_file_list(
    state: State<'_, AppState>,
    serial: String,
    path: String,
) -> Result<Vec<FileInfo>, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    adb.get_file_list(&serial, &path).await.map_err(|e| e.to_string())
}

/// 解析本地 APK 文件信息（支持 .apk / .xapk / .apks / .apkm / .hap）
#[tauri::command]
pub async fn parse_apk_info(state: State<'_, AppState>, file_path: String) -> Result<ApkInfo, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[parse_apk_info] Parsing: {}", file_path);
    eprintln!("[parse_apk_info] File exists: {}", std::path::Path::new(&file_path).exists());

    if let Ok(metadata) = std::fs::metadata(&file_path) {
        eprintln!("[parse_apk_info] File size: {} bytes", metadata.len());
    }

    // xapk/apks/apkm 格式：从 manifest.json 读取信息
    if AdbCommand::is_archive_apk(&file_path) {
        eprintln!("[parse_apk_info] Detected archive format, reading manifest...");
        let mut result = adb.parse_xapk_info_local(&file_path);

        // 如果 manifest 中没有 min_sdk_version，尝试从 base APK 中提取
        if let Ok(ref mut info) = result {
            if info.min_sdk_version.is_none() {
                eprintln!("[parse_apk_info] min_sdk not in manifest, extracting from base APK...");
                if let Ok(base_info) = adb.extract_xapk_base_apk_info(&file_path).await {
                    if base_info.min_sdk_version.is_some() {
                        info.min_sdk_version = base_info.min_sdk_version;
                    }
                    if base_info.target_sdk_version.is_some() {
                        info.target_sdk_version = base_info.target_sdk_version;
                    }
                    // 如果 manifest 中没有权限，从 base APK 补充
                    if info.permissions.is_empty() && !base_info.permissions.is_empty() {
                        info.permissions = base_info.permissions;
                    }
                    eprintln!("[parse_apk_info] Base APK min_sdk: {:?}, target_sdk: {:?}",
                        info.min_sdk_version, info.target_sdk_version);
                }
            }
        }

        match &result {
            Ok(info) => {
                eprintln!("[parse_apk_info] Success: name={}, pkg={}, version={}, min_sdk={:?}",
                    info.app_name, info.package_name, info.version_name, info.min_sdk_version);
            }
            Err(e) => {
                eprintln!("[parse_apk_info] Error: {}", e);
            }
        }
        return result.map_err(|e| e.to_string());
    }

    // 普通 .apk 或 .hap 格式
    let result = adb.parse_apk_info_local(&file_path).await;
    match &result {
        Ok(info) => {
            eprintln!("[parse_apk_info] Success: name={}, pkg={}, version={}",
                info.app_name, info.package_name, info.version_name);
        }
        Err(e) => {
            eprintln!("[parse_apk_info] Error: {}", e);
        }
    }
    result.map_err(|e| e.to_string())
}

/// 检查 ADB 是否可用
#[tauri::command]
pub async fn check_adb_available(state: State<'_, AppState>) -> Result<bool, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    Ok(adb.check_available().await)
}

/// 获取连接指南
#[tauri::command]
pub async fn get_connection_guide() -> Result<Value, String> {
    let guide = json!({
        "steps": [
            {
                "title": "USB 连接",
                "description": "使用 USB 数据线连接手机和电脑",
                "icon": "usb"
            },
            {
                "title": "开启开发者选项",
                "description": "进入 设置 > 关于手机 > 连续点击「版本号」7 次以开启开发者选项",
                "icon": "settings"
            },
            {
                "title": "启用 USB 调试",
                "description": "进入 设置 > 开发者选项 > 打开「USB 调试」开关",
                "icon": "debug"
            },
            {
                "title": "授权电脑",
                "description": "连接后手机会弹出授权提示，点击「允许」即可",
                "icon": "authorize"
            },
            {
                "title": "WiFi 连接（可选）",
                "description": "在 USB 连接状态下，可以使用 WiFi 连接功能切换为无线调试",
                "icon": "wifi"
            }
        ],
        "troubleshooting": [
            {
                "problem": "设备未显示在列表中",
                "solution": "请确保已安装正确的 USB 驱动程序，并尝试更换 USB 线或端口"
            },
            {
                "problem": "显示「unauthorized」",
                "solution": "请在手机上查看并允许 USB 调试授权弹窗"
            },
            {
                "problem": "ADB 命令执行失败",
                "solution": "请确保 ADB 已正确安装并添加到系统 PATH 环境变量中"
            },
            {
                "problem": "WiFi 连接失败",
                "solution": "请确保手机和电脑在同一局域网内，且手机 WiFi 已开启"
            }
        ]
    });

    Ok(guide)
}

/// 设置当前设备
#[tauri::command]
pub async fn set_current_device(
    state: State<'_, AppState>,
    serial: Option<String>,
) -> Result<(), String> {
    state.set_current_device(serial);
    Ok(())
}

/// 获取当前设备
#[tauri::command]
pub async fn get_current_device(state: State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(state.get_current_device())
}

/// 设置 ADB 路径
#[tauri::command]
pub async fn set_adb_path(state: State<'_, AppState>, path: String) -> Result<(), String> {
    state.set_adb_path(path);
    Ok(())
}

/// 获取 ADB 路径
#[tauri::command]
pub async fn get_adb_path(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.get_adb_path())
}

/// 获取 ADB 版本
#[tauri::command]
pub async fn get_adb_version(state: State<'_, AppState>) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    adb.get_version().await.map_err(|e| e.to_string())
}

/// 获取 HDC 版本
#[tauri::command]
pub async fn get_hdc_version(state: State<'_, AppState>) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);

    hdc.get_version().await.map_err(|e| e.to_string())
}

/// 启用 WiFi ADB
#[tauri::command]
pub async fn enable_wifi_adb(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    serial: String,
    port: Option<u16>,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    let port = port.unwrap_or(5555);
    let result = adb.enable_wifi_adb(&serial, port).await.map_err(|e| e.to_string())?;

    // 发送设备刷新事件
    let _ = app.emit("device-refresh", ());

    Ok(result)
}

/// 获取设备 IP 地址
#[tauri::command]
pub async fn get_device_ip(
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    adb.get_device_ip(&serial).await.map_err(|e| e.to_string())
}

/// 获取电池信息
#[tauri::command]
pub async fn get_battery_info(
    state: State<'_, AppState>,
    serial: String,
) -> Result<Value, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    let battery = adb.get_battery_info(&serial).await.map_err(|e| e.to_string())?;
    serde_json::to_value(battery).map_err(|e| e.to_string())
}

/// 获取存储信息
#[tauri::command]
pub async fn get_storage_info(
    state: State<'_, AppState>,
    serial: String,
) -> Result<Value, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    let (total, available) = adb.get_storage_info(&serial).await.map_err(|e| e.to_string())?;
    let used = total.saturating_sub(available);

    Ok(json!({
        "total": total,
        "used": used,
        "available": available,
        "total_formatted": crate::utils::format_file_size(total),
        "used_formatted": crate::utils::format_file_size(used),
        "available_formatted": crate::utils::format_file_size(available),
    }))
}

/// 获取内存信息
#[tauri::command]
pub async fn get_memory_info(
    state: State<'_, AppState>,
    serial: String,
) -> Result<Value, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    let (total, used, free) = adb.get_memory_info(&serial).await.map_err(|e| e.to_string())?;

    Ok(json!({
        "total": total,
        "used": used,
        "free": free,
        "total_formatted": crate::utils::format_file_size(total),
        "used_formatted": crate::utils::format_file_size(used),
        "free_formatted": crate::utils::format_file_size(free),
    }))
}

/// 获取 Android 设备完整信息（一条命令获取全部）
#[tauri::command]
pub async fn get_android_base_info(
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    let cmd = r#"
echo '=== Device Info ==='
echo "MARKET_NAME=$(getprop ro.product.marketname 2>/dev/null)"
echo "MODEL=$(getprop ro.product.model)"
echo "BRAND=$(getprop ro.product.brand)"
echo "ANDROID=$(getprop ro.build.version.release)"
echo "SDK=$(getprop ro.build.version.sdk)"
echo "PATCH=$(getprop ro.build.version.security_patch)"
echo "BUILD=$(getprop ro.build.display.id)"
echo "SERIAL=$(getprop ro.serialno)"
echo '=== Screen ==='
echo "RESOLUTION=$(wm size 2>/dev/null | grep -o '[0-9]*x[0-9]*')"
echo "DENSITY=$(wm density 2>/dev/null | awk '{print $NF}')"
echo "REFRESH=$(dumpsys display 2>/dev/null | grep 'fps=' | head -1 | sed 's/.*fps=\([0-9.]*\).*/\1/' || dumpsys window displays 2>/dev/null | grep 'refreshRate=' | head -1 | sed 's/.*refreshRate=\([0-9.]*\).*/\1/')"
echo '=== CPU ==='
echo "HARDWARE=$(cat /proc/cpuinfo 2>/dev/null | grep 'Hardware' | head -1 | sed 's/Hardware\s*:\s*//')"
echo "PROCESSOR=$(cat /proc/cpuinfo 2>/dev/null | grep 'Processor' | head -1 | sed 's/Processor\s*:\s*//')"
echo "CPU_PLATFORM=$(getprop ro.board.platform)"
echo "CORES=$(ls -d /sys/devices/system/cpu/cpu[0-9]* 2>/dev/null | wc -l)"
echo "MAX_FREQ=$(cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq 2>/dev/null | awk '{printf "%.0f MHz", $1/1000}')"
echo "GPU=$(dumpsys SurfaceFlinger 2>/dev/null | grep GLES | head -1 | sed 's/.*GLES\s*:\s*//')"
echo '=== Memory ==='
echo "MEM_TOTAL=$(cat /proc/meminfo 2>/dev/null | grep MemTotal | awk '{printf "%.1f GB", $2/1024/1024}')"
echo "MEM_AVAIL=$(cat /proc/meminfo 2>/dev/null | grep MemAvailable | awk '{printf "%.1f GB", $2/1024/1024}')"
echo '=== Storage ==='
echo "STORAGE=$(df -h /data 2>/dev/null | tail -1 | awk '{print $2, $4}')"
echo '=== Battery ==='
echo "BAT_LEVEL=$(dumpsys battery 2>/dev/null | grep 'level' | awk '{print $2}')"
echo "BAT_STATUS=$(dumpsys battery 2>/dev/null | grep 'status' | awk '{print $2}')"
echo "BAT_HEALTH=$(dumpsys battery 2>/dev/null | grep 'health' | awk '{print $2}')"
echo "BAT_TEMP=$(dumpsys battery 2>/dev/null | grep 'temperature' | awk '{print $2}')"
echo "BAT_VOLTAGE=$(dumpsys battery 2>/dev/null | grep 'voltage' | awk '{print $2}')"
echo '=== Network ==='
echo "WIFI_IP=$(ifconfig wlan0 2>/dev/null | grep 'inet addr' | awk '{print $2}' | sed 's/addr://' || ip addr show wlan0 2>/dev/null | grep 'inet ' | awk '{print $2}')"
echo '=== ABI ==='
echo "ABI_LIST=$(getprop ro.product.cpu.abilist)"
echo "ABI_PRIMARY=$(getprop ro.product.cpu.abi)"
echo '=== Kernel ==='
echo "KERNEL=$(uname -r 2>/dev/null)"
echo '=== Uptime ==='
echo "UPTIME=$(uptime 2>/dev/null)"
"#.trim();

    adb.execute(&["-s", &serial, "shell", cmd]).await.map_err(|e| e.to_string())
}

// ==================== Feature 1: 重启命令 ====================

/// 重启设备
#[tauri::command]
pub async fn reboot(
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[reboot] Rebooting device: {}", serial);
    adb.reboot(&serial).await.map_err(|e| e.to_string())
}

/// 重启到 Recovery 模式
#[tauri::command]
pub async fn reboot_recovery(
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[reboot_recovery] Rebooting device {} to recovery", serial);
    adb.reboot_recovery(&serial).await.map_err(|e| e.to_string())
}

/// 重启到 Bootloader 模式
#[tauri::command]
pub async fn reboot_bootloader(
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[reboot_bootloader] Rebooting device {} to bootloader", serial);
    adb.reboot_bootloader(&serial).await.map_err(|e| e.to_string())
}

/// 重置 ADB 服务
#[tauri::command]
pub async fn reset_adb(
    state: State<'_, AppState>,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[reset_adb] Resetting ADB server");
    adb.reset_adb().await.map_err(|e| e.to_string())
}

// ==================== Feature 3: 帧率检测 ====================

/// 启动 FPS 监控（基于 SurfaceFlinger --latency，无需包名）
#[tauri::command]
pub async fn start_fps_monitor(
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();

    // key 只用 serial（不再依赖包名）
    let key = serial.clone();

    // 检查是否已有监控在运行
    {
        let mut handles = state.fps_handles.lock().map_err(|e| e.to_string())?;
        if handles.contains_key(&key) {
            return Err(format!("FPS 监控已在运行: {}", key));
        }
        // 清理同设备的旧监控（兼容旧格式 serial:package）
        let old_keys: Vec<String> = handles.keys()
            .filter(|k| **k == serial || k.starts_with(&format!("{}:", serial)))
            .cloned()
            .collect();
        for old_key in old_keys {
            eprintln!("[start_fps_monitor] Cleaning up old monitor: {}", old_key);
            if let Some(h) = handles.remove(&old_key) {
                h.abort();
            }
        }
    }

    // 初始化 FPS 数据
    {
        let mut data = state.fps_data.lock().map_err(|e| e.to_string())?;
        data.insert(key.clone(), Vec::new());
    }

    let fps_data = state.fps_data.clone();
    let fps_handles = state.fps_handles.clone();
    let adb_path_clone = adb_path.clone();
    let serial_clone = serial.clone();
    let key_clone = key.clone();

    let handle = tokio::spawn(async move {
        let adb = AdbCommand::new(&adb_path_clone);
        let start_time = std::time::Instant::now();

        eprintln!("[start_fps_monitor] Starting FPS monitor for {} (SurfaceFlinger latency mode)", serial_clone);

        // 记录上一次 latency 的时间戳，用于增量去重
        let mut last_latency_ts: Vec<u64> = Vec::new();

        loop {
            tokio::time::sleep(std::time::Duration::from_millis(1000)).await;

            // 检查是否已被取消
            {
                let handles = fps_handles.lock().unwrap_or_else(|e| e.into_inner());
                if !handles.contains_key(&key_clone) {
                    eprintln!("[start_fps_monitor] Monitor stopped for {}", key_clone);
                    break;
                }
            }

            // 获取 SurfaceFlinger latency 数据
            let latency_result = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                adb.get_surfaceflinger_latency(&serial_clone)
            ).await
            .ok()
            .and_then(|r| r.ok());

            let fps = if let Some(ref latency_raw) = latency_result {
                // 提取当前所有有效时间戳（第二列 actual present time）
                let mut current_ts: Vec<u64> = Vec::new();
                for line in latency_raw.lines() {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 3 {
                        if let Ok(t) = parts[1].parse::<u64>() {
                            if t < 9223372036854775807u64 {
                                current_ts.push(t);
                            }
                        }
                    }
                }

                // 增量检测：取比上次最大时间戳更大的帧（时间戳单调递增）
                let last_max = last_latency_ts.iter().copied().max().unwrap_or(0);
                let new_frames: Vec<u64> = current_ts.iter()
                    .filter(|ts| **ts > last_max)
                    .cloned()
                    .collect();

                // 更新上次最大时间戳
                if let Some(&new_max) = current_ts.iter().max() {
                    last_latency_ts = vec![new_max];
                }

                if new_frames.len() >= 2 {
                    // 用增量帧的时间差计算 FPS
                    let mut total_delta: u64 = 0;
                    let mut count = 0;
                    for i in 1..new_frames.len() {
                        let delta = new_frames[i].saturating_sub(new_frames[i - 1]);
                        if delta > 0 && delta < 1_000_000_000u64 {
                            total_delta += delta;
                            count += 1;
                        }
                    }
                    if count > 0 {
                        let avg_ns = total_delta as f64 / count as f64;
                        let fps = 1_000_000_000.0 / avg_ns;
                        if fps > 0.0 && fps < 500.0 {
                            Some(fps as f32)
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    None
                }
            } else {
                None
            };

            let elapsed_ms = start_time.elapsed().as_millis() as f64;

            if let Some(fps_val) = fps {
                let record = FpsRecord {
                    timestamp: elapsed_ms,
                    fps: fps_val,
                    foreground_app: serial_clone.clone(),
                };

                eprintln!("[start_fps_monitor] FPS: {:.1} at {:.0}ms", fps_val, elapsed_ms);

                if let Ok(mut data) = fps_data.lock() {
                    if let Some(records) = data.get_mut(&key_clone) {
                        records.push(record);
                        if records.len() > 3600 {
                            records.drain(..records.len() - 3600);
                        }
                    }
                }
            }
            // 无新帧时不记录（屏幕静止时 SurfaceFlinger 不会产生新帧）
        }
    });

    // 保存 handle
    {
        let mut handles = state.fps_handles.lock().map_err(|e| e.to_string())?;
        handles.insert(key.clone(), handle);
    }

    eprintln!("[start_fps_monitor] FPS monitor started for device: {}", key);
    Ok(format!("FPS 监控已启动: {}", key))
}

/// 停止 FPS 监控
#[tauri::command]
pub async fn stop_fps_monitor(
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let key = serial.clone();

    eprintln!("[stop_fps_monitor] Stopping FPS monitor for {}", key);

    let handle = {
        let mut handles = state.fps_handles.lock().map_err(|e| e.to_string())?;
        handles.remove(&key)
    };

    if let Some(handle) = handle {
        handle.abort();
        eprintln!("[stop_fps_monitor] Monitor aborted for {}", key);
    }

    Ok(format!("FPS 监控已停止: {}", key))
}

/// 获取 FPS 数据
#[tauri::command]
pub async fn get_fps_data(
    state: State<'_, AppState>,
    serial: String,
) -> Result<Vec<FpsRecord>, String> {
    let data = state.fps_data.lock().map_err(|e| e.to_string())?;

    let mut all_records = Vec::new();
    for (key, records) in data.iter() {
        // 兼容新旧格式：新格式 key=serial，旧格式 key=serial:package
        if key == &serial || key.starts_with(&format!("{}:", serial)) {
            all_records.extend(records.clone());
        }
    }

    eprintln!("[get_fps_data] Returning {} records for device {}", all_records.len(), serial);
    Ok(all_records)
}

// ==================== Feature 4: 增强设备信息 ====================

/// 获取内存占用 Top 应用
#[tauri::command]
pub async fn get_top_memory_apps(
    state: State<'_, AppState>,
    serial: String,
) -> Result<Vec<TopMemoryApp>, String> {
    // 鸿蒙设备暂不支持 ADB 内存查询
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    if let Ok(devices) = hdc.devices().await {
        if devices.iter().any(|d| d.serial == serial) {
            eprintln!("[get_top_memory_apps] HarmonyOS device {}, skipping ADB commands", serial);
            return Ok(vec![]);
        }
    }

    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[get_top_memory_apps] Getting top memory apps for device: {}", serial);
    adb.get_top_memory_apps(&serial).await.map_err(|e| e.to_string())
}

/// 获取 CPU 架构
#[tauri::command]
pub async fn get_cpu_architecture(
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[get_cpu_architecture] Getting CPU architecture for device: {}", serial);
    adb.get_cpu_architecture(&serial).await.map_err(|e| e.to_string())
}

/// 获取屏幕分辨率
#[tauri::command]
pub async fn get_screen_resolution(
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[get_screen_resolution] Getting resolution for device: {}", serial);
    adb.get_screen_resolution(&serial).await.map_err(|e| e.to_string())
}

/// 获取屏幕旋转方向
#[tauri::command]
pub async fn get_screen_rotation(
    state: State<'_, AppState>,
    serial: String,
) -> Result<u32, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    adb.get_screen_rotation(&serial).await.map_err(|e| e.to_string())
}

/// 设置屏幕分辨率和密度
#[tauri::command]
pub async fn set_screen_resolution(
    state: State<'_, AppState>,
    serial: String,
    width: u32,
    height: u32,
    density: u32,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[set_screen_resolution] Setting resolution {}x{} density {} for device: {}",
        width, height, density, serial);
    adb.set_screen_resolution(&serial, width, height, density)
        .await
        .map_err(|e| e.to_string())
}

/// 恢复设备原分辨率
#[tauri::command]
pub async fn reset_screen_resolution(
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[reset_screen_resolution] Resetting resolution for device: {}", serial);
    adb.reset_screen_resolution(&serial).await.map_err(|e| e.to_string())
}

/// 获取当前前台应用
#[tauri::command]
pub async fn get_running_apps(
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[get_running_apps] Getting running apps for device: {}", serial);
    adb.get_running_apps(&serial).await.map_err(|e| e.to_string())
}

// ==================== Feature 5: 设备控制 ====================

/// 发送点击事件
#[tauri::command]
pub async fn send_tap(
    state: State<'_, AppState>,
    serial: String,
    x: u32,
    y: u32,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[send_tap] Tapping at ({}, {}) on device: {}", x, y, serial);
    adb.send_tap(&serial, x, y).await.map_err(|e| e.to_string())
}

/// 发送滑动事件
#[tauri::command]
pub async fn send_swipe(
    state: State<'_, AppState>,
    serial: String,
    x1: u32,
    y1: u32,
    x2: u32,
    y2: u32,
    duration_ms: u32,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[send_swipe] Swiping from ({}, {}) to ({}, {}) duration={}ms on device: {}",
        x1, y1, x2, y2, duration_ms, serial);
    adb.send_swipe(&serial, x1, y1, x2, y2, duration_ms)
        .await
        .map_err(|e| e.to_string())
}

/// 发送按键事件
#[tauri::command]
pub async fn send_keyevent(
    state: State<'_, AppState>,
    serial: String,
    keycode: u32,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[send_keyevent] Sending keyevent {} to device: {}", keycode, serial);
    adb.send_keyevent(&serial, keycode).await.map_err(|e| e.to_string())
}

/// 发送文本输入
#[tauri::command]
pub async fn send_text(
    state: State<'_, AppState>,
    serial: String,
    text: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[send_text] Sending text to device: {}", serial);
    adb.send_text(&serial, &text).await.map_err(|e| e.to_string())
}

/// 设置屏幕亮度
#[tauri::command]
pub async fn set_brightness(
    state: State<'_, AppState>,
    serial: String,
    level: u32,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[set_brightness] Setting brightness to {} on device: {}", level, serial);
    adb.set_brightness(&serial, level).await.map_err(|e| e.to_string())
}

/// 获取屏幕亮度
#[tauri::command]
pub async fn get_brightness(
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[get_brightness] Getting brightness for device: {}", serial);
    adb.get_brightness(&serial).await.map_err(|e| e.to_string())
}

/// 设置音量
#[tauri::command]
pub async fn set_volume(
    state: State<'_, AppState>,
    serial: String,
    level: u32,
    stream: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[set_volume] Setting volume to {} (stream={}) on device: {}", level, stream, serial);
    adb.set_volume(&serial, level, &stream).await.map_err(|e| e.to_string())
}

/// 获取 WiFi 状态
#[tauri::command]
pub async fn get_wifi_state(
    state: State<'_, AppState>,
    serial: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[get_wifi_state] Getting WiFi state for device: {}", serial);
    adb.get_wifi_state(&serial).await.map_err(|e| e.to_string())
}

/// 获取音量
#[tauri::command]
pub async fn get_volume(
    state: State<'_, AppState>,
    serial: String,
    stream: String,
) -> Result<u32, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[get_volume] Getting volume for device: {}", serial);
    adb.get_volume(&serial, &stream).await.map_err(|e| e.to_string())
}

/// 获取飞行模式状态
#[tauri::command]
pub async fn get_airplane_mode(
    state: State<'_, AppState>,
    serial: String,
) -> Result<bool, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[get_airplane_mode] Getting airplane mode for device: {}", serial);
    adb.get_airplane_mode(&serial).await.map_err(|e| e.to_string())
}

/// 设置 WiFi 状态
#[tauri::command]
pub async fn set_wifi_state(
    state: State<'_, AppState>,
    serial: String,
    enabled: bool,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[set_wifi_state] Setting WiFi to {} on device: {}", enabled, serial);
    adb.set_wifi_state(&serial, enabled).await.map_err(|e| e.to_string())
}

/// 设置飞行模式
#[tauri::command]
pub async fn set_airplane_mode(
    state: State<'_, AppState>,
    serial: String,
    enabled: bool,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[set_airplane_mode] Setting airplane mode to {} on device: {}", enabled, serial);
    adb.set_airplane_mode(&serial, enabled).await.map_err(|e| e.to_string())
}

// ==================== 实时屏幕流（JPEG 截图） ====================

/// JPEG 帧事件
#[derive(Clone, serde::Serialize)]
pub struct ScreenFrame {
    pub data: String,  // base64 编码的 JPEG 数据
    pub width: u32,
    pub height: u32,
}

/// 屏幕流错误事件
#[derive(Clone, serde::Serialize)]
pub struct ScreenError {
    pub message: String,
}

/// 启动实时屏幕流（JPEG 截图循环）
#[tauri::command]
pub async fn start_screen_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    serial: String,
    interval_ms: Option<u64>,
) -> Result<(), String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);
    let interval = interval_ms.unwrap_or(3000); // 默认 3000ms（稳定优先）

    // 用 Arc<AtomicBool> 控制循环，存到 state 以便 stop 可以访问
    let running = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(true));
    {
        let mut map = state.screen_stream_running.lock().map_err(|e| e.to_string())?;
        map.insert(serial.clone(), running.clone());
    }

    let running_clone = running.clone();
    let app_clone = app.clone();
    let serial_clone = serial.clone();
    let stream_map = state.screen_stream_running.clone();

    tokio::spawn(async move {
        use tokio::time::{sleep, Duration};

        let mut frame_count: u64 = 0;
        let mut consecutive_errors: u32 = 0;
        let mut error_backoff: u64 = 3000; // 错误退避时间，初始 3 秒

        while running_clone.load(std::sync::atomic::Ordering::Relaxed) {
            match adb.screenshot(&serial_clone).await {
                Ok(b64) => {
                    consecutive_errors = 0;
                    error_backoff = 3000; // 成功后重置退避
                    frame_count += 1;

                    let _ = app_clone.emit("screen-frame", ScreenFrame {
                        data: b64,
                        width: 0,  // 前端从 img.onload 获取实际尺寸
                        height: 0,
                    });

                    if frame_count <= 3 || frame_count % 25 == 0 {
                        eprintln!("[screen_stream] frame #{}", frame_count);
                    }

                    // 正常间隔
                    sleep(Duration::from_millis(interval)).await;
                }
                Err(e) => {
                    consecutive_errors += 1;
                    eprintln!("[screen_stream] error #{}: {}", consecutive_errors, e);

                    if consecutive_errors >= 5 {
                        let _ = app_clone.emit("screen-error", ScreenError {
                            message: format!("连续 {} 次截图失败，已停止", consecutive_errors),
                        });
                        break;
                    }

                    // 指数退避：3s → 6s → 10s（封顶）
                    sleep(Duration::from_millis(error_backoff)).await;
                    error_backoff = (error_backoff * 2).min(10_000);
                }
            }
        }

        running_clone.store(false, std::sync::atomic::Ordering::Relaxed);
        eprintln!("[screen_stream] Stopped after {} frames", frame_count);

        // 循环结束时从 state 清除
        if let Ok(mut map) = stream_map.lock() {
            map.remove(&serial_clone);
        }
    });

    Ok(())
}

/// 从 PNG 数据解析图像尺寸（IHDR chunk）
fn parse_png_size(data: &[u8]) -> (u32, u32) {
    // PNG 结构: 8 bytes signature + 4 bytes length + 4 bytes "IHDR" + 4 bytes width + 4 bytes height
    if data.len() >= 24 && &data[12..16] == b"IHDR" {
        let w = ((data[16] as u32) << 24) | ((data[17] as u32) << 16) | ((data[18] as u32) << 8) | (data[19] as u32);
        let h = ((data[20] as u32) << 24) | ((data[21] as u32) << 16) | ((data[22] as u32) << 8) | (data[23] as u32);
        return (w, h);
    }
    (0, 0)
}

/// 停止实时屏幕流
#[tauri::command]
pub async fn stop_screen_stream(
    state: State<'_, AppState>,
    serial: String,
) -> Result<(), String> {
    eprintln!("[stop_screen_stream] Stopping on device: {}", serial);

    // 设置 running 标志为 false，循环会在下一次检查时退出
    if let Ok(map) = state.screen_stream_running.lock() {
        if let Some(running) = map.get(&serial) {
            running.store(false, std::sync::atomic::Ordering::Relaxed);
            eprintln!("[stop_screen_stream] Set running flag to false");
        }
    }

    // 清理可能残留的 screenrecord 进程
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);
    let _ = adb.execute(&["-s", &serial, "shell", "pkill", "-f", "screenrecord"]).await;
    let _ = adb.execute(&["-s", &serial, "shell", "rm", "-f", "/data/local/tmp/screen_record.mp4"]).await;
    Ok(())
}

// ============ HarmonyOS HDC 命令 ============

/// 获取 HDC 设备列表
#[tauri::command]
pub async fn get_hdc_devices(state: State<'_, AppState>) -> Result<Vec<crate::hdc::HdcDevice>, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.devices().await.map_err(|e| e.to_string())
}

/// HDC WiFi 连接
#[tauri::command]
pub async fn hdc_connect_wifi(state: State<'_, AppState>, ip_port: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.connect_wifi(&ip_port).await.map_err(|e| e.to_string())
}

/// HDC 安装应用
#[tauri::command]
pub async fn hdc_install_app(state: State<'_, AppState>, serial: String, file_path: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.install(&serial, &file_path).await.map_err(|e| e.to_string())
}

/// HDC 卸载应用
#[tauri::command]
pub async fn hdc_uninstall_app(state: State<'_, AppState>, serial: String, package: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.uninstall(&serial, &package).await.map_err(|e| e.to_string())
}

/// HDC 清除应用缓存数据
#[tauri::command]
pub async fn hdc_clear_cache(state: State<'_, AppState>, serial: String, package: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.clear_cache(&serial, &package).await.map_err(|e| e.to_string())
}

/// HDC 清除应用用户数据
#[tauri::command]
pub async fn hdc_clear_data(state: State<'_, AppState>, serial: String, package: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.clear_data(&serial, &package).await.map_err(|e| e.to_string())
}

/// HDC 获取已安装应用列表
#[tauri::command]
pub async fn hdc_get_installed_apps(state: State<'_, AppState>, serial: String) -> Result<Vec<serde_json::Value>, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    let apps = hdc.get_installed_apps(&serial).await.map_err(|e| e.to_string())?;
    // 转为 serde_json::Value 以匹配前端 TypeScript InstalledApp 类型
    let values: Vec<serde_json::Value> = apps.into_iter()
        .map(|app| serde_json::to_value(app).unwrap_or_default())
        .collect();
    Ok(values)
}

/// HDC 快速获取应用列表（包名和应用名称）
#[tauri::command]
pub async fn hdc_get_app_list(state: State<'_, AppState>, serial: String) -> Result<Vec<serde_json::Value>, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.get_installed_apps_list(&serial).await.map_err(|e| e.to_string())
}

/// HDC 获取单个应用详情
#[tauri::command]
pub async fn hdc_get_app_detail(state: State<'_, AppState>, serial: String, package: String) -> Result<serde_json::Value, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.get_app_detail(&serial, &package).await
        .map(|info| serde_json::to_value(info).unwrap_or_default())
        .map_err(|e| e.to_string())
}

/// 批量获取鸿蒙应用详情（合并为一条 shell 命令执行）
#[tauri::command]
pub async fn hdc_get_apps_details_batch(
    state: State<'_, AppState>,
    serial: String,
    packages: Vec<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);

    if packages.is_empty() {
        return Ok(Vec::new());
    }

    eprintln!("[hdc_get_apps_details_batch] Batch getting details for {} packages", packages.len());

    // 合并命令：echo MARKER; bm dump -n pkg; echo MARKER; bm dump -n pkg; ...
    let marker = "___PKG_SEP___";
    let mut combined_parts: Vec<String> = Vec::new();
    for pkg in &packages {
        combined_parts.push(format!("echo '{}{}'", marker, pkg));
        combined_parts.push(format!("bm dump -n {}", pkg));
    }
    let combined_cmd = combined_parts.join("; ");

    // 一次性执行
    let output = hdc.shell_command(&serial, &combined_cmd).await
        .map_err(|e| e.to_string())?;

    // 拆分结果：按 marker 分割每个包的 bm dump 输出
    let mut results: HashMap<String, serde_json::Value> = HashMap::new();

    let mut current_pkg: String = String::new();
    let mut current_block: Vec<String> = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(pkg_name) = trimmed.strip_prefix(marker) {
            // 解析上一个包
            if !current_pkg.is_empty() {
                if let Some(info) = parse_hdc_app_detail_from_lines(&current_pkg, &current_block) {
                    results.insert(current_pkg.clone(), info);
                }
            }
            current_pkg = pkg_name.to_string();
            current_block.clear();
        } else if !current_pkg.is_empty() {
            current_block.push(line.to_string());
        }
    }
    // 最后一个包
    if !current_pkg.is_empty() {
        if let Some(info) = parse_hdc_app_detail_from_lines(&current_pkg, &current_block) {
            results.insert(current_pkg.clone(), info);
        }
    }

    // 构建返回列表（保持原始顺序）
    let mut apps: Vec<serde_json::Value> = Vec::new();
    for pkg in &packages {
        if let Some(info) = results.remove(pkg) {
            apps.push(info);
        } else {
            apps.push(serde_json::json!({
                "package_name": pkg,
                "app_name": pkg.split('.').last().unwrap_or(pkg),
                "version_name": "",
                "version_code": "",
                "is_system": false,
            }));
        }
    }

    eprintln!("[hdc_get_apps_details_batch] Done: {} packages processed", apps.len());
    Ok(apps)
}

/// 从 bm dump 输出行解析鸿蒙应用详情
fn parse_hdc_app_detail_from_lines(package: &str, lines: &[String]) -> Option<serde_json::Value> {
    // 合并所有行，提取 JSON 部分
    let full_output = lines.join("\n");

    let json_str = if let Some(start) = full_output.find('{') {
        if let Some(end) = full_output.rfind('}') {
            Some(full_output[start..=end].to_string())
        } else {
            None
        }
    } else {
        None
    };

    let json_str = json_str?;

    let json_val: serde_json::Value = serde_json::from_str(&json_str).ok()?;

    let app_info = json_val.get("applicationInfo")?;

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

    let app_name = if label_raw.starts_with("$string:") || label_raw.starts_with("$") || label_raw.is_empty() {
        bundle_name.clone()
    } else {
        label_raw
    };

    let version_name = app_info.get("versionName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let version_code = app_info.get("versionCode")
        .map(|v| v.to_string())
        .unwrap_or_default();

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

    let compile_sdk = app_info.get("compileSdkVersion")
        .map(|v| v.to_string())
        .unwrap_or_default();

    let app_distribution_type = app_info.get("appDistributionType")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

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

    Some(serde_json::json!({
        "package_name": bundle_name,
        "app_name": app_name,
        "version_name": version_name,
        "version_code": version_code,
        "vendor": vendor,
        "is_system": is_system,
        "removable": removable,
        "install_source": install_source,
        "code_path": code_path,
        "cpu_abi": cpu_abi,
        "uid": uid,
        "compile_sdk": compile_sdk,
        "app_distribution_type": app_distribution_type,
        "install_time": install_time,
        "main_ability": main_ability,
    }))
}

/// HDC 启动应用
#[tauri::command]
pub async fn hdc_start_app(state: State<'_, AppState>, serial: String, package: String, ability: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.start_app(&serial, &package, &ability).await.map_err(|e| e.to_string())
}

/// HDC 停止应用
#[tauri::command]
pub async fn hdc_stop_app(state: State<'_, AppState>, serial: String, package: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.stop_app(&serial, &package).await.map_err(|e| e.to_string())
}

/// HDC Shell 命令
#[tauri::command]
pub async fn hdc_shell(state: State<'_, AppState>, serial: String, command: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.shell_command(&serial, &command).await.map_err(|e| e.to_string())
}

/// HDC 截屏
#[tauri::command]
pub async fn hdc_screenshot(state: State<'_, AppState>, serial: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.screenshot(&serial).await.map_err(|e| e.to_string())
}

/// HDC 文件推送
#[tauri::command]
pub async fn hdc_push_file(state: State<'_, AppState>, serial: String, local_path: String, remote_path: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.push_file(&serial, &local_path, &remote_path).await.map_err(|e| e.to_string())
}

/// HDC 文件拉取
#[tauri::command]
pub async fn hdc_pull_file(state: State<'_, AppState>, serial: String, remote_path: String, local_path: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.pull_file(&serial, &remote_path, &local_path).await.map_err(|e| e.to_string())
}

/// HDC 获取文件列表
#[tauri::command]
pub async fn hdc_get_file_list(state: State<'_, AppState>, serial: String, path: String) -> Result<Vec<crate::hdc::HdcFileInfo>, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.get_file_list(&serial, &path).await.map_err(|e| e.to_string())
}

/// HDC 批量检查路径权限
#[tauri::command]
pub async fn hdc_check_paths_permission(state: State<'_, AppState>, serial: String, paths: Vec<String>) -> Result<std::collections::HashMap<String, String>, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    // 将 Vec<String> 转换为 &[&str]
    let path_refs: Vec<&str> = paths.iter().map(|s| s.as_str()).collect();
    hdc.check_paths_permission(&serial, &path_refs).await.map_err(|e| e.to_string())
}

/// HDC 获取设备信息
#[tauri::command]
pub async fn hdc_get_device_info(state: State<'_, AppState>, serial: String) -> Result<crate::hdc::HdcDevice, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.get_device_info(&serial).await.map_err(|e| e.to_string())
}

/// HDC 重启设备
#[tauri::command]
pub async fn hdc_reboot(state: State<'_, AppState>, serial: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.reboot(&serial).await.map_err(|e| e.to_string())
}

/// HDC 重启到 recovery 模式
#[tauri::command]
pub async fn hdc_reboot_recovery(state: State<'_, AppState>, serial: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.reboot_recovery(&serial).await.map_err(|e| e.to_string())
}

/// HDC 重启到 bootloader 模式
#[tauri::command]
pub async fn hdc_reboot_bootloader(state: State<'_, AppState>, serial: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.reboot_bootloader(&serial).await.map_err(|e| e.to_string())
}

/// HDC 关机
#[tauri::command]
pub async fn hdc_shutdown(state: State<'_, AppState>, serial: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.shutdown(&serial).await.map_err(|e| e.to_string())
}

/// 导出设备 bugreport（支持 Android 和 HarmonyOS，头部附加设备信息）
/// 使用 spawn 以支持取消
#[tauri::command]
pub async fn export_bugreport(
    state: State<'_, AppState>,
    serial: String,
    output_path: String,
    device_info: serde_json::Value,
    platform: String,
    lang: String,
) -> Result<String, String> {
    // spawn 子进程
    let (cmd_path, args) = match platform.as_str() {
        "harmonyos" => {
            let hdc_path = state.get_hdc_path();
            (hdc_path, vec!["-t".to_string(), serial.clone(), "bugreport".to_string()])
        }
        _ => {
            let adb_path = state.get_adb_path();
            (adb_path, vec!["-s".to_string(), serial.clone(), "bugreport".to_string()])
        }
    };

    let cmd_str = args.join(" ");
    eprintln!("[bugreport] +{} | {}", chrono::Local::now().format("%H:%M:%S%.3f"), cmd_str);
    let start = std::time::Instant::now();

    let child = tokio::process::Command::new(&cmd_path)
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("启动进程失败: {}", e))?;

    // 存储子进程以便取消
    {
        let mut guard = BUGREPORT_CHILD.lock().await;
        // 如果已有进程，先 kill
        if let Some(mut old) = guard.take() {
            let _ = old.kill().await;
        }
        *guard = Some(child);
    }

    // 取出子进程并等待完成
    let output = {
        let mut guard = BUGREPORT_CHILD.lock().await;
        let child = guard.take().ok_or("子进程不存在")?;
        child.wait_with_output().await.map_err(|e| format!("等待进程失败: {}", e))?
    };

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    eprintln!("[bugreport] -{} | {} {} ({}ms, {} bytes)",
        chrono::Local::now().format("%H:%M:%S%.3f"),
        cmd_str,
        if output.status.success() { "OK" } else { "FAILED" },
        start.elapsed().as_millis(),
        stdout.len());

    if !output.status.success() {
        return Err(format!("bugreport 失败: {}", if stderr.is_empty() { "未知错误" } else { &stderr }));
    }

    // 写入文件
    tokio::fs::write(&output_path, &stdout).await
        .map_err(|e| format!("写入文件失败: {}", e))?;

    // 在文件头部追加设备信息
    let header = build_bugreport_header(&device_info, &lang);
    let content = format!("{}\n\n{}", header, stdout);
    tokio::fs::write(&output_path, content).await
        .map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(format!("bugreport saved to {}", output_path))
}

/// 取消正在进行的 bugreport
#[tauri::command]
pub async fn cancel_bugreport() -> Result<bool, String> {
    let mut guard = BUGREPORT_CHILD.lock().await;
    if let Some(mut child) = guard.take() {
        eprintln!("[bugreport] 取消 bugreport");
        let _ = child.kill().await;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// 构建设备信息头部（根据语言显示不同标签）
fn build_bugreport_header(info: &serde_json::Value, lang: &str) -> String {
    let is_zh = lang.starts_with("zh");

    let title = if is_zh { "设备信息" } else { "Device Information" };
    let exported = if is_zh { "导出时间" } else { "Exported" };
    let device_name = if is_zh { "设备名称" } else { "Device Name" };
    let model = if is_zh { "型号" } else { "Model" };
    let brand = if is_zh { "品牌" } else { "Brand" };
    let serial = if is_zh { "序列号" } else { "Serial" };
    let os_version = if is_zh { "系统版本" } else { "OS Version" };
    let api_level = if is_zh { "API 级别" } else { "API Level" };
    let kernel = if is_zh { "内核版本" } else { "Kernel" };
    let cpu = if is_zh { "处理器" } else { "CPU" };
    let screen = if is_zh { "屏幕分辨率" } else { "Screen" };
    let memory = if is_zh { "内存" } else { "Memory" };
    let storage = if is_zh { "存储" } else { "Storage" };
    let bugreport_title = if is_zh { "诊断报告" } else { "Bugreport" };

    let mut lines = vec![
        "========================================".to_string(),
        format!("  {}", title),
        format!("  {}: {}", exported, chrono::Local::now().format("%Y-%m-%d %H:%M:%S")),
        "========================================".to_string(),
        String::new(),
    ];

    if let Some(name) = info.get("marketName").and_then(|v| v.as_str()) {
        lines.push(format!("{}: {}", device_name, name));
    }
    if let Some(m) = info.get("model").and_then(|v| v.as_str()) {
        lines.push(format!("{}: {}", model, m));
    }
    if let Some(b) = info.get("brand").and_then(|v| v.as_str()) {
        lines.push(format!("{}: {}", brand, b));
    }
    if let Some(s) = info.get("serial").and_then(|v| v.as_str()) {
        lines.push(format!("{}: {}", serial, s));
    }
    if let Some(v) = info.get("osVersion").and_then(|v| v.as_str()) {
        lines.push(format!("{}: {}", os_version, v));
    }
    if let Some(a) = info.get("apiLevel").and_then(|v| v.as_str()) {
        lines.push(format!("{}: {}", api_level, a));
    }
    if let Some(k) = info.get("kernelVersion").and_then(|v| v.as_str()) {
        lines.push(format!("{}: {}", kernel, k));
    }
    if let Some(c) = info.get("cpuInfo").and_then(|v| v.as_str()) {
        lines.push(format!("{}: {}", cpu, c));
    }
    if let Some(s) = info.get("screenResolution").and_then(|v| v.as_str()) {
        lines.push(format!("{}: {}", screen, s));
    }
    if let Some(m) = info.get("memoryInfo").and_then(|v| v.as_str()) {
        lines.push(format!("{}: {}", memory, m));
    }
    if let Some(s) = info.get("storageInfo").and_then(|v| v.as_str()) {
        lines.push(format!("{}: {}", storage, s));
    }

    lines.push(String::new());
    lines.push("========================================".to_string());
    lines.push(format!("  {}", bugreport_title));
    lines.push("========================================".to_string());

    lines.join("\n")
}

/// 检查 HDC 是否可用
#[tauri::command]
pub async fn check_hdc_available(state: State<'_, AppState>) -> Result<bool, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    // 尝试执行 hdc version
    match hdc.execute_fast(&["-v"]).await {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// 获取 HDC 路径
#[tauri::command]
pub async fn get_hdc_path(state: State<'_, AppState>) -> Result<String, String> {
    Ok(state.get_hdc_path())
}

/// 设置 HDC 路径
#[tauri::command]
pub async fn set_hdc_path(state: State<'_, AppState>, path: String) -> Result<(), String> {
    state.set_hdc_path(path);
    Ok(())
}

// ============ HarmonyOS 性能监控 ============

/// 鸿蒙性能信息
#[derive(Debug, Clone, serde::Serialize)]
pub struct HdcPerformanceInfo {
    pub cpu_usage: f32,
    pub memory_total: u64,
    pub memory_used: u64,
    pub memory_free: u64,
    pub battery_level: u8,
    pub battery_status: String,
    pub storage_total: u64,
    pub storage_used: u64,
    pub storage_free: u64,
}

/// 获取鸿蒙设备性能信息
#[tauri::command]
pub async fn hdc_get_performance_info(state: State<'_, AppState>, serial: String) -> Result<HdcPerformanceInfo, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);

    // 并行获取各项信息
    let cpu_result = hdc.get_cpu_usage(&serial).await;
    let mem_result = hdc.get_total_memory(&serial).await;
    let storage_result = hdc.get_storage_detail(&serial).await;
    let battery_result = hdc.get_battery_info(&serial).await;

    // 解析 CPU 使用率
    let cpu_usage = if let Ok(ref cpu_output) = cpu_result {
        eprintln!("[hdc_perf] cpuusage raw ({} bytes): {:?}", cpu_output.len(), cpu_output);
        parse_hdc_cpu_usage(cpu_output)
    } else {
        eprintln!("[hdc_perf] cpuusage ERROR: {:?}", cpu_result);
        0.0
    };

    // 解析内存信息
    let (memory_total, memory_used, memory_free) = if let Ok(ref mem_output) = mem_result {
        eprintln!("[hdc_perf] memory raw ({} bytes): {:?}", mem_output.len(), mem_output);
        parse_hdc_memory(mem_output)
    } else {
        eprintln!("[hdc_perf] memory ERROR: {:?}", mem_result);
        (0, 0, 0)
    };

    // 解析存储信息
    let (storage_total, storage_used, storage_free) = if let Ok(ref storage_output) = storage_result {
        eprintln!("[hdc_perf] storage raw ({} bytes): {:?}", storage_output.len(), storage_output);
        parse_hdc_storage(storage_output)
    } else {
        eprintln!("[hdc_perf] storage ERROR: {:?}", storage_result);
        (0, 0, 0)
    };

    // 解析电池信息
    let (battery_level, battery_status) = if let Ok(ref battery_output) = battery_result {
        eprintln!("[hdc_perf] battery raw ({} bytes): {:?}", battery_output.len(), battery_output);
        parse_hdc_battery(battery_output)
    } else {
        eprintln!("[hdc_perf] battery ERROR: {:?}", battery_result);
        (0, String::new())
    };

    eprintln!("[hdc_perf] result: cpu={}, mem={}/{}/{}, storage={}/{}/{}, battery={}%",
        cpu_usage, memory_total, memory_used, memory_free,
        storage_total, storage_used, storage_free, battery_level);

    Ok(HdcPerformanceInfo {
        cpu_usage,
        memory_total,
        memory_used,
        memory_free,
        battery_level,
        battery_status,
        storage_total,
        storage_used,
        storage_free,
    })
}

/// 获取鸿蒙设备 CPU 使用率
#[tauri::command]
pub async fn hdc_get_cpu_usage(state: State<'_, AppState>, serial: String) -> Result<HdcCpuUsageResult, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    let output = hdc.get_cpu_usage(&serial).await.map_err(|e| e.to_string())?;
    let usage = parse_hdc_cpu_usage(&output);
    Ok(HdcCpuUsageResult { usage, raw: output })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct HdcCpuUsageResult {
    pub usage: f32,
    pub raw: String,
}

/// 鸿蒙内存信息
#[derive(Debug, Clone, serde::Serialize)]
pub struct HdcMemoryInfo {
    pub total: u64,
    pub used: u64,
    pub free: u64,
    pub raw: String,
}

/// 获取鸿蒙设备内存信息
#[tauri::command]
pub async fn hdc_get_memory_info(state: State<'_, AppState>, serial: String) -> Result<HdcMemoryInfo, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    let output = hdc.get_total_memory(&serial).await.map_err(|e| e.to_string())?;
    let (total, used, free) = parse_hdc_memory(&output);
    Ok(HdcMemoryInfo { total, used, free, raw: output })
}

/// 鸿蒙电池信息
#[derive(Debug, Clone, serde::Serialize)]
pub struct HdcBatteryInfo {
    pub level: u8,
    pub status: String,
    pub temperature: i32,
    pub voltage: u32,
    pub current: i32,
    pub health: String,
    pub plugged_type: String,
    pub technology: String,
    pub remaining_energy: u32,
    pub total_energy: u32,
    pub charge_type: String,
    pub raw: String,
}

/// 获取鸿蒙设备电池信息
#[tauri::command]
pub async fn hdc_get_battery_info(state: State<'_, AppState>, serial: String) -> Result<HdcBatteryInfo, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    let output = hdc.get_battery_info(&serial).await.map_err(|e| e.to_string())?;
    Ok(parse_hdc_battery_full(&output))
}

/// 鸿蒙存储信息
#[derive(Debug, Clone, serde::Serialize)]
pub struct HdcStorageInfo {
    pub total: u64,
    pub used: u64,
    pub free: u64,
    pub raw: String,
}

/// 获取鸿蒙设备存储信息
#[tauri::command]
pub async fn hdc_get_storage_info(state: State<'_, AppState>, serial: String) -> Result<HdcStorageInfo, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    let output = hdc.get_storage_detail(&serial).await.map_err(|e| e.to_string())?;
    let (total, used, free) = parse_hdc_storage(&output);
    Ok(HdcStorageInfo { total, used, free, raw: output })
}

/// 重启 ADB 服务
#[tauri::command]
pub async fn restart_adb_service(state: State<'_, AppState>) -> Result<String, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);
    adb.reset_adb().await.map_err(|e| e.to_string())?;
    // 重启后刷新设备列表
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        crate::commands::refresh_devices_after_restart();
    });
    Ok("ADB 服务已重启".to_string())
}

/// 重启 HDC 服务
#[tauri::command]
pub async fn restart_hdc_service(state: State<'_, AppState>) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.restart_hdc().await.map_err(|e| e.to_string())?;
    // 重启后刷新设备列表
    tokio::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        crate::commands::refresh_devices_after_restart();
    });
    Ok("HDC 服务已重启".to_string())
}

/// 重启服务后刷新设备列表（内部辅助函数）
pub fn refresh_devices_after_restart() {
    // 通过 Tauri event 通知前端刷新
    // 前端的 pollDevices 会自动处理
}

/// 获取 hidumper -c base 完整设备基础信息（原始文本）
#[tauri::command]
pub async fn hdc_get_base_info(state: State<'_, AppState>, serial: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);

    // 获取基础信息
    let base = hdc.get_base_info(&serial).await.map_err(|e| e.to_string())?;

    // 获取 GPU 信息
    let gpu = hdc.get_gpu_info(&serial).await.unwrap_or_default();

    // 拼接，用特殊标记分隔
    Ok(format!("{}\n===GPU_INFO===\n{}", base, gpu))
}

/// 解析 hidumper --cpuusage 输出
fn parse_hdc_cpu_usage(output: &str) -> f32 {
    for line in output.lines() {
        // 格式: "Total: 13.99%; User Space: 8.58%; ..."
        if line.starts_with("Total:") {
            if let Some(idx) = line.find(':') {
                let val = &line[idx + 1..];
                // 取第一个分号前的内容，去掉 %
                let val = val.split(';').next().unwrap_or("").trim().trim_end_matches('%');
                if let Ok(v) = val.parse::<f32>() {
                    return v;
                }
            }
        }
    }
    0.0
}

/// 解析 /proc/meminfo 输出
fn parse_hdc_memory(output: &str) -> (u64, u64, u64) {
    let mut total: u64 = 0;
    let mut available: u64 = 0;

    for line in output.lines() {
        if line.starts_with("MemTotal:") {
            if let Some(val) = parse_meminfo_value(line) {
                total = val;
            }
        } else if line.starts_with("MemAvailable:") {
            if let Some(val) = parse_meminfo_value(line) {
                available = val;
            }
        }
    }

    let used = if total > available { total - available } else { 0 };
    let total_rounded = crate::utils::round_up_memory_gb(total);
    (total_rounded, used, available)
}

/// 解析 df -h /data 输出
fn parse_hdc_storage(output: &str) -> (u64, u64, u64) {
    // 格式: Filesystem  Size  Used  Avail  Use%  Mounted on
    //        /dev/root   214G  99G   115G   46%   /data
    for line in output.lines() {
        if line.contains("/data") {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 4 {
                let total = parse_human_size(parts[1]);
                let used = parse_human_size(parts[2]);
                let free = parse_human_size(parts[3]);
                return (total, used, free);
            }
        }
    }
    (0, 0, 0)
}

/// 解析 hidumper -s BatteryService -a "-i" 输出
fn parse_hdc_battery(output: &str) -> (u8, String) {
    let info = parse_hdc_battery_full(output);
    (info.level, info.status)
}

/// 完整解析电池信息
fn parse_hdc_battery_full(output: &str) -> HdcBatteryInfo {
    let mut level: u8 = 0;
    let mut status = String::new();
    let mut temperature: i32 = 0;
    let mut voltage: u32 = 0;
    let mut current: i32 = 0;
    let mut health = String::new();
    let mut plugged_type = String::new();
    let mut technology = String::new();
    let mut remaining_energy: u32 = 0;
    let mut total_energy: u32 = 0;
    let mut charge_type = String::new();

    for line in output.lines() {
        let line = line.trim();
        if let Some(val) = line.strip_prefix("capacity:") {
            if let Ok(v) = val.trim().parse::<u8>() { level = v; }
        } else if let Some(val) = line.strip_prefix("chargingStatus:") {
            status = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("temperature:") {
            if let Ok(v) = val.trim().parse::<i32>() { temperature = v; }
        } else if let Some(val) = line.strip_prefix("voltage:") {
            if let Ok(v) = val.trim().parse::<u32>() { voltage = v; }
        } else if let Some(val) = line.strip_prefix("nowCurrent:") {
            if let Ok(v) = val.trim().parse::<i32>() { current = v; }
        } else if let Some(val) = line.strip_prefix("healthState:") {
            health = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("pluggedType:") {
            plugged_type = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("technology:") {
            technology = val.trim().to_string();
        } else if let Some(val) = line.strip_prefix("remainingEnergy:") {
            if let Ok(v) = val.trim().parse::<u32>() { remaining_energy = v; }
        } else if let Some(val) = line.strip_prefix("totalEnergy:") {
            if let Ok(v) = val.trim().parse::<u32>() { total_energy = v; }
        } else if let Some(val) = line.strip_prefix("chargeType:") {
            charge_type = val.trim().to_string();
        }
    }

    HdcBatteryInfo {
        level, status, temperature, voltage, current, health,
        plugged_type, technology, remaining_energy, total_energy,
        charge_type, raw: output.to_string(),
    }
}

/// 从 "MemTotal:       15803612 kB" 中提取字节数
fn parse_meminfo_value(line: &str) -> Option<u64> {
    if let Some(idx) = line.find(':') {
        let val = &line[idx + 1..];
        let val = val.trim();
        // 取数字部分
        let num_str: String = val.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(num) = num_str.parse::<u64>() {
            // 检查单位
            if val.contains("MB") || val.contains("mb") {
                return Some(num * 1024 * 1024);
            } else if val.contains("GB") || val.contains("gb") {
                return Some(num * 1024 * 1024 * 1024);
            } else {
                // 默认 kB
                return Some(num * 1024);
            }
        }
    }
    None
}

/// 解析人类可读大小 "214G", "99G", "115M" 等为字节数
fn parse_human_size(s: &str) -> u64 {
    let s = s.trim();
    let num_str: String = s.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    if let Ok(num) = num_str.parse::<f64>() {
        if s.ends_with('T') { return (num * 1024.0 * 1024.0 * 1024.0 * 1024.0) as u64; }
        if s.ends_with('G') { return (num * 1024.0 * 1024.0 * 1024.0) as u64; }
        if s.ends_with('M') { return (num * 1024.0 * 1024.0) as u64; }
        if s.ends_with('K') { return (num * 1024.0) as u64; }
        return num as u64;
    }
    0
}
