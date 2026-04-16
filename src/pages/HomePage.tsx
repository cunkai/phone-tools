import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useDeviceStore } from "../store/deviceStore";
import ConnectionGuide from "../components/ConnectionGuide";
import ProgressBar from "../components/ProgressBar";
import LoadingSpinner from "../components/LoadingSpinner";
import type { AdbDevice } from "../types";
import { getDeviceProps, getBatteryInfo, getStorageInfo, getMemoryInfo, getCpuArchitecture, getScreenResolution, takeScreenshot, hdcGetDeviceInfo, hdcScreenshot } from "../api/adb";
import { getLatestScreenshot, saveDeviceScreenshot } from "./ToolsPage";

const DEVICE_SCREENSHOT_KEY = "device_screenshot_";

const HomePage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { devices, currentDevice, fetchDevices } = useDeviceStore();
  const [deviceProps, setDeviceProps] = useState<AdbDevice | null>(null);
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [totalStorage, setTotalStorage] = useState("");
  const [availStorage, setAvailStorage] = useState("");
  const [totalMemory, setTotalMemory] = useState("");
  const [cpuInfo, setCpuInfo] = useState("");
  const [screenRes, setScreenRes] = useState("");
  const [loading, setLoading] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [deviceScreenshot, setDeviceScreenshot] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const device = devices.find((d) => d.serial === currentDevice);

  // Only fetch device list once on mount
  useEffect(() => {
    fetchDevices();
  }, []);

  // When device changes, load details once (no polling)
  // 串行加载，每个命令之间留间隔，避免连续大量 ADB 命令导致设备断开
  useEffect(() => {
    if (currentDevice) {
      // Try cached screenshot first
      const cached = localStorage.getItem(DEVICE_SCREENSHOT_KEY + currentDevice);
      if (cached) setDeviceScreenshot(cached);
      const latest = getLatestScreenshot();
      if (latest && !cached) setDeviceScreenshot(latest);

      setLoading(true);

      // 判断当前设备平台
      const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";

      // 串行加载，每个命令之间间隔 200ms
      const loadAll = async () => {
        const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

        if (currentPlatform === "harmonyos") {
          // ===== 鸿蒙设备：直接从 devices 列表获取（get_all_devices 已包含完整信息） =====
          const hdcDevice = devices.find((d) => d.serial === currentDevice);
          if (hdcDevice) {
            setDeviceProps(hdcDevice);
            setCpuInfo(hdcDevice.cpu_info || "");
            setScreenRes(hdcDevice.screen_resolution || "");
            setTotalMemory(hdcDevice.total_memory || "");
            setTotalStorage(hdcDevice.total_storage || "");
            setAvailStorage(hdcDevice.available_storage || "");
            setBatteryLevel(hdcDevice.battery_level ?? null);
          }
          await delay(200);

          // 截图
          try {
            const base64 = await hdcScreenshot(currentDevice);
            setDeviceScreenshot(base64);
            saveDeviceScreenshot(base64, currentDevice);
            try { localStorage.setItem(DEVICE_SCREENSHOT_KEY + currentDevice, base64); } catch {}
          } catch {}
        } else {
          // ===== Android 设备：使用 ADB API =====
          // 1. 基本属性
          try { const props = await getDeviceProps(currentDevice); setDeviceProps(props); } catch {}
          await delay(200);

          // 2. 电池
          try { const bat: any = await getBatteryInfo(currentDevice); setBatteryLevel(bat.level || null); } catch {}
          await delay(200);

          // 3. 存储
          try { const st: any = await getStorageInfo(currentDevice); setTotalStorage(st.total_formatted || ""); setAvailStorage(st.available_formatted || ""); } catch {}
          await delay(200);

          // 4. 内存
          try { const mem: any = await getMemoryInfo(currentDevice); setTotalMemory(mem.total_formatted || ""); } catch {}
          await delay(200);

          // 5. CPU 架构
          try { const arch = await getCpuArchitecture(currentDevice); setCpuInfo(arch || ""); } catch {}
          await delay(200);

          // 6. 屏幕分辨率
          try { const res = await getScreenResolution(currentDevice); setScreenRes(res || ""); } catch {}
          await delay(200);

          // 7. 截图（最后执行，因为最重）
          try {
            const base64 = await takeScreenshot(currentDevice);
            setDeviceScreenshot(base64);
            saveDeviceScreenshot(base64, currentDevice);
            try { localStorage.setItem(DEVICE_SCREENSHOT_KEY + currentDevice, base64); } catch {}
          } catch {}
        }

        setLoading(false);
      };
      loadAll();
    } else {
      setDeviceProps(null);
      setBatteryLevel(null);
      setTotalStorage("");
      setAvailStorage("");
      setTotalMemory("");
      setCpuInfo("");
      setScreenRes("");
      setDeviceScreenshot(null);
    }
  }, [currentDevice, refreshKey]);

  // Merge data: props from getDeviceProps, extras from independent calls
  const info: AdbDevice | null = deviceProps || device || null;
  const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";

  const parseStorageToBytes = (s: string): number => {
    if (!s) return 0;
    const num = parseFloat(s);
    if (isNaN(num)) return 0;
    if (s.includes("TB")) return num * 1024 * 1024 * 1024 * 1024;
    if (s.includes("GB") || s.match(/\d+G\b/)) return num * 1024 * 1024 * 1024;
    if (s.includes("MB") || s.match(/\d+M\b/)) return num * 1024 * 1024;
    if (s.includes("KB") || s.match(/\d+K\b/)) return num * 1024;
    return num;
  };

  const totalBytes = parseStorageToBytes(totalStorage);
  const availBytes = parseStorageToBytes(availStorage);
  const usedBytes = totalBytes - availBytes;
  const storagePercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  const formatGB = (bytes: number) => (bytes / (1024 * 1024 * 1024)).toFixed(1);

  if (!info) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 animate-fade-in">
        <div className="w-24 h-24 rounded-full bg-dark-800 flex items-center justify-center mb-6">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-dark-500">
            <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
            <line x1="12" y1="18" x2="12.01" y2="18" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-dark-200 mb-2">{t("device.noDevice")}</h2>
        <p className="text-sm text-dark-400 mb-6 text-center max-w-sm">{t("device.connectionGuide")}</p>
        <div className="flex gap-3">
          <button onClick={() => setShowGuide(true)} className="px-4 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm">
            {t("device.connectionGuide")}
          </button>
          <button onClick={() => navigate("/install")} className="px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors text-sm">
            {t("nav.install")}
          </button>
        </div>
        <ConnectionGuide isOpen={showGuide} onClose={() => setShowGuide(false)} />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto animate-fade-in">
      {/* Header with refresh */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-dark-100">{t("nav.home")}</h1>
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 disabled:opacity-50 transition-colors text-sm"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? "animate-spin" : ""}>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {t("common.refresh")}
        </button>
      </div>

      {loading && <LoadingSpinner size="sm" className="fixed top-14 right-4 z-50" />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Device Card */}
        <div className="lg:col-span-1">
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <div className="flex flex-col items-center text-center">
              <div className="w-20 h-20 rounded-2xl bg-dark-700 flex items-center justify-center mb-4 overflow-hidden">
                {deviceScreenshot ? (
                  <img src={`data:image/png;base64,${deviceScreenshot}`} alt="Device" className="w-full h-full object-cover" />
                ) : (
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent-400">
                    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                    <line x1="12" y1="18" x2="12.01" y2="18" />
                  </svg>
                )}
              </div>
              <h2 className="text-lg font-semibold text-dark-100">{info.brand || ""} {info.model || ""}</h2>
              <p className="text-sm text-dark-400 mt-1">{info.serial}</p>
              <div className="flex items-center gap-2 mt-3">
                {info.android_version && (
                  <span className="px-2 py-0.5 rounded-full bg-accent-500/20 text-accent-400 text-xs">
                    {currentPlatform === "harmonyos" ? `HarmonyOS ${info.android_version}` : info.android_version}
                  </span>
                )}
                {info.sdk_version && (
                  <span className="px-2 py-0.5 rounded-full bg-dark-700 text-dark-300 text-xs">
                    SDK {info.sdk_version}
                  </span>
                )}
              </div>
            </div>

            {batteryLevel !== null && (
              <div className="mt-6 pt-4 border-t border-dark-700/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-dark-400">{t("device.battery")}</span>
                  <div className="flex items-center gap-1.5">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={batteryLevel > 20 ? "text-green-400" : "text-red-400"}>
                      <rect x="1" y="6" width="18" height="12" rx="2" ry="2" />
                      <line x1="23" y1="13" x2="23" y2="11" />
                    </svg>
                    <span className="text-sm text-dark-200 font-medium">{batteryLevel}%</span>
                  </div>
                </div>
                <ProgressBar progress={batteryLevel} showLabel={false} />
              </div>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="lg:col-span-2 space-y-6">
          {totalStorage && (
            <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
              <h3 className="text-sm font-semibold text-dark-300 mb-4">{t("device.storage")}</h3>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-dark-400">{formatGB(usedBytes)} GB {t("monitor.used")}</span>
                <span className="text-sm text-dark-400">{formatGB(totalBytes)} GB {t("monitor.total")}</span>
              </div>
              <ProgressBar progress={storagePercent} showLabel={false} />
              <div className="mt-2 text-xs text-dark-500">{formatGB(availBytes)} GB {t("monitor.free")}</div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4">
              <span className="text-xs text-dark-500">{t("device.screen")}</span>
              <p className="text-sm text-dark-200 mt-1 font-medium">{screenRes || t("common.unknown")}</p>
            </div>
            <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4">
              <span className="text-xs text-dark-500">{t("device.memory")}</span>
              <p className="text-sm text-dark-200 mt-1 font-medium">{totalMemory || t("common.unknown")}</p>
            </div>
            <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4">
              <span className="text-xs text-dark-500">{t("device.cpu")}</span>
              <p className="text-sm text-dark-200 mt-1 font-medium truncate">{cpuInfo || t("common.unknown")}</p>
            </div>
            <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4">
              <span className="text-xs text-dark-500">{t("device.deviceType")}</span>
              <p className="text-sm text-dark-200 mt-1 font-medium">{info.device_type || t("common.unknown")}</p>
            </div>
          </div>

          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-dark-300 mb-4">Quick Actions</h3>
            <div className="grid grid-cols-3 gap-3">
              <button onClick={() => navigate("/tools")} className="flex flex-col items-center gap-2 p-4 rounded-lg bg-dark-700/50 hover:bg-dark-700 transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-400">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span className="text-xs text-dark-300">{t("tools.screenshot")}</span>
              </button>
              <button onClick={() => navigate("/install")} className="flex flex-col items-center gap-2 p-4 rounded-lg bg-dark-700/50 hover:bg-dark-700 transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-400">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                <span className="text-xs text-dark-300">{t("nav.install")}</span>
              </button>
              <button onClick={() => navigate("/apps")} className="flex flex-col items-center gap-2 p-4 rounded-lg bg-dark-700/50 hover:bg-dark-700 transition-colors">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-400">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
                <span className="text-xs text-dark-300">{t("nav.apps")}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <ConnectionGuide isOpen={showGuide} onClose={() => setShowGuide(false)} />
    </div>
  );
};

export default HomePage;
