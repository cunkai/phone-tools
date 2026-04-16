use serde::{Deserialize, Serialize};

/// 安装进度事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallProgress {
    pub percentage: u32,
    pub message: String,
}

/// 设备连接事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceConnected {
    pub device: crate::adb::AdbDevice,
}

/// 设备断开连接事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceDisconnected {
    pub serial: String,
}

/// 日志输出事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogOutput {
    pub line: String,
}

/// Shell 输出事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellOutput {
    pub output: String,
}

/// 文件传输进度事件
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferProgress {
    pub percentage: u32,
    pub bytes_transferred: u64,
    pub total_bytes: u64,
    pub message: String,
}

/// 事件名称常量
pub const EVENT_INSTALL_PROGRESS: &str = "install-progress";
pub const EVENT_DEVICE_CONNECTED: &str = "device-connected";
pub const EVENT_DEVICE_DISCONNECTED: &str = "device-disconnected";
pub const EVENT_LOG_OUTPUT: &str = "log-output";
pub const EVENT_SHELL_OUTPUT: &str = "shell-output";
pub const EVENT_TRANSFER_PROGRESS: &str = "transfer-progress";
pub const EVENT_DEVICE_REFRESH: &str = "device-refresh";
