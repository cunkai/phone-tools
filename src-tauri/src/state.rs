use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tokio::task::JoinHandle;

use crate::adb::FpsRecord;

/// 应用全局状态
pub struct AppState {
    /// 当前选中的设备序列号
    pub current_device: Mutex<Option<String>>,
    /// ADB 可执行文件路径
    pub adb_path: Mutex<String>,
    /// HDC 可执行文件路径
    pub hdc_path: Mutex<String>,
    /// 用户界面语言
    pub locale: Mutex<String>,
    /// FPS 监控数据：key 为 "serial:package"，value 为 FPS 记录列表
    pub fps_data: Arc<Mutex<HashMap<String, Vec<FpsRecord>>>>,
    /// FPS 监控任务句柄：key 为 "serial:package"，用于取消监控
    pub fps_handles: Arc<Mutex<HashMap<String, JoinHandle<()>>>>,
    /// 屏幕流运行标志：key 为 serial
    pub screen_stream_running: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl AppState {
    /// 创建新的应用状态
    pub fn new() -> Self {
        let adb_path = crate::utils::find_adb_path().unwrap_or_else(|| "adb".to_string());
        let hdc_path = crate::utils::find_hdc_path().unwrap_or_else(|| "hdc".to_string());
        Self {
            current_device: Mutex::new(None),
            adb_path: Mutex::new(adb_path),
            hdc_path: Mutex::new(hdc_path),
            locale: Mutex::new("zh-CN".to_string()),
            fps_data: Arc::new(Mutex::new(HashMap::new())),
            fps_handles: Arc::new(Mutex::new(HashMap::new())),
            screen_stream_running: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// 获取当前选中的设备序列号
    pub fn get_current_device(&self) -> Option<String> {
        self.current_device.lock().ok().and_then(|d| d.clone())
    }

    /// 设置当前选中的设备序列号
    pub fn set_current_device(&self, serial: Option<String>) {
        if let Ok(mut device) = self.current_device.lock() {
            *device = serial;
        }
    }

    /// 获取 ADB 可执行文件路径
    pub fn get_adb_path(&self) -> String {
        self.adb_path
            .lock()
            .map(|p| p.clone())
            .unwrap_or_else(|_| "adb".to_string())
    }

    /// 设置 ADB 可执行文件路径
    pub fn set_adb_path(&self, path: String) {
        if let Ok(mut adb) = self.adb_path.lock() {
            *adb = path;
        }
    }

    /// 获取 HDC 可执行文件路径
    pub fn get_hdc_path(&self) -> String {
        self.hdc_path
            .lock()
            .map(|p| p.clone())
            .unwrap_or_else(|_| "hdc".to_string())
    }

    /// 设置 HDC 可执行文件路径
    pub fn set_hdc_path(&self, path: String) {
        if let Ok(mut hdc) = self.hdc_path.lock() {
            *hdc = path;
        }
    }

    /// 获取当前语言设置
    pub fn get_locale(&self) -> String {
        self.locale
            .lock()
            .map(|l| l.clone())
            .unwrap_or_else(|_| "zh-CN".to_string())
    }

    /// 设置语言
    pub fn set_locale(&self, locale: String) {
        if let Ok(mut l) = self.locale.lock() {
            *l = locale;
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
