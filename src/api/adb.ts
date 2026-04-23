import { invoke } from "@tauri-apps/api/core";
import type {
  AdbDevice,
  ApkInfo,
  InstalledApp,
  FileInfo,
  PerformanceInfo,
  HdcFileInfo,
} from "../types";

export async function getDevices(): Promise<AdbDevice[]> {
  return invoke<AdbDevice[]>("get_devices");
}

export async function connectWifiDevice(
  ip: string,
  port: number
): Promise<string> {
  return invoke<string>("connect_wifi_device", { ip, port });
}

export async function disconnectDevice(serial: string): Promise<void> {
  return invoke<void>("disconnect_device", { serial });
}

export async function installApp(
  serial: string,
  filePath: string
): Promise<void> {
  return invoke<void>("install_app", { serial, filePath });
}

export async function uninstallApp(
  serial: string,
  packageName: string
): Promise<void> {
  return invoke<void>("uninstall_app", { serial, package: packageName });
}

export async function getInstalledApps(serial: string, includeSystem?: boolean): Promise<InstalledApp[]> {
  return invoke<InstalledApp[]>("get_installed_apps", { serial, includeSystem });
}

export async function getAppDetails(
  serial: string,
  packageName: string
): Promise<InstalledApp> {
  return invoke<InstalledApp>("get_app_details", { serial, package: packageName });
}

export async function getAppsDetailsBatch(
  serial: string,
  packages: string[]
): Promise<InstalledApp[]> {
  return invoke<InstalledApp[]>("get_apps_details_batch", { serial, packages });
}

export async function hdcGetAppsDetailsBatch(
  serial: string,
  packages: string[]
): Promise<any[]> {
  return invoke<any[]>("hdc_get_apps_details_batch", { serial, packages });
}

export async function startApplication(
  serial: string,
  packageName: string
): Promise<void> {
  return invoke<void>("start_application", { serial, package: packageName });
}

export async function stopApplication(
  serial: string,
  packageName: string
): Promise<void> {
  return invoke<void>("stop_application", { serial, package: packageName });
}

export async function clearAppData(
  serial: string,
  packageName: string
): Promise<void> {
  return invoke<void>("clear_app_data", { serial, package: packageName });
}

export async function getDeviceDetails(serial: string): Promise<AdbDevice> {
  return invoke<AdbDevice>("get_device_details", { serial });
}

export async function getDeviceProps(serial: string): Promise<AdbDevice> {
  return invoke<AdbDevice>("get_device_props", { serial });
}

export async function takeScreenshot(serial: string): Promise<string> {
  return invoke<string>("take_screenshot", { serial });
}

export async function pullFile(
  serial: string,
  remotePath: string,
  localPath: string
): Promise<void> {
  return invoke<void>("pull_file", {
    serial,
    remotePath,
    localPath,
  });
}

export async function pushFile(
  serial: string,
  localPath: string,
  remotePath: string
): Promise<void> {
  return invoke<void>("push_file", {
    serial,
    localPath,
    remotePath,
  });
}

export async function executeShell(
  serial: string,
  command: string
): Promise<string> {
  return invoke<string>("execute_shell", { serial, command });
}

export async function getLogcat(
  serial: string,
  lines?: number
): Promise<string> {
  return invoke<string>("get_logcat", { serial, lines });
}

export async function startLogcatStream(serial: string): Promise<void> {
  return invoke<void>("start_logcat_stream", { serial });
}

export async function stopLogcatStream(): Promise<void> {
  return invoke<void>("stop_logcat_stream");
}

export async function getPerformanceInfo(serial: string): Promise<PerformanceInfo> {
  return invoke<PerformanceInfo>("get_performance_info", { serial });
}

export async function getBatteryInfo(serial: string): Promise<any> {
  return invoke<any>("get_battery_info", { serial });
}

export async function getStorageInfo(serial: string): Promise<any> {
  return invoke<any>("get_storage_info", { serial });
}

export async function getMemoryInfo(serial: string): Promise<any> {
  return invoke<any>("get_memory_info", { serial });
}

export async function getAndroidBaseInfo(serial: string): Promise<string> {
  return invoke<string>("get_android_base_info", { serial });
}

export async function getFileList(
  serial: string,
  path: string
): Promise<FileInfo[]> {
  return invoke<FileInfo[]>("get_file_list", { serial, path });
}

export async function parseApkInfo(filePath: string): Promise<ApkInfo> {
  return invoke<ApkInfo>("parse_apk_info", { filePath });
}

export async function checkAdbAvailable(): Promise<boolean> {
  return invoke<boolean>("check_adb_available");
}

export async function getConnectionGuide(): Promise<string> {
  return invoke<string>("get_connection_guide");
}

// Reboot
export async function reboot(serial: string): Promise<void> {
  return invoke<void>("reboot", { serial });
}

export async function rebootRecovery(serial: string): Promise<void> {
  return invoke<void>("reboot_recovery", { serial });
}

export async function rebootBootloader(serial: string): Promise<void> {
  return invoke<void>("reboot_bootloader", { serial });
}

export async function resetAdb(): Promise<void> {
  return invoke<void>("reset_adb");
}

// FPS Monitor
export async function startFpsMonitor(serial: string): Promise<void> {
  return invoke<void>("start_fps_monitor", { serial });
}

export async function stopFpsMonitor(serial: string): Promise<void> {
  return invoke<void>("stop_fps_monitor", { serial });
}

export async function getFpsData(serial: string): Promise<{ timestamp: number; fps: number; foreground_app: string }[]> {
  return invoke<{ timestamp: number; fps: number; foreground_app: string }[]>("get_fps_data", { serial });
}

// Enhanced device info
export async function getTopMemoryApps(serial: string): Promise<{ package_name: string; memory_used: string; memory_used_bytes: number }[]> {
  return invoke<{ package_name: string; memory_used: string; memory_used_bytes: number }[]>("get_top_memory_apps", { serial });
}

export async function getCpuArchitecture(serial: string): Promise<string> {
  return invoke<string>("get_cpu_architecture", { serial });
}

export async function getScreenResolution(serial: string): Promise<string> {
  return invoke<string>("get_screen_resolution", { serial });
}

export async function getScreenRotation(serial: string): Promise<number> {
  return invoke<number>("get_screen_rotation", { serial });
}

export async function setScreenResolution(serial: string, width: number, height: number, density: number): Promise<void> {
  return invoke<void>("set_screen_resolution", { serial, width, height, density });
}

export async function resetScreenResolution(serial: string): Promise<void> {
  return invoke<void>("reset_screen_resolution", { serial });
}

export async function getRunningApps(serial: string): Promise<string> {
  return invoke<string>("get_running_apps", { serial });
}

// Device control
export async function sendTap(serial: string, x: number, y: number): Promise<void> {
  return invoke<void>("send_tap", { serial, x, y });
}

export async function sendSwipe(serial: string, x1: number, y1: number, x2: number, y2: number, duration: number): Promise<void> {
  return invoke<void>("send_swipe", { serial, x1, y1, x2, y2, duration });
}

export async function sendKeyevent(serial: string, keycode: number): Promise<void> {
  return invoke<void>("send_keyevent", { serial, keycode });
}

export async function sendText(serial: string, text: string): Promise<void> {
  return invoke<void>("send_text", { serial, text });
}

export async function setBrightness(serial: string, level: number): Promise<void> {
  return invoke<void>("set_brightness", { serial, level });
}

export async function getBrightness(serial: string): Promise<number> {
  return invoke<number>("get_brightness", { serial });
}

export async function setVolume(serial: string, level: number, stream: string): Promise<void> {
  return invoke<void>("set_volume", { serial, level, stream });
}

export async function getVolume(serial: string, stream: string): Promise<number> {
  return invoke<number>("get_volume", { serial, stream });
}

export async function getWifiState(serial: string): Promise<boolean> {
  return invoke<boolean>("get_wifi_state", { serial });
}

export async function setWifiState(serial: string, enabled: boolean): Promise<void> {
  return invoke<void>("set_wifi_state", { serial, enabled });
}

export async function getAirplaneMode(serial: string): Promise<boolean> {
  return invoke<boolean>("get_airplane_mode", { serial });
}

export async function setAirplaneMode(serial: string, enabled: boolean): Promise<void> {
  return invoke<void>("set_airplane_mode", { serial, enabled });
}

// ============ HarmonyOS HDC API ============

export async function getAllDevices(): Promise<AdbDevice[]> {
  return invoke<AdbDevice[]>("get_all_devices");
}

export async function getHdcDevices(): Promise<any[]> {
  return invoke<any[]>("get_hdc_devices");
}

export async function hdcConnectWifi(ipPort: string): Promise<string> {
  return invoke<string>("hdc_connect_wifi", { ipPort });
}

export async function hdcInstallApp(serial: string, filePath: string): Promise<string> {
  return invoke<string>("hdc_install_app", { serial, filePath });
}

export async function hdcUninstallApp(serial: string, packageName: string): Promise<string> {
    return invoke<string>("hdc_uninstall_app", { serial, package: packageName });
}

export async function hdcClearCache(serial: string, packageName: string): Promise<string> {
    return invoke<string>("hdc_clear_cache", { serial, package: packageName });
}

export async function hdcClearData(serial: string, packageName: string): Promise<string> {
    return invoke<string>("hdc_clear_data", { serial, package: packageName });
}

export async function hdcGetInstalledApps(serial: string): Promise<InstalledApp[]> {
  return invoke<InstalledApp[]>("hdc_get_installed_apps", { serial });
}

export async function hdcGetAppList(serial: string): Promise<Array<{bundleName: string, label: string}>> {
  return invoke<Array<{bundleName: string, label: string}>>("hdc_get_app_list", { serial });
}

export async function hdcGetAppDetail(serial: string, packageName: string): Promise<InstalledApp> {
  return invoke<InstalledApp>("hdc_get_app_detail", { serial, package: packageName });
}

export async function hdcStartApp(serial: string, packageName: string, ability?: string): Promise<string> {
  return invoke<string>("hdc_start_app", { serial, package: packageName, ability: ability || "EntryAbility" });
}

export async function hdcStopApp(serial: string, packageName: string): Promise<string> {
  return invoke<string>("hdc_stop_app", { serial, package: packageName });
}

export async function hdcShell(serial: string, command: string): Promise<string> {
  return invoke<string>("hdc_shell", { serial, command });
}

export async function hdcScreenshot(serial: string): Promise<string> {
  return invoke<string>("hdc_screenshot", { serial });
}

export async function hdcPushFile(serial: string, localPath: string, remotePath: string): Promise<string> {
  return invoke<string>("hdc_push_file", { serial, localPath, remotePath });
}

export async function hdcPullFile(serial: string, remotePath: string, localPath: string): Promise<string> {
  return invoke<string>("hdc_pull_file", { serial, remotePath, localPath });
}

export async function hdcGetFileList(serial: string, path: string): Promise<HdcFileInfo[]> {
  return invoke<HdcFileInfo[]>("hdc_get_file_list", { serial, path });
}

export async function hdcCheckPathsPermission(serial: string, paths: string[]): Promise<Record<string, string>> {
  return invoke<Record<string, string>>("hdc_check_paths_permission", { serial, paths });
}

export async function hdcGetDeviceInfo(serial: string): Promise<any> {
  return invoke<any>("hdc_get_device_info", { serial });
}

export async function hdcReboot(serial: string): Promise<string> {
  return invoke<string>("hdc_reboot", { serial });
}

export async function hdcRebootRecovery(serial: string): Promise<string> {
  return invoke<string>("hdc_reboot_recovery", { serial });
}

export async function hdcRebootBootloader(serial: string): Promise<string> {
  return invoke<string>("hdc_reboot_bootloader", { serial });
}

export async function hdcShutdown(serial: string): Promise<string> {
  return invoke<string>("hdc_shutdown", { serial });
}

export async function hdcBugreport(serial: string, outputPath: string, deviceInfo: Record<string, string>): Promise<string> {
  return invoke<string>("hdc_bugreport", { serial, outputPath, deviceInfo });
}

export async function exportBugreport(
  serial: string,
  outputPath: string,
  deviceInfo: Record<string, string>,
  platform: string,
  lang: string,
): Promise<string> {
  return invoke<string>("export_bugreport", { serial, outputPath, deviceInfo, platform, lang });
}

export async function cancelBugreport(): Promise<boolean> {
  return invoke<boolean>("cancel_bugreport");
}

export async function checkHdcAvailable(): Promise<boolean> {
  return invoke<boolean>("check_hdc_available");
}

export async function getHdcPath(): Promise<string> {
  return invoke<string>("get_hdc_path");
}

export async function setHdcPath(path: string): Promise<void> {
  return invoke<void>("set_hdc_path", { path });
}

export async function getAdbVersion(): Promise<string> {
  return invoke<string>("get_adb_version");
}

export async function getHdcVersion(): Promise<string> {
  return invoke<string>("get_hdc_version");
}

// HarmonyOS 性能监控
export interface HdcPerformanceInfo {
  cpu_usage: number;
  memory_total: number;
  memory_used: number;
  memory_free: number;
  battery_level: number;
  battery_status: string;
  storage_total: number;
  storage_used: number;
  storage_free: number;
}

export async function hdcGetPerformanceInfo(serial: string): Promise<HdcPerformanceInfo> {
  return invoke<HdcPerformanceInfo>("hdc_get_performance_info", { serial });
}

export async function hdcGetCpuUsage(serial: string): Promise<HdcCpuUsageResult> {
  return invoke<HdcCpuUsageResult>("hdc_get_cpu_usage", { serial });
}

export interface HdcCpuUsageResult {
  usage: number;
  raw: string;
}

export interface HdcMemoryInfo {
  total: number;
  used: number;
  free: number;
  raw: string;
}

export async function hdcGetMemoryInfo(serial: string): Promise<HdcMemoryInfo> {
  return invoke<HdcMemoryInfo>("hdc_get_memory_info", { serial });
}

export interface HdcBatteryInfo {
  level: number;
  status: string;
  temperature: number;
  voltage: number;
  current: number;
  health: string;
  plugged_type: string;
  technology: string;
  remaining_energy: number;
  total_energy: number;
  charge_type: string;
  raw: string;
}

export async function hdcGetBatteryInfo(serial: string): Promise<HdcBatteryInfo> {
  return invoke<HdcBatteryInfo>("hdc_get_battery_info", { serial });
}

export interface HdcStorageInfo {
  total: number;
  used: number;
  free: number;
  raw: string;
}

export async function hdcGetStorageInfo(serial: string): Promise<HdcStorageInfo> {
  return invoke<HdcStorageInfo>("hdc_get_storage_info", { serial });
}

export async function hdcGetBaseInfo(serial: string): Promise<string> {
  return invoke<string>("hdc_get_base_info", { serial });
}

export async function restartAdbService(): Promise<string> {
  return invoke<string>("restart_adb_service");
}

export async function restartHdcService(): Promise<string> {
  return invoke<string>("restart_hdc_service");
}
