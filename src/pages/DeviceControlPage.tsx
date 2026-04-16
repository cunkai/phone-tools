import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeviceStore } from "../store/deviceStore";
import { ScreenStream } from "../api/screenStream";
import { adbQueue, enqueueTap, enqueueSwipe, enqueueKeyevent, enqueueText, enqueueBrightness, enqueueVolume } from "../api/adbQueue";
import {
  sendTap,
  sendSwipe,
  sendKeyevent,
  sendText,
  setBrightness,
  getBrightness,
  setVolume,
  getVolume,
  getWifiState,
  setWifiState,
  getAirplaneMode,
  setAirplaneMode,
  reboot,
  rebootRecovery,
  rebootBootloader,
  setScreenResolution,
  getScreenResolution,
  resetScreenResolution,
  takeScreenshot,
} from "../api/adb";

const DeviceControlPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentDevice, setAdbBusy } = useDeviceStore();

  // Touchpad state
  const touchpadRef = useRef<HTMLDivElement>(null);
  const startPosRef = useRef({ x: 0, y: 0 }); // 用 ref 存起始位置，避免闭包捕获旧值
  const [isPressed, setIsPressed] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  // 显示分辨率：从截图实际尺寸获取，横屏时自动切换为 1920x1200
  const [displayWidth, setDisplayWidth] = useState(1200);
  const [displayHeight, setDisplayHeight] = useState(1920);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });

  // 监听容器大小变化
  useEffect(() => {
    const updateSize = () => {
      // 获取 main 容器大小（触摸板的父容器）
      const main = document.querySelector('main');
      if (main) {
        const rect = main.getBoundingClientRect();
        setContainerSize({ w: rect.width - 48, h: rect.height - 48 }); // 减去 padding
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // 根据屏幕比例和容器大小计算触摸板实际像素尺寸
  const touchpadSize = useMemo(() => {
    const maxW = containerSize.w;
    const maxH = containerSize.h * 0.85; // 留一些空间给按钮等
    const ratio = displayWidth / displayHeight;

    let w: number, h: number;
    if (ratio >= maxW / maxH) {
      // 宽度受限
      w = maxW;
      h = maxW / ratio;
    } else {
      // 高度受限
      h = maxH;
      w = maxH * ratio;
    }
    return { w: `${Math.round(w)}px`, h: `${Math.round(h)}px` };
  }, [displayWidth, displayHeight, containerSize]);
  // 实时屏幕流
  const [streamEnabled, setStreamEnabled] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streamFrames, setStreamFrames] = useState(0);
  const [streamInterval, setStreamInterval] = useState(3); // 默认 3 秒
  const [editingInterval, setEditingInterval] = useState(false);
  const streamRef = useRef<ScreenStream | null>(null);
  const streamImgRef = useRef<HTMLImageElement>(null);

  // Text input state
  const [inputText, setInputText] = useState("");

  // Settings state
  const [brightness, setBrightnessState] = useState(128);
  const [wifiEnabled, setWifiEnabledState] = useState(false);
  const [airplaneMode, setAirplaneModeState] = useState(false);
  const [volume, setVolumeState] = useState(7);

  // 初始化：读取设备状态（亮度、音量、WiFi、飞行模式）
  useEffect(() => {
    if (!currentDevice) return;

    const loadDeviceState = async () => {
      // 亮度
      try {
        const b = await getBrightness(currentDevice);
        setBrightnessState(b);
      } catch {}

      // 音量
      try {
        const v = await getVolume(currentDevice, "music");
        setVolumeState(v);
      } catch {}

      // WiFi
      try {
        const w = await getWifiState(currentDevice);
        setWifiEnabledState(w);
      } catch {}

      // 飞行模式
      try {
        const a = await getAirplaneMode(currentDevice);
        setAirplaneModeState(a);
      } catch {}
    };

    loadDeviceState();
  }, [currentDevice]);

  // Resolution state
  const [resWidth, setResWidth] = useState("1080");
  const [resHeight, setResHeight] = useState("2400");
  const [resDensity, setResDensity] = useState("440");

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [confirmMessage, setConfirmMessage] = useState("");

  const loadSettings = useCallback(async () => {
    if (!currentDevice) return;
    try {
      const [b, w] = await Promise.all([getBrightness(currentDevice), getWifiState(currentDevice)]);
      setBrightnessState(b);
      setWifiEnabledState(w);
    } catch {
      // ignore errors
    }
  }, [currentDevice]);

  // 不自动加载设置，用户手动点击刷新

  // Touchpad handlers
  const handleTouchpadMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!currentDevice) return;
      e.preventDefault();

      const rect = touchpadRef.current!.getBoundingClientRect();
      const sw = displayWidth;
      const sh = displayHeight;

      // 记录起始位置
      const startNx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const startNy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      startPosRef.current = {
        x: Math.round(startNx * sw),
        y: Math.round(startNy * sh),
      };
      setIsPressed(true);

      const handleUp = (ev: MouseEvent) => {
        document.removeEventListener("mouseup", handleUp);

        const start = startPosRef.current;

        // 计算结束位置
        const endNx = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const endNy = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
        const endX = Math.round(endNx * sw);
        const endY = Math.round(endNy * sh);

        const dx = endX - start.x;
        const dy = endY - start.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 10) {
          // Tap（通过队列，去重只保留最后一次）
          enqueueTap(() => sendTap(currentDevice, endX, endY));
        } else {
          // Swipe（通过队列）
          const duration = Math.max(300, Math.min(1500, Math.round(distance * 2)));
          enqueueSwipe(() => sendSwipe(currentDevice, start.x, start.y, endX, endY, duration));
        }
        setIsPressed(false);
      };

      document.addEventListener("mouseup", handleUp);
    },
    [currentDevice, displayWidth, displayHeight]
  );

  // 截图核心函数（手动截图用）
  const doScreenshot = useCallback(async () => {
    if (!currentDevice) return;
    try {
      const data = await takeScreenshot(currentDevice);
      setScreenshot(data);
      const img = new Image();
      img.onload = () => {
        setDisplayWidth(img.naturalWidth);
        setDisplayHeight(img.naturalHeight);
      };
      img.src = `data:image/png;base64,${data}`;
    } catch {
      useDeviceStore.getState().fetchDevices();
    }
  }, [currentDevice]);

  const handleScreenshot = useCallback(async () => {
    setScreenshotLoading(true);
    await doScreenshot();
    setScreenshotLoading(false);
  }, [doScreenshot]);

  // 实时屏幕流控制
  const toggleStream = useCallback(async () => {
    if (streamEnabled) {
      // 停止
      setAdbBusy(false);
      await streamRef.current?.stop();
      streamRef.current = null;
      setStreamEnabled(false);
      setStreamError(null);
      setStreamFrames(0);
      // 停止后截一张图作为静态背景
      doScreenshot();
    } else {
      // 启动
      if (!currentDevice || !streamImgRef.current) return;
      setStreamError(null);
      setScreenshot(null); // 清除静态截图

      const stream = new ScreenStream({
        onFrame: () => {
          setStreamFrames(stream.frameCountValue);
          // 从 img 元素获取实际分辨率
          const img = streamImgRef.current;
          if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
            setDisplayWidth(img.naturalWidth);
            setDisplayHeight(img.naturalHeight);
          }
        },
        onError: (msg) => {
          setStreamError(msg);
        },
        onStopped: () => {
          setStreamEnabled(false);
          setAdbBusy(false);
        },
      });

      streamRef.current = stream;
      setAdbBusy(true);
      await stream.start(currentDevice, streamImgRef.current, streamInterval * 1000);
      setStreamEnabled(true);
    }
  }, [streamEnabled, currentDevice, doScreenshot, setAdbBusy]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      streamRef.current?.stop();
    };
  }, []);

  // 设备变化时停止流
  useEffect(() => {
    if (streamEnabled) {
      streamRef.current?.stop();
      streamRef.current = null;
      setStreamEnabled(false);
    }
  }, [currentDevice]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyevent handler（通过队列，相同 keycode 去重）
  const handleKey = useCallback(
    (keycode: number) => {
      if (!currentDevice) return;
      enqueueKeyevent(() => sendKeyevent(currentDevice, keycode), keycode);
    },
    [currentDevice]
  );

  // Text send handler（通过队列）
  const handleSendText = useCallback(() => {
    if (!currentDevice || !inputText.trim()) return;
    const text = inputText;
    enqueueText(() => sendText(currentDevice, text));
    setInputText("");
  }, [currentDevice, inputText]);

  // Brightness handler（通过队列，去重只保留最后一个值）
  const handleBrightnessChange = useCallback(
    (val: number) => {
      setBrightnessState(val);
      if (!currentDevice) return;
      enqueueBrightness(() => setBrightness(currentDevice, val));
    },
    [currentDevice]
  );

  // Volume handler（通过队列，去重）
  const handleVolumeChange = useCallback(
    (val: number) => {
      setVolumeState(val);
      if (!currentDevice) return;
      enqueueVolume(() => setVolume(currentDevice, val, "music"));
    },
    [currentDevice]
  );

  // WiFi handler（通过队列）
  const handleWifiToggle = useCallback(() => {
    if (!currentDevice) return;
    const newState = !wifiEnabled;
    setWifiEnabledState(newState);
    adbQueue.enqueue('wifi', () => setWifiState(currentDevice, newState), { priority: 'normal' });
  }, [currentDevice, wifiEnabled]);

  // Airplane mode handler（通过队列）
  const handleAirplaneToggle = useCallback(() => {
    if (!currentDevice) return;
    const newState = !airplaneMode;
    setAirplaneModeState(newState);
    adbQueue.enqueue('airplane', () => setAirplaneMode(currentDevice, newState), { priority: 'normal' });
  }, [currentDevice, airplaneMode]);

  // Reboot handlers
  const handleReboot = useCallback(() => {
    if (!currentDevice) return;
    setConfirmMessage(t("control.confirmReboot"));
    setConfirmAction(() => () => reboot(currentDevice).catch(() => {}));
  }, [currentDevice, t]);

  const handleRebootRecovery = useCallback(() => {
    if (!currentDevice) return;
    setConfirmMessage(t("control.confirmReboot"));
    setConfirmAction(() => () => rebootRecovery(currentDevice).catch(() => {}));
  }, [currentDevice, t]);

  const handleRebootBootloader = useCallback(() => {
    if (!currentDevice) return;
    setConfirmMessage(t("control.confirmReboot"));
    setConfirmAction(() => () => rebootBootloader(currentDevice).catch(() => {}));
  }, [currentDevice, t]);

  const executeConfirm = useCallback(() => {
    if (confirmAction) {
      confirmAction();
      setConfirmAction(null);
      setConfirmMessage("");
    }
  }, [confirmAction]);

  // Resolution handler
  const handleApplyResolution = useCallback(() => {
    if (!currentDevice) return;
    const w = parseInt(resWidth, 10);
    const h = parseInt(resHeight, 10);
    const d = parseInt(resDensity, 10);
    if (isNaN(w) || isNaN(h) || isNaN(d)) return;
    setScreenResolution(currentDevice, w, h, d).catch(() => {});
  }, [currentDevice, resWidth, resHeight, resDensity]);

  // Reset resolution handler
  const handleResetResolution = useCallback(async () => {
    if (!currentDevice) return;
    try {
      await resetScreenResolution(currentDevice);
      // 刷新显示的分辨率
      const res = await getScreenResolution(currentDevice);
      if (res) {
        const parts = res.split("x");
        if (parts.length === 2) {
          setResWidth(parts[0]);
          setResHeight(parts[1]);
        }
      }
      setResDensity("0");
    } catch {}
  }, [currentDevice]);

  if (!currentDevice) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-dark-400">{t("device.noDevice")}</p>
      </div>
    );
  }

  const navKeys = [
    { label: t("control.back"), keycode: 4 },
    { label: t("control.home"), keycode: 3 },
    { label: t("control.recent"), keycode: 187 },
  ];

  const otherKeys = [
    { label: t("control.power"), keycode: 26 },
    { label: t("control.volUp"), keycode: 24 },
    { label: t("control.volDown"), keycode: 25 },
    { label: t("control.enter"), keycode: 66 },
    { label: t("control.delete"), keycode: 67 },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto animate-fade-in">
      <h1 className="text-xl font-semibold text-dark-100 mb-6">{t("nav.control")}</h1>

      {/* Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-dark-800 border border-dark-700/50 rounded-xl p-6 max-w-sm w-full mx-4">
            <p className="text-dark-200 mb-6">{confirmMessage}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setConfirmAction(null);
                  setConfirmMessage("");
                }}
                className="px-4 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={executeConfirm}
                className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors text-sm"
              >
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Section A: Touchpad + Nav Keys */}
        <div className="md:col-span-2 bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-dark-300">{t("control.touchpad")}</h3>
            <div className="flex items-center gap-2">
              {/* 实时流开关 */}
              <button
                onClick={toggleStream}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors text-sm ${
                  streamEnabled
                    ? "bg-accent-500/20 text-accent-400 border border-accent-500/30"
                    : "bg-dark-700 text-dark-300 hover:bg-dark-600"
                }`}
              >
                {streamEnabled ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                )}
                {streamEnabled ? t("control.streamStop") : t("control.streamStart")}
                {streamEnabled && (
                  <span className="text-xs opacity-60 ml-1">{streamFrames}f</span>
                )}
              </button>
              {/* 间隔设置 */}
              <div
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-dark-700 text-dark-400 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!streamEnabled) setEditingInterval(true);
                }}
              >
                {editingInterval && !streamEnabled ? (
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={streamInterval}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (v >= 1 && v <= 30) setStreamInterval(v);
                    }}
                    onBlur={() => setEditingInterval(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") setEditingInterval(false);
                    }}
                    autoFocus
                    className="w-8 bg-dark-900 border border-dark-600 rounded px-1 py-0.5 text-dark-200 text-xs text-center focus:outline-none focus:border-accent-500/50"
                  />
                ) : (
                  <span>{streamInterval}s</span>
                )}
              </div>
              {/* 手动截图按钮 */}
              <button
                onClick={handleScreenshot}
                disabled={screenshotLoading || streamEnabled}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 disabled:opacity-50 transition-colors text-sm"
                title={t("control.screenshot")}
              >
                {screenshotLoading ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                )}
              </button>
            </div>
          </div>
          {/* 流错误提示 */}
          {streamError && (
            <div className="mb-2 px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
              {streamError}
            </div>
          )}
          {/* 触摸板区域 */}
          <div
            ref={touchpadRef}
            className="relative mx-auto bg-dark-900 rounded-lg border border-dark-600/50 cursor-crosshair overflow-hidden select-none"
            style={{
              width: touchpadSize.w,
              height: touchpadSize.h,
            }}
            onMouseDown={handleTouchpadMouseDown}
          >
            {/* 实时流 img */}
            <img
              ref={streamImgRef as React.RefObject<HTMLImageElement>}
              className={`absolute inset-0 w-full h-full pointer-events-none ${streamEnabled ? '' : 'hidden'}`}
              alt=""
            />
            {/* 静态截图 */}
            {!streamEnabled && screenshot && (
              <img
                src={`data:image/png;base64,${screenshot}`}
                alt="screenshot"
                className="absolute inset-0 w-full h-full opacity-30 pointer-events-none"
              />
            )}
            {/* 无画面提示 */}
            {!streamEnabled && !screenshot && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <p className="text-dark-600 text-sm">Click or drag to control device</p>
              </div>
            )}
          </div>
          {/* 安卓导航三键：返回、主页、最近任务 */}
          <div className="flex items-center justify-center gap-4 mt-3">
            {navKeys.map((key) => (
              <button
                key={key.keycode}
                onClick={() => handleKey(key.keycode)}
                className="w-16 h-10 rounded-xl bg-dark-700 text-dark-200 hover:bg-accent-500/20 hover:text-accent-400 active:bg-accent-500/30 transition-colors text-xs font-medium flex items-center justify-center"
              >
                {key.label}
              </button>
            ))}
          </div>
        </div>

        {/* Section B: Other Keys */}
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">{t("control.quickKeys")}</h3>
          <div className="grid grid-cols-3 gap-2">
            {otherKeys.map((key) => (
              <button
                key={key.keycode}
                onClick={() => handleKey(key.keycode)}
                className="px-3 py-2.5 rounded-lg bg-dark-700 text-dark-200 hover:bg-accent-500/20 hover:text-accent-400 transition-colors text-sm font-medium"
              >
                {key.label}
              </button>
            ))}
          </div>
        </div>

        {/* Section C: Text Input */}
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">{t("control.textInput")}</h3>
          <div className="flex gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendText()}
              placeholder={t("control.textInput")}
              className="flex-1 px-3 py-2 rounded-lg bg-dark-700 border border-dark-600/50 text-dark-100 placeholder-dark-500 text-sm focus:outline-none focus:border-accent-500/50"
            />
            <button
              onClick={handleSendText}
              className="px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors text-sm font-medium"
            >
              {t("control.send")}
            </button>
          </div>
        </div>

        {/* Section D: Settings Controls */}
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">{t("control.settings")}</h3>
          <div className="space-y-5">
            {/* WiFi */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-dark-400">{t("control.wifi")}</span>
              <button
                onClick={handleWifiToggle}
                className={`relative w-10 h-5 rounded-full transition-colors ${wifiEnabled ? "bg-accent-500" : "bg-dark-600"}`}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${wifiEnabled ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </button>
            </div>
            {/* Airplane Mode */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-dark-400">{t("control.airplaneMode")}</span>
              <button
                onClick={handleAirplaneToggle}
                className={`relative w-10 h-5 rounded-full transition-colors ${airplaneMode ? "bg-accent-500" : "bg-dark-600"}`}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${airplaneMode ? "translate-x-5" : "translate-x-0.5"}`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Section E: Reboot */}
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">{t("control.reboot")}</h3>
          <div className="flex flex-col gap-2">
            <button
              onClick={handleReboot}
              className="px-4 py-2.5 rounded-lg bg-dark-700 text-dark-200 hover:bg-yellow-500/20 hover:text-yellow-400 transition-colors text-sm font-medium"
            >
              {t("control.reboot")}
            </button>
            <button
              onClick={handleRebootRecovery}
              className="px-4 py-2.5 rounded-lg bg-dark-700 text-dark-200 hover:bg-orange-500/20 hover:text-orange-400 transition-colors text-sm font-medium"
            >
              {t("control.rebootRecovery")}
            </button>
            <button
              onClick={handleRebootBootloader}
              className="px-4 py-2.5 rounded-lg bg-dark-700 text-dark-200 hover:bg-red-500/20 hover:text-red-400 transition-colors text-sm font-medium"
            >
              {t("control.rebootBootloader")}
            </button>
          </div>
        </div>

        {/* Section F: Resolution */}
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">{t("control.resolution")}</h3>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <div>
              <label className="text-xs text-dark-500 mb-1 block">Width</label>
              <input
                type="number"
                value={resWidth}
                onChange={(e) => setResWidth(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-dark-700 border border-dark-600/50 text-dark-100 text-sm focus:outline-none focus:border-accent-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-dark-500 mb-1 block">Height</label>
              <input
                type="number"
                value={resHeight}
                onChange={(e) => setResHeight(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-dark-700 border border-dark-600/50 text-dark-100 text-sm focus:outline-none focus:border-accent-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-dark-500 mb-1 block">Density</label>
              <input
                type="number"
                value={resDensity}
                onChange={(e) => setResDensity(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-dark-700 border border-dark-600/50 text-dark-100 text-sm focus:outline-none focus:border-accent-500/50"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleApplyResolution}
              className="flex-1 px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors text-sm font-medium"
            >
              {t("control.apply")}
            </button>
            <button
              onClick={handleResetResolution}
              className="px-4 py-2 rounded-lg bg-dark-700 text-dark-200 hover:bg-yellow-500/20 hover:text-yellow-400 transition-colors text-sm font-medium"
            >
              {t("control.reset")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeviceControlPage;
