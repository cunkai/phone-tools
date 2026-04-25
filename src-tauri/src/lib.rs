pub mod adb;
pub mod automation;
pub mod commands;
pub mod events;
pub mod hdc;
pub mod state;
pub mod utils;

use state::AppState;
use tauri::RunEvent;

/// 启动 Tauri 应用
pub fn run() {
    // 运行应用
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            // 设备管理
            commands::get_devices,
            commands::connect_wifi_device,
            commands::disconnect_device,
            commands::get_device_details,
            commands::get_device_props,
            commands::get_device_ip,
            commands::set_current_device,
            commands::get_current_device,
            // 应用管理
            commands::install_app,
            commands::uninstall_app,
            commands::get_installed_apps,
            commands::get_app_details,
            commands::get_apps_details_batch,
            commands::start_application,
            commands::stop_application,
            commands::clear_app_data,
            commands::parse_apk_info,
            // 文件操作
            commands::take_screenshot,
            commands::pull_file,
            commands::push_file,
            commands::get_file_list,
            // Shell 和日志
            commands::execute_shell,
            commands::get_logcat,
            commands::start_logcat_stream,
            commands::stop_logcat_stream,
            // 性能监控
            commands::get_performance_info,
            commands::get_battery_info,
            commands::get_storage_info,
            commands::get_memory_info,
            commands::get_android_base_info,
            // ADB 管理
            commands::check_adb_available,
            commands::get_adb_version,
            commands::get_adb_path,
            commands::set_adb_path,
            commands::enable_wifi_adb,
            // 重启命令 (Feature 1)
            commands::reboot,
            commands::reboot_recovery,
            commands::reboot_bootloader,
            commands::reset_adb,
            // 帧率检测 (Feature 3)
            commands::start_fps_monitor,
            commands::stop_fps_monitor,
            commands::get_fps_data,
            // 增强设备信息 (Feature 4)
            commands::get_top_memory_apps,
            commands::get_cpu_architecture,
            commands::get_screen_resolution,
            commands::get_screen_rotation,
            commands::set_screen_resolution,
            commands::reset_screen_resolution,
            commands::get_running_apps,
            // 设备控制 (Feature 5)
            commands::send_tap,
            commands::send_swipe,
            commands::send_keyevent,
            commands::send_text,
            commands::set_brightness,
            commands::get_brightness,
            commands::set_volume,
            commands::get_wifi_state,
            commands::set_wifi_state,
            commands::set_airplane_mode,
            commands::get_volume,
            commands::get_airplane_mode,
            // 实时屏幕流
            commands::start_screen_stream,
            commands::stop_screen_stream,
            // 工具
            commands::get_connection_guide,
            // HarmonyOS HDC 命令
            commands::get_all_devices,
            commands::get_hdc_devices,
            commands::hdc_connect_wifi,
            commands::hdc_install_app,
            commands::hdc_uninstall_app,
            commands::hdc_clear_cache,
            commands::hdc_clear_data,
            commands::hdc_get_installed_apps,
            commands::hdc_get_app_list,
            commands::hdc_get_app_detail,
            commands::hdc_get_apps_details_batch,
            commands::hdc_start_app,
            commands::hdc_stop_app,
            commands::hdc_shell,
            commands::hdc_screenshot,
            commands::hdc_push_file,
            commands::hdc_pull_file,
            commands::hdc_get_file_list,
            commands::hdc_check_paths_permission,
            commands::hdc_get_device_info,
            commands::hdc_reboot,
            commands::hdc_reboot_recovery,
            commands::hdc_reboot_bootloader,
            commands::hdc_shutdown,
            commands::export_bugreport,
            commands::cancel_bugreport,
            commands::check_hdc_available,
            commands::get_hdc_path,
            commands::set_hdc_path,
            commands::get_hdc_version,
            // HarmonyOS 性能监控
            commands::hdc_get_performance_info,
            commands::hdc_get_cpu_usage,
            commands::hdc_get_memory_info,
            commands::hdc_get_battery_info,
            commands::hdc_get_storage_info,
            commands::hdc_get_base_info,
            commands::restart_adb_service,
            commands::restart_hdc_service,
            automation::execute_action,
            automation::stop_automation,
            automation::reset_automation,
        ])
        .setup(|app| {
            // 应用初始化逻辑
            #[cfg(debug_assertions)]
            {
                println!("Android Toolbox 启动 (调试模式)");
            }
            Ok(())
        })
        // 👇 关键：先 build
        .build(tauri::generate_context!())
        .expect("error while building tauri app")
        // 👇 再 run（这里才有事件）
        .run(|_app_handle, event| {
            match event {
                RunEvent::ExitRequested { api, .. } => {
                    println!("应用准备退出");

                    // 阻止退出（可选）
                    // api.prevent_exit();
                }
                RunEvent::Exit => {
                    println!("应用已经退出");
                    // 终止 adb.exe 进程
                    let _ = std::process::Command::new("taskkill")
                        .args(["/f", "/im", "adb.exe"])
                        .output();
                    
                    // 终止 hdc.exe 进程
                    let _ = std::process::Command::new("taskkill")
                        .args(["/f", "/im", "hdc.exe"])
                        .output();

                }
                _ => {}
            }
        });
        
}
