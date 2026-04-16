export interface AdbDevice {
  serial: string;
  status: string;
  model: string;
  brand: string;
  android_version: string;
  sdk_version: string;
  battery_level: number | null;
  screen_resolution: string;
  cpu_info: string;
  total_memory: string;
  available_storage: string;
  total_storage: string;
  device_type: string;
  platform: string;
}

export interface ApkInfo {
  package_name: string;
  app_name: string;
  version_name: string;
  version_code: string;
  icon_base64: string | null;
  permissions: string[];
  file_size: string;
  min_sdk_version: number | null;
  target_sdk_version: number | null;
}

export interface InstalledApp {
  package_name: string;
  app_name: string;
  version_name: string;
  version_code: string;
  icon_base64: string | null;
  install_time: string;
  app_size: string;
  is_system: boolean;
  // 鸿蒙扩展字段
  vendor?: string;           // 开发者
  install_source?: string;   // 安装来源
  cpu_abi?: string;          // CPU 架构
  code_path?: string;        // 安装路径
  uid?: number;              // 用户 ID
  removable?: boolean;       // 是否可卸载
  compile_sdk?: string;      // 编译 SDK 版本
  app_distribution_type?: string; // 分发类型
  raw_data?: string;         // 原始 JSON 数据（调试用）
}

export interface FileInfo {
  name: string;
  path: string;
  is_directory: boolean;
  size: string;
  permissions: string;
  last_modified: string;
}

export interface PerformanceInfo {
  cpu_usage: number;
  memory_total: string;
  memory_used: string;
  memory_free: string;
  memory_total_bytes: number;
  memory_used_bytes: number;
  memory_free_bytes: number;
  battery_level: number;
  battery_temperature: string;
  battery_status: string;
  storage_total: string;
  storage_used: string;
  storage_free: string;
  storage_total_bytes: number;
  storage_used_bytes: number;
  storage_free_bytes: number;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  tag: string;
  message: string;
}

export interface ShellOutput {
  output: string;
  isError: boolean;
}

export interface FpsRecord {
  timestamp: number;
  fps: number;
  foreground_app: string;
}

export interface TopMemoryApp {
  package_name: string;
  memory_used: string;
  memory_used_bytes: number;
}

export interface DeviceControlState {
  brightness: number;
  wifiEnabled: boolean;
  airplaneMode: boolean;
  volume: number;
}
