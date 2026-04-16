use serde_json::{json, Value};
use tauri::{Emitter, State};

use crate::adb::{AdbCommand, AdbDevice, AppInfo, ApkInfo, FileInfo, FpsRecord, PerformanceInfo, TopMemoryApp};
use crate::events::{
    DeviceConnected, DeviceDisconnected, InstallProgress, ShellOutput, TransferProgress,
    EVENT_DEVICE_CONNECTED, EVENT_DEVICE_DISCONNECTED, EVENT_INSTALL_PROGRESS,
    EVENT_SHELL_OUTPUT, EVENT_TRANSFER_PROGRESS,
};
use crate::state::AppState;

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

    // 获取 ADB 设备
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);
    if let Ok(adb_devices) = adb.devices().await {
        for device in adb_devices {
            all_devices.push(serde_json::to_value(device).unwrap_or_default());
        }
    }

    // 获取 HDC 设备（包含详细信息）
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    match hdc.devices().await {
        Ok(hdc_devices) => {
            for device in hdc_devices {
                let device_status = device.status.clone();
                // 对每个鸿蒙设备获取详细信息（model, brand 等）
                let mut detailed = match hdc.get_device_info(&device.serial).await {
                    Ok(info) => info,
                    Err(_) => {
                        if device.serial.is_empty() || device.serial.contains("[Fail]") {
                            continue;
                        }
                        device
                    }
                };
                // 保留 devices() 返回的 status（get_device_info 的 default status 是空的）
                detailed.status = device_status;
                // 过滤掉无效设备（model 和 brand 都为空说明设备未授权）
                if detailed.model.is_empty() && detailed.brand.is_empty() {
                    eprintln!("[get_all_devices] Skipping invalid HDC device: {}", detailed.serial);
                    continue;
                }
                all_devices.push(serde_json::to_value(detailed).unwrap_or_default());
            }
        }
        Err(e) => {
            // HDC 不可用时静默忽略（用户可能没有安装 HDC）
            eprintln!("[get_all_devices] HDC not available: {}", e);
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

    let output = adb.shell_command(&serial, &command).await.map_err(|e| e.to_string())?;

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
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    let line_count = lines.unwrap_or(100);
    adb.logcat(&serial, line_count).await.map_err(|e| e.to_string())
}

/// 获取性能信息（CPU、内存、电池、存储）
#[tauri::command]
pub async fn get_performance_info(
    state: State<'_, AppState>,
    serial: String,
) -> Result<PerformanceInfo, String> {
    let adb_path = state.get_adb_path();
    let adb = AdbCommand::new(&adb_path);

    eprintln!("[get_performance_info] Starting for device: {}", serial);

    let (cpu_result, memory_result, battery_result, storage_result) = tokio::join!(
        async {
            let r = adb.get_cpu_usage(&serial).await;
            eprintln!("[get_performance_info] CPU result: {:?}", r);
            r
        },
        async {
            let r = adb.get_memory_info(&serial).await;
            eprintln!("[get_performance_info] Memory result: {:?}", r);
            r
        },
        async {
            let r = adb.get_battery_info(&serial).await;
            eprintln!("[get_performance_info] Battery result: {:?}", r);
            r
        },
        async {
            let r = adb.get_storage_info(&serial).await;
            eprintln!("[get_performance_info] Storage result: {:?}", r);
            r
        },
    );

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
        memory_total: crate::utils::format_file_size(mem_total),
        memory_used: crate::utils::format_file_size(mem_used),
        memory_free: crate::utils::format_file_size(mem_free),
        memory_total_bytes: mem_total,
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

/// 解析本地 APK 文件信息（支持 .apk / .xapk / .apks / .apkm）
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

    // 普通 .apk 格式
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

/// 启动 FPS 监控
#[tauri::command]
pub async fn start_fps_monitor(
    state: State<'_, AppState>,
    serial: String,
    package: String,
) -> Result<String, String> {
    let adb_path = state.get_adb_path();

    let key = format!("{}:{}", serial, package);

    // 检查是否已有监控在运行，同时清理同设备的旧监控
    {
        let mut handles = state.fps_handles.lock().map_err(|e| e.to_string())?;
        if handles.contains_key(&key) {
            return Err(format!("FPS 监控已在运行: {}", key));
        }
        // 清理同设备的旧监控（key 以 serial: 开头的）
        let old_keys: Vec<String> = handles.keys()
            .filter(|k| k.starts_with(&format!("{}:", serial)))
            .cloned()
            .collect();
        for old_key in old_keys {
            eprintln!("[start_fps_monitor] Cleaning up old monitor: {}", old_key);
            if let Some(h) = handles.remove(&old_key) {
                h.abort();
            }
        }
        // 也清理只用 serial 作为 key 的旧格式
        if handles.contains_key(&serial) {
            eprintln!("[start_fps_monitor] Cleaning up legacy monitor: {}", serial);
            if let Some(h) = handles.remove(&serial) {
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
    let package_clone = package.clone();
    let key_clone = key.clone();

    let handle = tokio::spawn(async move {
        let adb = AdbCommand::new(&adb_path_clone);
        let start_time = std::time::Instant::now();

        eprintln!("[start_fps_monitor] Starting FPS monitor for {}:{}", serial_clone, package_clone);

        // 先做两次 reset，确保清除所有累积帧数据
        // 第一次 reset：清除之前的累积
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            adb.get_gfxinfo(&serial_clone, &package_clone)
        ).await;
        // 等待 1 秒让计数器开始新的周期
        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        // 第二次 reset：丢弃这 1 秒的帧，确保采样从干净状态开始
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            adb.get_gfxinfo(&serial_clone, &package_clone)
        ).await;
        eprintln!("[start_fps_monitor] Double reset done, starting clean sampling...");

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

            // 获取 gfxinfo（带 5 秒超时）
            let gfxinfo_result = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                adb.get_gfxinfo(&serial_clone, &package_clone)
            ).await
            .ok()
            .and_then(|r| r.ok());

            // 解析 FPS
            let fps = gfxinfo_result
                .as_ref()
                .and_then(|info| AdbCommand::parse_fps_from_gfxinfo(info));

            let elapsed_ms = start_time.elapsed().as_millis() as f64;

            if let Some(fps_val) = fps {
                let record = FpsRecord {
                    timestamp: elapsed_ms,
                    fps: fps_val,
                    foreground_app: package_clone.clone(),
                };

                eprintln!("[start_fps_monitor] FPS: {:.1} at {:.0}ms (app: {})", fps_val, elapsed_ms, package_clone);

                if let Ok(mut data) = fps_data.lock() {
                    if let Some(records) = data.get_mut(&key_clone) {
                        records.push(record);
                        if records.len() > 3600 {
                            records.drain(..records.len() - 3600);
                        }
                    }
                }
            } else {
                let record = FpsRecord {
                    timestamp: elapsed_ms,
                    fps: 0.0,
                    foreground_app: package_clone.clone(),
                };

                if let Ok(mut data) = fps_data.lock() {
                    if let Some(records) = data.get_mut(&key_clone) {
                        records.push(record);
                        if records.len() > 3600 {
                            records.drain(..records.len() - 3600);
                        }
                    }
                }
            }
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
    package: String,
) -> Result<String, String> {
    let key = format!("{}:{}", serial, package);

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
        if key.starts_with(&format!("{}:", serial)) {
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

/// HDC 快速获取应用列表（仅包名）
#[tauri::command]
pub async fn hdc_get_app_list(state: State<'_, AppState>, serial: String) -> Result<Vec<String>, String> {
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

/// HDC 启动应用
#[tauri::command]
pub async fn hdc_start_app(state: State<'_, AppState>, serial: String, package: String) -> Result<String, String> {
    let hdc_path = state.get_hdc_path();
    let hdc = crate::hdc::HdcCommand::new(&hdc_path);
    hdc.start_app(&serial, &package).await.map_err(|e| e.to_string())
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
