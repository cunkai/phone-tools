use std::path::Path;
use std::process::Command;

/// 在系统中查找 ADB 可执行文件路径
/// 优先级: 内置 tools 目录 > PATH 环境变量 > 常见安装位置 > ANDROID_HOME
pub fn find_adb_path() -> Option<String> {
    // 0. 优先检查内置 tools 目录
    if let Some(builtin_path) = find_builtin_tool("adb") {
        eprintln!("[find_adb_path] Using builtin: {}", builtin_path);
        return Some(builtin_path);
    }

    // 1. 检查 PATH 中是否有 adb
    if let Ok(output) = Command::new("which").arg("adb").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Some(path);
            }
        }
    }

    // 2. 检查 where (Windows)
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = Command::new("where").arg("adb").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !path.is_empty() {
                    return Some(path);
                }
            }
        }
    }

    // 3. 常见安装位置
    let common_paths = get_common_adb_paths();

    for path in &common_paths {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }

    // 4. 检查 ANDROID_HOME / ANDROID_SDK_ROOT 环境变量
    if let Ok(sdk_home) = std::env::var("ANDROID_HOME") {
        let platform_tools = format!("{}/platform-tools/adb", sdk_home);
        if Path::new(&platform_tools).exists() {
            return Some(platform_tools);
        }
    }

    if let Ok(sdk_root) = std::env::var("ANDROID_SDK_ROOT") {
        let platform_tools = format!("{}/platform-tools/adb", sdk_root);
        if Path::new(&platform_tools).exists() {
            return Some(platform_tools);
        }
    }

    None
}

/// 获取各平台常见的 ADB 安装路径
fn get_common_adb_paths() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let home = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        vec![
            format!("{}\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe", home),
            "C:\\Android\\platform-tools\\adb.exe".to_string(),
            "C:\\Program Files\\Android\\platform-tools\\adb.exe".to_string(),
        ]
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/default".to_string());
        vec![
            format!("{}/Library/Android/sdk/platform-tools/adb", home),
            "/usr/local/bin/adb".to_string(),
            "/opt/homebrew/bin/adb".to_string(),
        ]
    }

    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/home/default".to_string());
        vec![
            format!("{}/Android/Sdk/platform-tools/adb", home),
            "/usr/bin/adb".to_string(),
            "/usr/local/bin/adb".to_string(),
            "/opt/android-sdk/platform-tools/adb".to_string(),
        ]
    }
}

/// 查找内置 tools 目录中的工具
/// Tauri 打包后，资源文件在可执行文件同级的 tools/ 目录
/// 开发时，在 src-tauri/tools/ 目录
pub fn find_builtin_tool(tool_name: &str) -> Option<String> {
    // Windows 下工具名带 .exe 后缀
    #[cfg(target_os = "windows")]
    let tool_file = format!("{}.exe", tool_name);
    #[cfg(not(target_os = "windows"))]
    let tool_file = tool_name.to_string();

    // 1. 检查可执行文件同级的 tools/ 目录（打包后）
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let builtin = exe_dir.join("tools").join(&tool_file);
            if builtin.exists() {
                return Some(builtin.to_string_lossy().to_string());
            }
        }
    }

    // 2. 检查当前工作目录下的 tools/ 目录（开发时）
    let dev_path = Path::new("tools").join(&tool_file);
    if dev_path.exists() {
        return Some(dev_path.to_string_lossy().to_string());
    }

    // 3. 检查 src-tauri/tools/ 目录（开发时从项目根目录运行）
    let src_tauri_path = Path::new("src-tauri/tools").join(&tool_file);
    if src_tauri_path.exists() {
        return Some(src_tauri_path.to_string_lossy().to_string());
    }

    None
}

/// 查找 HDC 可执行文件路径
/// 优先级: 内置 tools 目录 > PATH 环境变量 > 常见安装位置 > DEVECO_HOME
pub fn find_hdc_path() -> Option<String> {
    // 0. 优先检查内置 tools 目录
    if let Some(builtin_path) = find_builtin_tool("hdc") {
        eprintln!("[find_hdc_path] Using builtin: {}", builtin_path);
        return Some(builtin_path);
    }

    // 1. 检查 PATH 中是否有 hdc
    #[cfg(target_os = "windows")]
    {
        if let Ok(output) = Command::new("where").arg("hdc").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
                if !path.is_empty() {
                    return Some(path);
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = Command::new("which").arg("hdc").output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                if !path.is_empty() {
                    return Some(path);
                }
            }
        }
    }

    // 2. 常见安装位置（DevEco Studio）
    let common_paths = get_common_hdc_paths();
    for path in &common_paths {
        if Path::new(path).exists() {
            return Some(path.to_string());
        }
    }

    // 3. 检查 DEVECO_HOME 环境变量
    if let Ok(home) = std::env::var("DEVECO_HOME") {
        let toolchains = format!("{}/sdk/default/openharmony/toolchains/hdc", home);
        #[cfg(target_os = "windows")]
        let toolchains = format!("{}.exe", toolchains);
        if Path::new(&toolchains).exists() {
            return Some(toolchains);
        }
    }

    // 4. 检查 HOME 下的 DevEco Studio
    #[cfg(target_os = "windows")]
    {
        let user = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        let paths = vec![
            format!("{}\\AppData\\Local\\Huawei\\Sdk\\openharmony\\toolchains\\hdc.exe", user),
            format!("{}\\DevEco Studio\\sdk\\default\\openharmony\\toolchains\\hdc.exe", user),
        ];
        for path in &paths {
            if Path::new(path).exists() {
                return Some(path.to_string());
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/default".to_string());
        let paths = vec![
            format!("{}/Library/Huawei/Sdk/openharmony/toolchains/hdc", home),
            format!("{}/DevEco Studio/sdk/default/openharmony/toolchains/hdc", home),
        ];
        for path in &paths {
            if Path::new(path).exists() {
                return Some(path.to_string());
            }
        }
    }

    None
}

/// 获取各平台常见的 HDC 安装路径
fn get_common_hdc_paths() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        let user = std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".to_string());
        vec![
            format!("{}\\AppData\\Local\\Huawei\\Sdk\\openharmony\\toolchains\\hdc.exe", user),
        ]
    }

    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/Users/default".to_string());
        vec![
            format!("{}/Library/Huawei/Sdk/openharmony/toolchains/hdc", home),
            "/usr/local/bin/hdc".to_string(),
        ]
    }

    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/home/default".to_string());
        vec![
            format!("{}/Huawei/Sdk/openharmony/toolchains/hdc", home),
            "/usr/bin/hdc".to_string(),
            "/usr/local/bin/hdc".to_string(),
        ]
    }
}

/// 解析文件大小字符串为字节数
/// 支持格式: "1.2G", "500M", "1024K", "2048" 等
pub fn parse_size_string(s: &str) -> u64 {
    let s = s.trim();
    if s.is_empty() {
        return 0;
    }

    let (num_str, multiplier) = if let Some(suffix) = s.strip_suffix("G")
        .or_else(|| s.strip_suffix("GB"))
    {
        (suffix.trim(), 1024u64 * 1024 * 1024)
    } else if let Some(suffix) = s.strip_suffix("M")
        .or_else(|| s.strip_suffix("MB"))
    {
        (suffix.trim(), 1024u64 * 1024)
    } else if let Some(suffix) = s.strip_suffix("K")
        .or_else(|| s.strip_suffix("KB"))
    {
        (suffix.trim(), 1024u64)
    } else if let Some(suffix) = s.strip_suffix("T")
        .or_else(|| s.strip_suffix("TB"))
    {
        (suffix.trim(), 1024u64 * 1024 * 1024 * 1024)
    } else {
        (s, 1u64)
    };

    num_str
        .parse::<f64>()
        .map(|n| (n * multiplier as f64) as u64)
        .unwrap_or(0)
}

/// 将字节数格式化为人类可读的字符串
pub fn format_file_size(bytes: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = 1024 * KB;
    const GB: u64 = 1024 * MB;
    const TB: u64 = 1024 * GB;

    if bytes >= TB {
        format!("{:.2} TB", bytes as f64 / TB as f64)
    } else if bytes >= GB {
        format!("{:.2} GB", bytes as f64 / GB as f64)
    } else if bytes >= MB {
        format!("{:.2} MB", bytes as f64 / MB as f64)
    } else if bytes >= KB {
        format!("{:.2} KB", bytes as f64 / KB as f64)
    } else {
        format!("{} B", bytes)
    }
}

/// 验证 IP 地址格式
pub fn is_valid_ip(ip: &str) -> bool {
    ip.parse::<std::net::IpAddr>().is_ok()
}

/// 从 dumpsys 输出中提取 Base64 编码的图标数据
pub fn extract_base64_icon(data: &str) -> Option<String> {
    // dumpsys package 输出中图标信息通常在 "iconRes=" 或类似字段中
    // 这里我们尝试从 aapt dump badging 的输出中提取图标路径
    // 实际的 base64 图标提取需要通过 adb shell cmd package dump 来完成
    if data.is_empty() {
        return None;
    }

    // 查找 base64 编码的图标数据（如果存在）
    let lines: Vec<&str> = data.lines().collect();
    for line in &lines {
        if line.contains("icon=") || line.contains("base64:") {
            if let Some(base64_data) = line.split("base64:").nth(1) {
                let trimmed = base64_data.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }

    None
}

/// 解析 ADB devices 输出
pub fn parse_devices_output(output: &str) -> Vec<(String, String)> {
    output
        .lines()
        .skip(1) // 跳过 "List of devices attached" 标题行
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                Some((parts[0].to_string(), parts[1].to_string()))
            } else {
                None
            }
        })
        .collect()
}

/// 解析 dumpsys meminfo 输出中的内存信息
pub fn parse_memory_info(output: &str) -> (u64, u64, u64) {
    let mut total = 0u64;
    let mut free = 0u64;

    for line in output.lines() {
        let line = line.trim();
        if line.starts_with("MemTotal:") {
            total = parse_mem_value(line);
        } else if line.starts_with("MemAvailable:") || line.starts_with("MemFree:") {
            let val = parse_mem_value(line);
            if free == 0 {
                free = val;
            }
        }
    }

    let used = total.saturating_sub(free);
    (total, used, free)
}

fn parse_mem_value(line: &str) -> u64 {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() >= 2 {
        let num = parts[1].parse::<u64>().unwrap_or(0);
        // /proc/meminfo 的单位是 kB
        if parts.len() >= 3 && parts[2] == "kB" {
            return num * 1024;
        }
        return num;
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_size_string() {
        assert_eq!(parse_size_string("1G"), 1024 * 1024 * 1024);
        assert_eq!(parse_size_string("500M"), 500 * 1024 * 1024);
        assert_eq!(parse_size_string("1024K"), 1024 * 1024);
        assert_eq!(parse_size_string("2048"), 2048);
        assert_eq!(parse_size_string("1.5G"), (1.5 * 1024.0 * 1024.0 * 1024.0) as u64);
    }

    #[test]
    fn test_format_file_size() {
        assert_eq!(format_file_size(1024), "1.00 KB");
        assert_eq!(format_file_size(1024 * 1024), "1.00 MB");
        assert_eq!(format_file_size(1024 * 1024 * 1024), "1.00 GB");
        assert_eq!(format_file_size(500), "500 B");
    }

    #[test]
    fn test_is_valid_ip() {
        assert!(is_valid_ip("192.168.1.1"));
        assert!(is_valid_ip("::1"));
        assert!(!is_valid_ip("not-an-ip"));
        assert!(!is_valid_ip(""));
    }
}
