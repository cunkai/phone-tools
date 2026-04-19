use serde::{Deserialize, Serialize};
use tauri::State;
use std::sync::atomic::Ordering;
use base64::Engine;
use image::GenericImageView;

use crate::adb::AdbCommand;
use crate::hdc::HdcCommand;
use crate::state::AppState;

// ==================== 数据结构 ====================

/// 坐标点
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point {
    pub x: u32,
    pub y: u32,
}

/// RGBA 颜色
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    #[serde(default = "default_alpha")]
    pub a: u8,
}

fn default_alpha() -> u8 { 255 }

/// 传给 execute_action 的完整 action 对象
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Action {
    pub r#type: String,
    pub params: serde_json::Value,
}

/// execute_action 的返回值
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_color: Option<Color>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub matched: Option<bool>,
}

// ==================== 核心命令 ====================

/// 执行单个 action（支持 Android 和 HarmonyOS）
#[tauri::command]
pub async fn execute_action(
    state: State<'_, AppState>,
    serial: String,
    platform: String,
    action: Action,
) -> Result<ActionResult, String> {
    // 检查取消标志
    if state.automation_cancel.load(Ordering::Relaxed) {
        return Err("执行已取消".to_string());
    }

    let result = match action.r#type.as_str() {
        "tap" => execute_tap(&state, &serial, &platform, &action.params).await,
        "double_tap" => execute_double_tap(&state, &serial, &platform, &action.params).await,
        "long_press" => execute_long_press(&state, &serial, &platform, &action.params).await,
        "swipe" => execute_swipe(&state, &serial, &platform, &action.params).await,
        "drag" => execute_drag(&state, &serial, &platform, &action.params).await,
        "keyevent" => execute_keyevent(&state, &serial, &platform, &action.params).await,
        "media_key" => execute_media_key(&state, &serial, &platform, &action.params).await,
        "device_action" => execute_device_action(&state, &serial, &platform, &action.params).await,
        "gamepad" => execute_gamepad(&state, &serial, &platform, &action.params).await,
        "text" => execute_text(&state, &serial, &platform, &action.params).await,
        "open_url" => execute_open_url(&state, &serial, &platform, &action.params).await,
        "shell" => execute_shell_cmd(&state, &serial, &platform, &action.params).await,
        "open_app" => execute_open_app(&state, &serial, &platform, &action.params).await,
        "delay" => execute_delay(&state, &action.params).await,
        "condition" => execute_condition(&state, &serial, &platform, &action.params).await,
        other => Err(format!("未知操作类型: {}", other)),
    };

    result
}

/// 停止自动化执行
#[tauri::command]
pub async fn stop_automation(state: State<'_, AppState>) -> Result<(), String> {
    state.automation_cancel.store(true, Ordering::Relaxed);
    Ok(())
}

/// 重置取消标志（执行前调用）
#[tauri::command]
pub async fn reset_automation(state: State<'_, AppState>) -> Result<(), String> {
    state.automation_cancel.store(false, Ordering::Relaxed);
    Ok(())
}

// ==================== 操作实现 ====================

fn ok() -> ActionResult {
    ActionResult { success: true, message: None, actual_color: None, matched: None }
}

fn is_cancelled(state: &State<'_, AppState>) -> bool {
    state.automation_cancel.load(Ordering::Relaxed)
}

/// 单击
async fn execute_tap(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let tap: Point = serde_json::from_value(params["tap"].clone())
        .map_err(|e| format!("解析 tap 参数失败: {}", e))?;

    match platform {
        "harmonyos" => {
            let hdc = HdcCommand::new(&state.get_hdc_path());
            // uinput -T -c X Y
            hdc.execute(&["-t", serial, "shell", "uinput", "-T", "-c",
                &tap.x.to_string(), &tap.y.to_string()]).await
                .map_err(|e| e.to_string())?;
        }
        _ => {
            let adb = AdbCommand::new(&state.get_adb_path());
            adb.send_tap(serial, tap.x, tap.y).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(ok())
}

/// 双击
async fn execute_double_tap(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let tap: Point = serde_json::from_value(params["double_tap"].clone())
        .map_err(|e| format!("解析 double_tap 参数失败: {}", e))?;

    match platform {
        "harmonyos" => {
            let hdc = HdcCommand::new(&state.get_hdc_path());
            // uinput -M -b X Y 0 10 10
            hdc.execute(&["-t", serial, "shell", "uinput", "-M", "-b",
                &tap.x.to_string(), &tap.y.to_string(), "0", "10", "10"]).await
                .map_err(|e| e.to_string())?;
        }
        _ => {
            let adb = AdbCommand::new(&state.get_adb_path());
            adb.send_tap(serial, tap.x, tap.y).await.map_err(|e| e.to_string())?;
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            if is_cancelled(state) { return Err("执行已取消".to_string()); }
            adb.send_tap(serial, tap.x, tap.y).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(ok())
}

/// 长按
async fn execute_long_press(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let lp = &params["long_press"];
    let x: u32 = serde_json::from_value(lp["x"].clone()).map_err(|e| format!("解析 long_press.x 失败: {}", e))?;
    let y: u32 = serde_json::from_value(lp["y"].clone()).map_err(|e| format!("解析 long_press.y 失败: {}", e))?;
    let duration: u32 = serde_json::from_value(lp["duration"].clone()).unwrap_or(1000);

    match platform {
        "harmonyos" => {
            let hdc = HdcCommand::new(&state.get_hdc_path());
            // uinput -T -d X Y -> sleep -> uinput -T -u X Y
            hdc.execute(&["-t", serial, "shell", "uinput", "-T", "-d",
                &x.to_string(), &y.to_string()]).await
                .map_err(|e| e.to_string())?;
            tokio::time::sleep(std::time::Duration::from_millis(duration as u64)).await;
            if is_cancelled(state) { return Err("执行已取消".to_string()); }
            hdc.execute(&["-t", serial, "shell", "uinput", "-T", "-u",
                &x.to_string(), &y.to_string()]).await
                .map_err(|e| e.to_string())?;
        }
        _ => {
            let adb = AdbCommand::new(&state.get_adb_path());
            // adb shell input swipe X Y X Y DURATION
            adb.send_swipe(serial, x, y, x, y, duration).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(ok())
}

/// 滑动
async fn execute_swipe(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let sw = &params["swipe"];
    let from: Point = serde_json::from_value(sw["from"].clone()).map_err(|e| format!("解析 swipe.from 失败: {}", e))?;
    let to: Point = serde_json::from_value(sw["to"].clone()).map_err(|e| format!("解析 swipe.to 失败: {}", e))?;
    let duration: u32 = serde_json::from_value(sw["duration"].clone()).unwrap_or(300);

    match platform {
        "harmonyos" => {
            let hdc = HdcCommand::new(&state.get_hdc_path());
            // uinput -T -m X1 Y1 X2 Y2 DURATION
            hdc.execute(&["-t", serial, "shell", "uinput", "-T", "-m",
                &from.x.to_string(), &from.y.to_string(),
                &to.x.to_string(), &to.y.to_string(),
                &duration.to_string()]).await
                .map_err(|e| e.to_string())?;
        }
        _ => {
            let adb = AdbCommand::new(&state.get_adb_path());
            adb.send_swipe(serial, from.x, from.y, to.x, to.y, duration).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(ok())
}

/// 拖拽
async fn execute_drag(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let dr = &params["drag"];
    let from: Point = serde_json::from_value(dr["from"].clone()).map_err(|e| format!("解析 drag.from 失败: {}", e))?;
    let to: Point = serde_json::from_value(dr["to"].clone()).map_err(|e| format!("解析 drag.to 失败: {}", e))?;
    let duration: u32 = serde_json::from_value(dr["duration"].clone()).unwrap_or(1000);

    match platform {
        "harmonyos" => {
            let hdc = HdcCommand::new(&state.get_hdc_path());
            // uinput -M -g X1 Y1 X2 Y2 DURATION
            hdc.execute(&["-t", serial, "shell", "uinput", "-M", "-g",
                &from.x.to_string(), &from.y.to_string(),
                &to.x.to_string(), &to.y.to_string(),
                &duration.to_string()]).await
                .map_err(|e| e.to_string())?;
        }
        _ => {
            let adb = AdbCommand::new(&state.get_adb_path());
            adb.send_swipe(serial, from.x, from.y, to.x, to.y, duration).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(ok())
}

/// 发送按键
async fn execute_keyevent(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let action: String = serde_json::from_value(params["keyevent"]["action"].clone())
        .unwrap_or_else(|_| "press".to_string());
    let duration: u32 = serde_json::from_value(params["keyevent"]["duration"].clone()).unwrap_or(3000);
    let input_mode: String = serde_json::from_value(params["keyevent"]["inputMode"].clone())
        .unwrap_or_else(|_| "preset".to_string());

    // 字母数字模式：拆分逐个执行
    if input_mode == "text" {
        let text_input: String = serde_json::from_value(params["keyevent"]["textInput"].clone())
            .unwrap_or_default();
        if text_input.is_empty() {
            return Err("字母数字输入为空".to_string());
        }
        let chars: Vec<char> = text_input.chars().collect();
        for ch in &chars {
            if is_cancelled(state) { return Err("执行已取消".to_string()); }
            let code = char_to_keycode(*ch);
            execute_single_key(state, serial, platform, code, &action, duration).await?;
        }
        return Ok(ok());
    }

    // 普通模式：单个按键码
    let code: u32 = serde_json::from_value(params["keyevent"]["code"].clone())
        .map_err(|e| format!("解析 keyevent.code 失败: {}", e))?;
    execute_single_key(state, serial, platform, code, &action, duration).await
}

/// 字符转鸿蒙 KeyCode
fn char_to_keycode(ch: char) -> u32 {
    if ch >= '0' && ch <= '9' { return 2000 + (ch as u32 - '0' as u32); }
    if ch >= 'A' && ch <= 'Z' { return 2017 + (ch as u32 - 'A' as u32); }
    if ch >= 'a' && ch <= 'z' { return 2017 + (ch as u32 - 'a' as u32); }
    match ch {
        ',' => 2043, '.' => 2044, '-' => 2057, '=' => 2058,
        '[' => 2059, ']' => 2060, '\\' => 2061, ';' => 2062,
        '\'' => 2063, '/' => 2064, '@' => 2065, '+' => 2066,
        '`' => 2056, ' ' => 2050, '\n' => 2054,
        _ => 0, // 未知字符
    }
}

/// 执行单个按键
async fn execute_single_key(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    code: u32,
    action: &str,
    duration: u32,
) -> Result<ActionResult, String> {
    match platform {
        "harmonyos" => {
            let hdc = HdcCommand::new(&state.get_hdc_path());
            match action {
                "press" => {
                    hdc.execute(&["-t", serial, "shell", "uinput", "-K", "-d",
                        &code.to_string()]).await
                        .map_err(|e| e.to_string())?;
                }
                "release" => {
                    hdc.execute(&["-t", serial, "shell", "uinput", "-K", "-u",
                        &code.to_string()]).await
                        .map_err(|e| e.to_string())?;
                }
                "long_press" => {
                    hdc.execute(&["-t", serial, "shell", "uinput", "-K", "-l",
                        &code.to_string(), &duration.to_string()]).await
                        .map_err(|e| e.to_string())?;
                }
                _ => {
                    return Err(format!("未知的 keyevent action: {}", action));
                }
            }
        }
        _ => {
            let adb = AdbCommand::new(&state.get_adb_path());
            adb.send_keyevent(serial, code).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(ok())
}

/// 发送媒体按键（与 keyevent 逻辑相同，媒体键也是 uinput -K 命令）
async fn execute_media_key(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let code: u32 = serde_json::from_value(params["media_key"]["code"].clone())
        .map_err(|e| format!("解析 media_key.code 失败: {}", e))?;
    let action: String = serde_json::from_value(params["media_key"]["action"].clone())
        .unwrap_or_else(|_| "press".to_string());
    let duration: u32 = serde_json::from_value(params["media_key"]["duration"].clone()).unwrap_or(3000);

    match platform {
        "harmonyos" => {
            let hdc = HdcCommand::new(&state.get_hdc_path());
            match action.as_str() {
                "press" => {
                    hdc.execute(&["-t", serial, "shell", "uinput", "-K", "-d",
                        &code.to_string()]).await
                        .map_err(|e| e.to_string())?;
                }
                "release" => {
                    hdc.execute(&["-t", serial, "shell", "uinput", "-K", "-u",
                        &code.to_string()]).await
                        .map_err(|e| e.to_string())?;
                }
                "long_press" => {
                    hdc.execute(&["-t", serial, "shell", "uinput", "-K", "-l",
                        &code.to_string(), &duration.to_string()]).await
                        .map_err(|e| e.to_string())?;
                }
                _ => {
                    return Err(format!("未知的 media_key action: {}", action));
                }
            }
        }
        _ => {
            let adb = AdbCommand::new(&state.get_adb_path());
            adb.send_keyevent(serial, code).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(ok())
}

/// 设备操作（亮度、音量、拍照等，按下并立即抬起）
async fn execute_device_action(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let action: String = serde_json::from_value(params["device_action"]["action"].clone())
        .unwrap_or_else(|_| "volume_up".to_string());
    let timeout_ms: u32 = serde_json::from_value(params["device_action"]["timeout_ms"].clone()).unwrap_or(15000);

    match platform {
        "harmonyos" => {
            let hdc = HdcCommand::new(&state.get_hdc_path());
            let cmd = match action.as_str() {
                "volume_up" => "uinput -K -d 16 -u 16",
                "volume_down" => "uinput -K -d 17 -u 17",
                "mute" => "uinput -K -d 22 -u 22",
                "power" => "uinput -K -d 18 -u 18",
                "camera" => "uinput -K -d 19 -u 19",
                "wakeup" => "power-shell wakeup",
                "suspend" => "power-shell suspend",
                "auto_screen_off" => &format!("power-shell timeout -o {}", timeout_ms),
                "restore_screen_off" => "power-shell timeout -r",
                "mode_normal" => "power-shell setmode 600",
                "mode_power_save" => "power-shell setmode 601",
                "mode_performance" => "power-shell setmode 602",
                "mode_super_save" => "power-shell setmode 603",
                _ => return Err(format!("未知的设备操作: {}", action)),
            };
            hdc.execute(&["-t", serial, "shell", cmd]).await
                .map_err(|e| e.to_string())?;
        }
        _ => {
            let adb = AdbCommand::new(&state.get_adb_path());
            let keycode = match action.as_str() {
                "volume_up" => 24,
                "volume_down" => 25,
                "mute" => 164,
                "power" => 26,
                "camera" => 27,
                "wakeup" | "suspend" | "auto_screen_off" | "restore_screen_off"
                | "mode_normal" | "mode_power_save" | "mode_performance" | "mode_super_save" => {
                    return Err(format!("Android 暂不支持该操作: {}", action));
                }
                _ => return Err(format!("未知的设备操作: {}", action)),
            };
            adb.send_keyevent(serial, keycode).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(ok())
}

/// 游戏手柄按键（与 keyevent 逻辑相同，游戏手柄键也是 uinput -K 命令）
async fn execute_gamepad(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let code: u32 = serde_json::from_value(params["gamepad"]["code"].clone())
        .map_err(|e| format!("解析 gamepad.code 失败: {}", e))?;
    let action: String = serde_json::from_value(params["gamepad"]["action"].clone())
        .unwrap_or_else(|_| "press".to_string());
    let duration: u32 = serde_json::from_value(params["gamepad"]["duration"].clone()).unwrap_or(3000);

    match platform {
        "harmonyos" => {
            let hdc = HdcCommand::new(&state.get_hdc_path());
            match action.as_str() {
                "press" => {
                    hdc.execute(&["-t", serial, "shell", "uinput", "-K", "-d",
                        &code.to_string()]).await
                        .map_err(|e| e.to_string())?;
                }
                "release" => {
                    hdc.execute(&["-t", serial, "shell", "uinput", "-K", "-u",
                        &code.to_string()]).await
                        .map_err(|e| e.to_string())?;
                }
                "long_press" => {
                    hdc.execute(&["-t", serial, "shell", "uinput", "-K", "-l",
                        &code.to_string(), &duration.to_string()]).await
                        .map_err(|e| e.to_string())?;
                }
                _ => {
                    return Err(format!("未知的 gamepad action: {}", action));
                }
            }
        }
        _ => {
            let adb = AdbCommand::new(&state.get_adb_path());
            adb.send_keyevent(serial, code).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(ok())
}

/// 输入文本
async fn execute_text(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let content: String = serde_json::from_value(params["text"]["content"].clone())
        .map_err(|e| format!("解析 text.content 失败: {}", e))?;

    match platform {
        "harmonyos" => {
            let hdc = HdcCommand::new(&state.get_hdc_path());
            // uinput -K -t 最大支持2000字符，超出需分批发送
            let max_len = 2000;
            if content.len() <= max_len {
                hdc.execute(&["-t", serial, "shell", "uinput", "-K", "-t", &content]).await
                    .map_err(|e| e.to_string())?;
            } else {
                let mut offset = 0;
                while offset < content.len() {
                    if is_cancelled(state) { return Err("执行已取消".to_string()); }
                    let end = (offset + max_len).min(content.len());
                    let mut cut = end;
                    while cut > offset && (content.as_bytes()[cut] & 0xC0) == 0x80 {
                        cut -= 1;
                    }
                    let batch = &content[offset..cut];
                    hdc.execute(&["-t", serial, "shell", "uinput", "-K", "-t", batch]).await
                        .map_err(|e| e.to_string())?;
                    offset = cut;
                }
            }
        }
        _ => {
            let adb = AdbCommand::new(&state.get_adb_path());
            adb.send_text(serial, &content).await.map_err(|e| e.to_string())?;
        }
    }
    Ok(ok())
}

/// 打开网页
async fn execute_open_url(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let url: String = serde_json::from_value(params["open_url"]["url"].clone())
        .map_err(|e| format!("解析 open_url.url 失败: {}", e))?;

    match platform {
        "harmonyos" => {
            let hdc = HdcCommand::new(&state.get_hdc_path());
            hdc.execute(&["-t", serial, "shell", "aa", "start", "-A", "ohos.want.action.viewData", "-U", &url]).await
                .map_err(|e| e.to_string())?;
        }
        _ => {
            let adb = AdbCommand::new(&state.get_adb_path());
            adb.execute(&["-s", serial, "shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", &url]).await
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(ActionResult { success: true, message: Some(format!("已打开: {}", url)), actual_color: None, matched: None })
}

/// 执行Shell命令
async fn execute_shell_cmd(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let command: String = serde_json::from_value(params["shell"]["command"].clone())
        .map_err(|e| format!("解析 shell.command 失败: {}", e))?;

    let output = match platform {
        "harmonyos" => {
            let hdc = HdcCommand::new(&state.get_hdc_path());
            hdc.execute(&["-t", serial, "shell", &command]).await
                .map_err(|e| e.to_string())?
        }
        _ => {
            let adb = AdbCommand::new(&state.get_adb_path());
            adb.execute(&["-s", serial, "shell", &command]).await
                .map_err(|e| e.to_string())?
        }
    };

    // 截取前500字符避免过长
    let display = if output.len() > 500 {
        format!("{}...", &output[..500])
    } else {
        output
    };
    Ok(ActionResult { success: true, message: Some(display), actual_color: None, matched: None })
}

/// 打开软件
async fn execute_open_app(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let package: String = serde_json::from_value(params["open_app"]["package"].clone())
        .map_err(|e| format!("解析 open_app.package 失败: {}", e))?;

    match platform {
        "harmonyos" => {
            let hdc = HdcCommand::new(&state.get_hdc_path());
            hdc.execute(&["-t", serial, "shell", "aa", "start", "-a", &package]).await
                .map_err(|e| e.to_string())?;
        }
        _ => {
            let adb = AdbCommand::new(&state.get_adb_path());
            adb.execute(&["-s", serial, "shell", "monkey", "-p", &package, "-c", "android.intent.category.LAUNCHER", "1"]).await
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(ok())
}

/// 延迟
async fn execute_delay(
    state: &State<'_, AppState>,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let ms: u64 = serde_json::from_value(params["delay"]["ms"].clone())
        .map_err(|e| format!("解析 delay.ms 失败: {}", e))?;

    // 分段 sleep 以便响应取消
    let chunk = 100u64;
    let mut remaining = ms;
    while remaining > 0 {
        if is_cancelled(state) { return Err("执行已取消".to_string()); }
        let sleep_time = remaining.min(chunk);
        tokio::time::sleep(std::time::Duration::from_millis(sleep_time)).await;
        remaining -= sleep_time;
    }
    Ok(ok())
}

/// 条件判断（像素颜色检测）
async fn execute_condition(
    state: &State<'_, AppState>,
    serial: &str,
    platform: &str,
    params: &serde_json::Value,
) -> Result<ActionResult, String> {
    let cond = &params["condition"];
    let target: Point = serde_json::from_value(cond["target"].clone())
        .map_err(|e| format!("解析 condition.target 失败: {}", e))?;
    let expected: Color = serde_json::from_value(cond["expected"].clone())
        .map_err(|e| format!("解析 condition.expected 失败: {}", e))?;
    let tolerance: u8 = serde_json::from_value(cond["tolerance"].clone()).unwrap_or(30);
    let timeout: u64 = serde_json::from_value(cond["timeout"].clone()).unwrap_or(5000);
    let interval: u64 = serde_json::from_value(cond["interval"].clone()).unwrap_or(500);

    let start = std::time::Instant::now();
    let timeout_dur = std::time::Duration::from_millis(timeout);
    let interval_dur = std::time::Duration::from_millis(interval);

    loop {
        if is_cancelled(state) { return Err("执行已取消".to_string()); }

        // 截图获取 base64
        let base64_img = match platform {
            "harmonyos" => {
                let hdc = HdcCommand::new(&state.get_hdc_path());
                hdc.screenshot(serial).await.map_err(|e| e.to_string())?
            }
            _ => {
                let adb = AdbCommand::new(&state.get_adb_path());
                adb.screenshot(serial).await.map_err(|e| e.to_string())?
            }
        };

        // 解码 base64 -> 读取像素
        let img_data = base64::engine::general_purpose::STANDARD
            .decode(&base64_img).map_err(|e| format!("base64 解码失败: {}", e))?;

        // 用 tauri 内置的 image 解码
        let image = image::load_from_memory(&img_data)
            .map_err(|e| format!("图片解码失败: {}", e))?;

        // 检查坐标是否在图片范围内
        if target.x >= image.width() || target.y >= image.height() {
            return Err(format!("坐标 ({}, {}) 超出图片范围 ({}x{})",
                target.x, target.y, image.width(), image.height()));
        }

        let pixel = image.get_pixel(target.x, target.y);
        let actual = Color {
            r: pixel[0],
            g: pixel[1],
            b: pixel[2],
            a: pixel[3],
        };

        // 比较颜色（带容差）
        let matched = color_matches(&actual, &expected, tolerance);

        if matched {
            return Ok(ActionResult {
                success: true,
                actual_color: Some(actual),
                matched: Some(true),
                message: None,
            });
        }

        // 超时检查
        if start.elapsed() >= timeout_dur {
            return Ok(ActionResult {
                success: true,
                actual_color: Some(actual),
                matched: Some(false),
                message: Some(format!(
                    "条件不匹配: 期望 rgba({},{},{},{}) 实际 rgba({},{},{},{}) 容差 {}",
                    expected.r, expected.g, expected.b, expected.a,
                    actual.r, actual.g, actual.b, actual.a,
                    tolerance
                )),
            });
        }

        tokio::time::sleep(interval_dur).await;
    }
}

fn color_matches(actual: &Color, expected: &Color, tolerance: u8) -> bool {
    let dr = (actual.r as i16 - expected.r as i16).abs();
    let dg = (actual.g as i16 - expected.g as i16).abs();
    let db = (actual.b as i16 - expected.b as i16).abs();
    let da = (actual.a as i16 - expected.a as i16).abs();
    dr <= tolerance as i16 && dg <= tolerance as i16 && db <= tolerance as i16 && da <= tolerance as i16
}
