import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useDeviceStore } from "../store/deviceStore";
import ConnectionGuide from "../components/ConnectionGuide";
import ConfirmDialog from "../components/ConfirmDialog";
import ProgressBar from "../components/ProgressBar";
import LoadingSpinner from "../components/LoadingSpinner";
import type { AdbDevice } from "../types";
import { getDeviceProps, getBatteryInfo, getStorageInfo, getMemoryInfo, getCpuArchitecture, getScreenResolution, takeScreenshot, hdcGetDeviceInfo, hdcScreenshot, exportBugreport, cancelBugreport, hdcGetBaseInfo, getAndroidBaseInfo, restartAdbService, restartHdcService } from "../api/adb";
import { save } from "@tauri-apps/plugin-dialog";
import { getLatestScreenshot, saveDeviceScreenshot } from "./ToolsPage";

const DEVICE_SCREENSHOT_KEY = "device_screenshot_";

const HomePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { devices, currentDevice, fetchDevices, homeCache, setHomeCache } = useDeviceStore();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportElapsed, setExportElapsed] = useState(0);
  const [baseInfo, setBaseInfo] = useState<string>("");
  const [baseInfoLoading, setBaseInfoLoading] = useState(false);
  const [detailHover, setDetailHover] = useState(false);
  const [showRawData, setShowRawData] = useState(false);
  const exportTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // 导出计时器
  useEffect(() => {
    if (exporting) {
      setExportElapsed(0);
      exportTimerRef.current = setInterval(() => {
        setExportElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      if (exportTimerRef.current) clearInterval(exportTimerRef.current);
      exportTimerRef.current = null;
    }
    return () => {
      if (exportTimerRef.current) clearInterval(exportTimerRef.current);
    };
  }, [exporting]);

  const handleCancelExport = useCallback(async () => {
    try { await cancelBugreport(); } catch {}
    setExporting(false);
  }, []);

  const formatElapsed = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  };

  const device = devices.find((d) => d.serial === currentDevice);
  const cache = currentDevice ? homeCache[currentDevice] : null;

  // 从 store 缓存或 devices 列表读取数据
  const deviceProps: AdbDevice | null = device || null;
  const batteryLevel = cache?.batteryLevel ?? (device?.battery_level ?? null);
  const totalStorage = cache?.totalStorage || device?.total_storage || "";
  const availStorage = cache?.availStorage || device?.available_storage || "";
  const totalMemory = cache?.totalMemory || device?.total_memory || "";
  const cpuInfo = (cache?.cpuInfo || "") || device?.cpu_info || "";
  const screenRes = (cache?.screenRes || "") || device?.screen_resolution || "";
  const maxRefreshRate = cache?.maxRefreshRate || (device as any)?.max_refresh_rate || 0;
  // 新字段：优先 cache，fallback 到 device 对象
  const osVersion = cache?.osVersion || (device as any)?.android_version || "";
  const sdkVersion = cache?.sdkVersion || (device as any)?.sdk_version || "";
  const securityPatch = cache?.securityPatch || (device as any)?.security_patch || "";
  const kernelVersion = cache?.kernelVersion || (device as any)?.kernel_version || "";
  const abiList = cache?.abiList || (device as any)?.abi_list || "";
  const marketName = cache?.marketName || (device as any)?.market_name || "";
  const deviceScreenshot = cache?.screenshot ?? (() => {
    // 尝试 localStorage 缓存
    if (currentDevice) {
      try { return localStorage.getItem(DEVICE_SCREENSHOT_KEY + currentDevice); } catch {}
    }
    return null;
  })();

  // 只在设备列表为空时才 fetch（切页回来不重新获取）
  useEffect(() => {
    if (devices.length === 0) {
      fetchDevices();
    }
  }, []);

  // 从缓存恢复 baseInfo
  useEffect(() => {
    if (currentDevice) {
      const cached = homeCache[currentDevice];
      if (cached?.baseInfo) {
        setBaseInfo(cached.baseInfo);
      }
    }
  }, [currentDevice, homeCache]);

  // When device changes, load details once (no polling)
  useEffect(() => {
    if (currentDevice) {
      // 如果已加载过同一设备的数据，直接使用缓存，不重新获取
      if (cache?.loaded && refreshKey === 0) {
        return;
      }

      setLoading(true);

      const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";

      const loadAll = async () => {
        const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

        if (currentPlatform === "harmonyos") {
          // 鸿蒙设备：先从 devices 列表读取已有信息
          const hdcDevice = devices.find((d) => d.serial === currentDevice) as any;
          if (hdcDevice) {
            const cacheData: Record<string, any> = {};
            if (hdcDevice.battery_level != null) cacheData.batteryLevel = hdcDevice.battery_level;
            if (hdcDevice.total_storage) cacheData.totalStorage = hdcDevice.total_storage;
            if (hdcDevice.available_storage) cacheData.availStorage = hdcDevice.available_storage;
            if (hdcDevice.total_memory) cacheData.totalMemory = hdcDevice.total_memory;
            if (hdcDevice.cpu_info) cacheData.cpuInfo = hdcDevice.cpu_info;
            if (hdcDevice.screen_resolution) cacheData.screenRes = hdcDevice.screen_resolution;
            if (hdcDevice.max_refresh_rate) cacheData.maxRefreshRate = hdcDevice.max_refresh_rate;
            if (hdcDevice.model) cacheData.model = hdcDevice.model;
            if (hdcDevice.brand) cacheData.brand = hdcDevice.brand;
            if (hdcDevice.market_name) cacheData.marketName = hdcDevice.market_name;
            if (hdcDevice.device_type) cacheData.deviceType = hdcDevice.device_type;
            if (hdcDevice.android_version) cacheData.osVersion = hdcDevice.android_version;
            if (hdcDevice.sdk_version) cacheData.sdkVersion = hdcDevice.sdk_version;
            if (hdcDevice.security_patch) cacheData.securityPatch = hdcDevice.security_patch;
            if (hdcDevice.kernel_version) cacheData.kernelVersion = hdcDevice.kernel_version;
            if (hdcDevice.abi_list) cacheData.abiList = hdcDevice.abi_list;
            setHomeCache(currentDevice, cacheData);
          }

          // 如果 devices 列表中缺少关键信息（model/cpu/分辨率），主动获取
          const needDetails = !hdcDevice?.model || !hdcDevice?.cpu_info || !hdcDevice?.screen_resolution;
          if (needDetails) {
            try {
              const detailed = await hdcGetDeviceInfo(currentDevice);
              if (detailed) {
                const detailData: Record<string, any> = {};
                if (detailed.model) detailData.model = detailed.model;
                if (detailed.brand) detailData.brand = detailed.brand;
                if (detailed.market_name) detailData.marketName = detailed.market_name;
                if (detailed.device_type) detailData.deviceType = detailed.device_type;
                if (detailed.android_version) detailData.osVersion = detailed.android_version;
                if (detailed.sdk_version) detailData.sdkVersion = detailed.sdk_version;
                if (detailed.security_patch) detailData.securityPatch = detailed.security_patch;
                if (detailed.kernel_version) detailData.kernelVersion = detailed.kernel_version;
                if (detailed.incremental_version) detailData.incrementalVersion = detailed.incremental_version;
                if (detailed.abi_list) detailData.abiList = detailed.abi_list;
                if (detailed.cpu_info) detailData.cpuInfo = detailed.cpu_info;
                if (detailed.screen_resolution) detailData.screenRes = detailed.screen_resolution;
                if (detailed.max_refresh_rate) detailData.maxRefreshRate = detailed.max_refresh_rate;
                if (detailed.total_memory) detailData.totalMemory = detailed.total_memory;
                if (detailed.total_storage) detailData.totalStorage = detailed.total_storage;
                if (detailed.available_storage) detailData.availStorage = detailed.available_storage;
                if (detailed.battery_level != null) detailData.batteryLevel = detailed.battery_level;
                setHomeCache(currentDevice, detailData);
              }
            } catch {}
          }
          await delay(200);

          // 截图
          try {
            const base64 = await hdcScreenshot(currentDevice);
            setHomeCache(currentDevice, { screenshot: base64 });
            saveDeviceScreenshot(base64, currentDevice);
            try { localStorage.setItem(DEVICE_SCREENSHOT_KEY + currentDevice, base64); } catch {}
          } catch {}

          // 获取 hidumper -c base 详细信息
          setBaseInfoLoading(true);
          hdcGetBaseInfo(currentDevice).then((info) => {
            setBaseInfo(info);
            // 提取 UDID
            const udidMatch = info.match(/ohos\.boot\.udid=(\S+)/);
            setHomeCache(currentDevice, { baseInfo: info, loaded: true, udid: udidMatch ? udidMatch[1] : "" });
          }).catch(() => {}).finally(() => setBaseInfoLoading(false));
        } else {
          // Android 设备：一条命令获取全部信息
          try { const props = await getDeviceProps(currentDevice); } catch {}
          await delay(200);

          // 一次性获取全部设备信息
          setBaseInfoLoading(true);
          getAndroidBaseInfo(currentDevice).then((info) => {
            setBaseInfo(info);
            // 同时解析到 cache
            const parsed = parseAndroidBaseInfo(info);
            const cacheData: Record<string, any> = { loaded: true, baseInfo: info };
            if (parsed.osVersion) cacheData.osVersion = parsed.osVersion;
            if (parsed.sdkVersion) cacheData.sdkVersion = parsed.sdkVersion;
            if (parsed.securityPatch) cacheData.securityPatch = parsed.securityPatch;
            if (parsed.kernelVersion) cacheData.kernelVersion = parsed.kernelVersion;
            if (parsed.screenRes) cacheData.screenRes = parsed.screenRes;
            if (parsed.cpuInfo) cacheData.cpuInfo = parsed.cpuInfo;
            if (parsed.totalMemory) cacheData.totalMemory = parsed.totalMemory;
            if (parsed.abiList) cacheData.abiList = parsed.abiList;
            if (parsed.batteryLevel != null) cacheData.batteryLevel = parsed.batteryLevel;
            if (parsed.totalStorage) cacheData.totalStorage = parsed.totalStorage;
            if (parsed.availStorage) cacheData.availStorage = parsed.availStorage;
            if (parsed.marketName) cacheData.marketName = parsed.marketName;
            setHomeCache(currentDevice, cacheData);
          }).catch(() => {}).finally(() => setBaseInfoLoading(false));

          // 截图
          try {
            const base64 = await takeScreenshot(currentDevice);
            setHomeCache(currentDevice, { screenshot: base64 });
            saveDeviceScreenshot(base64, currentDevice);
            try { localStorage.setItem(DEVICE_SCREENSHOT_KEY + currentDevice, base64); } catch {}
          } catch {}
        }

        setHomeCache(currentDevice, { loaded: true });
        setLoading(false);
      };
      loadAll();
    }
  }, [currentDevice, refreshKey]);

  const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";

  const parseStorageToBytes = (s: string): number => {
    if (!s) return 0;
    const num = parseFloat(s);
    if (isNaN(num)) return 0;
    if (s.includes("TB")) return num * 1024 * 1024 * 1024 * 1024;
    if (s.includes("GB") || s.endsWith("G")) return num * 1024 * 1024 * 1024;
    if (s.includes("MB") || s.endsWith("M")) return num * 1024 * 1024;
    if (s.includes("KB") || s.endsWith("K")) return num * 1024;
    return num;
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const totalBytes = parseStorageToBytes(totalStorage);
  const availBytes = parseStorageToBytes(availStorage);
  const usedBytes = totalBytes - availBytes;
  const storagePercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

  if (!currentDevice || !device) {
    return (
      <div className="p-6 h-full flex flex-col animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-dark-100">{t("nav.home")}</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-dark-800 flex items-center justify-center">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-dark-500">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                <line x1="12" y1="18" x2="12.01" y2="18" />
              </svg>
            </div>
            <p className="text-dark-400 mb-4">{t("device.noDevice")}</p>
            <button
              onClick={() => setShowGuide(true)}
              className="px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors text-sm"
            >
              {t("device.connectionGuide")}
            </button>
          </div>
        </div>
        {showGuide && <ConnectionGuide isOpen={showGuide} onClose={() => setShowGuide(false)} />}
      </div>
    );
  }

  return (
    <div className="p-6 h-full flex flex-col animate-fade-in overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-shrink-0">
        <h1 className="text-xl font-semibold text-dark-100">{t("nav.home")}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRestartConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm"
            title={t("common.restartService")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
            {t("common.restartService")}
          </button>
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
      </div>

      {/* Main Content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-0">
        {/* Left Column - Device Info */}
        <div className="lg:col-span-1">
          {/* Device Card */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-5 h-full flex flex-col items-center justify-center">
            <div className="flex flex-col items-center text-center">
              {deviceScreenshot ? (
                <img
                  src={`data:image/jpeg;base64,${deviceScreenshot}`}
                  alt="Screenshot"
                  className="w-full max-w-[200px] rounded-lg border border-dark-700/50 mb-3"
                />
              ) : (
                <div className="w-24 h-40 rounded-lg bg-dark-700/50 flex items-center justify-center mb-3">
                  {loading ? (
                    <LoadingSpinner />
                  ) : (
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-dark-500">
                      <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                      <line x1="12" y1="18" x2="12.01" y2="18" />
                    </svg>
                  )}
                </div>
              )}
              <h3 className="text-sm font-semibold text-dark-200">
                {marketName || device?.model || device?.brand || device.serial}
              </h3>
              <p className="text-xs text-dark-500 mt-1 font-mono">{device.serial}</p>
              <div className="flex items-center justify-center mt-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs ${
                  currentPlatform === "harmonyos"
                    ? "bg-blue-500/15 text-blue-400"
                    : "bg-green-500/15 text-green-400"
                }`}>
                  {currentPlatform === "harmonyos" ? "HarmonyOS" : "Android"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column - Device Detail Info */}
        <div className="lg:col-span-2 space-y-4">
          {/* Device Detail Panel (hidumper -c base) */}
          {currentPlatform === "harmonyos" || currentPlatform === "android" ? (
            <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-5 relative"
              onMouseEnter={() => setDetailHover(true)} onMouseLeave={() => setDetailHover(false)}>
              {/* 刷新按钮 */}
              {detailHover && (
              <button
                onClick={async () => {
                  if (!currentDevice) return;
                  setBaseInfoLoading(true);
                  try {
                    const info = currentPlatform === "harmonyos"
                      ? await hdcGetBaseInfo(currentDevice)
                      : await getAndroidBaseInfo(currentDevice);
                    setBaseInfo(info);
                  } catch {} finally { setBaseInfoLoading(false); }
                }}
                className="absolute -top-1 right-1 z-10 w-6 h-6 flex items-center justify-center
                           bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-full
                           text-dark-400 hover:text-dark-200 transition-colors"
                title={t("common.refresh")}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
              )}
              {/* 原始数据按钮 */}
              {detailHover && (
              <button
                onClick={() => setShowRawData(true)}
                className="absolute -top-1 right-6 z-10 w-6 h-6 flex items-center justify-center
                           bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-full
                           text-dark-400 hover:text-dark-200 transition-colors"
                title={t("common.viewRawData")}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </button>
              )}

              <h3 className="text-sm font-semibold text-dark-200 mb-4">{t("device.deviceDetail")}</h3>

              {baseInfoLoading && !baseInfo ? (
                <div className="space-y-2">
                  {[...Array(8)].map((_, i) => (
                    <div key={i} className="h-4 bg-dark-700 rounded animate-pulse" style={{ width: `${60 + Math.random() * 40}%` }} />
                  ))}
                </div>
              ) : baseInfo ? (
                <div className="space-y-2 text-sm max-h-[60vh] overflow-y-auto pr-1">
                  {(currentPlatform === "harmonyos" ? parseBaseInfo(baseInfo) : parseAndroidBaseInfo(baseInfo).items).map((item) => (
                    <div key={item.key} className="flex items-baseline gap-3">
                      <span className="text-dark-500 whitespace-nowrap shrink-0 w-24 text-right">{item.key}</span>
                      <span className="text-dark-200 break-all font-mono text-xs">{item.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-dark-500">{t("common.noData")}</p>
              )}
            </div>
          ) : null}

          {/* 原始数据弹窗 */}
          {showRawData && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowRawData(false)}>
              <div className="bg-dark-800 border border-dark-700/50 rounded-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700/50">
                  <h3 className="text-sm font-semibold text-dark-200">{t("common.viewRawData")}</h3>
                  <button onClick={() => setShowRawData(false)} className="text-dark-400 hover:text-dark-200 transition-colors">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <pre className="flex-1 overflow-auto p-4 text-xs text-dark-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
                  {baseInfo || t("common.noData")}
                </pre>
                <div className="px-4 py-3 border-t border-dark-700/50 flex justify-end">
                  <button onClick={() => { navigator.clipboard.writeText(baseInfo || ""); }} className="px-3 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-xs">
                    {t("common.copy")}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className="grid grid-cols-3 gap-3">
            <button
              onClick={async () => {
                if (!currentDevice) return;
                try {
                  const safeName = (marketName || device?.model || currentDevice).replace(/[\\/:*?"<>|]/g, "_");
                  const result = await save({
                    defaultPath: `bugreport_${safeName}_${new Date().toISOString().slice(0, 10)}.txt`,
                    filters: [{ name: "Text", extensions: ["txt"] }],
                  });
                  if (!result) return;
                  const deviceInfo: Record<string, string> = {
                    marketName,
                    model: device?.model || "",
                    brand: device?.brand || "",
                    serial: currentDevice,
                    osVersion,
                    apiLevel: sdkVersion,
                    kernelVersion,
                    cpuInfo,
                    screenResolution: screenRes,
                    memoryInfo: totalMemory,
                    storageInfo: `${totalStorage} (avail: ${availStorage})`,
                  };
                  setExporting(true);
                  await exportBugreport(currentDevice, result, deviceInfo, currentPlatform, i18n.language);
                } catch (e: any) {
                  console.error("bugreport failed:", e);
                } finally {
                  setExporting(false);
                }
              }}
              disabled={exporting}
              className="flex flex-col items-center gap-2 p-4 bg-dark-800/50 border border-dark-700/50 rounded-xl hover:bg-dark-800 transition-colors disabled:opacity-50"
              title={t("tools.exportBugreport")}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-orange-400">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <span className="text-xs text-dark-300">{t("tools.exportBugreport")}</span>
            </button>
            <button
              onClick={async () => {
                try {
                  const base64 = currentPlatform === "harmonyos"
                    ? await hdcScreenshot(currentDevice)
                    : await takeScreenshot(currentDevice);
                  setHomeCache(currentDevice, { screenshot: base64 });
                  saveDeviceScreenshot(base64, currentDevice);
                  try { localStorage.setItem(DEVICE_SCREENSHOT_KEY + currentDevice, base64); } catch {}
                } catch {}
              }}
              className="flex flex-col items-center gap-2 p-4 bg-dark-800/50 border border-dark-700/50 rounded-xl hover:bg-dark-800 transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-400">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
              <span className="text-xs text-dark-300">{t("tools.screenshot")}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 全屏导出遮罩 */}
      {exporting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-6">
            <span className="w-12 h-12 border-3 border-orange-400 border-t-transparent rounded-full animate-spin" />
            <div className="text-center">
              <p className="text-lg font-medium text-dark-100">{t("tools.exporting")}</p>
              <p className="text-sm text-dark-400 mt-1 font-mono">{formatElapsed(exportElapsed)}</p>
            </div>
            <button
              onClick={handleCancelExport}
              className="px-6 py-2 rounded-lg bg-dark-700 border border-dark-600 text-dark-300 hover:bg-dark-600 hover:text-dark-100 transition-colors text-sm"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}
      <ConfirmDialog
        isOpen={showRestartConfirm}
        title={t("common.restartService")}
        message=""
        confirmText={t("common.confirm")}
        cancelText={t("common.cancel")}
        onConfirm={async () => {
          setShowRestartConfirm(false);
          useDeviceStore.setState({ isReconnecting: true });
          try {
            if (currentPlatform === "harmonyos") {
              await restartHdcService();
            } else {
              await restartAdbService();
            }
            // 服务重启成功，立即关闭通知
            useDeviceStore.setState({ isReconnecting: false });
            // 刷新设备列表
            fetchDevices();
          } catch (e: any) {
            console.error("restart service failed:", e);
            useDeviceStore.setState({ isReconnecting: false });
          }
        }}
        onCancel={() => setShowRestartConfirm(false)}
      />
    </div>
  );
};

/** 信息卡片组件 */
function InfoCard({ icon, label, value, loading, onRefresh, rawData }: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  loading?: boolean;
  onRefresh?: () => void;
  rawData?: string;
}) {
  const { t } = useTranslation();
  const [showRaw, setShowRaw] = useState(false);
  const showLoading = loading || !value;
  return (
    <>
      <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4 relative group">
        {/* 悬停按钮 */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="hidden group-hover:flex absolute -top-1 right-1 z-10 w-6 h-6 items-center justify-center
                       bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-full
                       text-dark-400 hover:text-dark-200 transition-colors"
            title={t("common.refresh")}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        )}
        {rawData && (
          <button
            onClick={() => setShowRaw(true)}
            className="hidden group-hover:flex absolute -top-1 right-6 z-10 w-6 h-6 items-center justify-center
                       bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded-full
                       text-dark-400 hover:text-dark-200 transition-colors"
            title={t("common.viewRawData")}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
          </button>
        )}
        <div className="flex items-center gap-2 mb-2">
          <span className="text-dark-500">{icon}</span>
          <span className="text-xs text-dark-400">{label}</span>
        </div>
        {showLoading ? (
          <div className="h-4 bg-dark-700 rounded w-3/4 animate-pulse" />
        ) : (
          <p className="text-sm font-medium text-dark-200 truncate" title={value}>
            {value}
          </p>
        )}
      </div>
      {/* 原始数据弹窗 */}
      {showRaw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowRaw(false)}>
          <div className="bg-dark-800 border border-dark-700/50 rounded-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700/50">
              <h3 className="text-sm font-semibold text-dark-200">{label} - {t("common.viewRawData")}</h3>
              <button onClick={() => setShowRaw(false)} className="text-dark-400 hover:text-dark-200 transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs text-dark-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
              {rawData || t("common.noData")}
            </pre>
            <div className="px-4 py-3 border-t border-dark-700/50 flex justify-end">
              <button onClick={() => { navigator.clipboard.writeText(rawData || ""); }} className="px-3 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-xs">
                {t("common.copy")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** 解析 hidumper -c base 输出为 key-value 列表 */
function parseBaseInfo(raw: string): { key: string; value: string }[] {
  const items: { key: string; value: string }[] = [];
  const isZh = navigator.language.startsWith("zh");

  // 分离 base info 和 GPU info
  const gpuMarkerIdx = raw.indexOf("===GPU_INFO===");
  const baseRaw = gpuMarkerIdx >= 0 ? raw.slice(0, gpuMarkerIdx) : raw;
  const gpuRaw = gpuMarkerIdx >= 0 ? raw.slice(gpuMarkerIdx + "===GPU_INFO===".length) : "";

  // 解析 GPU 信息
  const gpuKv: Record<string, string> = {};
  for (const line of gpuRaw.split("\n")) {
    const trimmed = line.trim();
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (key.startsWith("GL_") && value) gpuKv[key] = value;
  }

  const lines = baseRaw.split("\n");

  // ===== 1. 解析 [base] 段的 key: value =====
  const baseKv: Record<string, string> = {};
  let inBase = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes("[base]")) { inBase = true; continue; }
    if (trimmed.startsWith("---") || trimmed.startsWith("[")) {
      if (inBase && trimmed.startsWith("[")) break;
      continue;
    }
    if (!inBase || !trimmed) continue;
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (key && value) baseKv[key] = value;
  }

  // ===== 2. 解析 /proc/cmdline =====
  let cmdline = "";
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("/proc/cmdline")) {
      // 跳过空行，找到下一个非空行作为参数内容
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) {
          cmdline = lines[j].trim();
          break;
        }
      }
      break;
    }
  }

  // 提取 cmdline 参数的辅助函数
  const getCmdParam = (param: string): string => {
    const re = new RegExp(param + "=(\\S+)");
    const m = cmdline.match(re);
    return m ? m[1] : "";
  };

  // ===== 3. 按指定顺序构建输出 =====
  const t = (zh: string, en: string) => isZh ? zh : en;

  // --- 基本信息 ---
  items.push({ key: t("商品名", "Market Name"), value: baseKv.MarketName || "-" });
  items.push({ key: t("制造商", "Manufacturer"), value: [baseKv.Manufacture, baseKv.Brand].filter(Boolean).join(" / ") || "-" });

  // --- 硬件信息（商品名之后）---
  const cpuChip = getCmdParam("ohos.boot.hardware") || getCmdParam("ohos.boot.chiptype");
  if (cpuChip) items.push({ key: t("CPU", "CPU"), value: cpuChip });

  // GPU 信息优先使用 hidumper RenderService 数据
  const gpuRenderer = gpuKv.GL_RENDERER;
  const gpuVersion = gpuKv.GL_VERSION;
  if (gpuRenderer) {
    items.push({ key: "GPU", value: gpuRenderer });
    if (gpuVersion) items.push({ key: t("OpenGL", "OpenGL"), value: gpuVersion });
  } else {
    // 回退到 cmdline
    const gpu = getCmdParam("ohos.boot.gpu_vendor");
    if (gpu) items.push({ key: "GPU", value: gpu });
  }
  const ufs = getCmdParam("ufs_product_name");
  if (ufs) items.push({ key: t("存储", "Storage"), value: ufs });
  const modemChips: string[] = [];
  const m1 = cmdline.match(/ohos\.boot\.odm\.conn\.chiptype=(\S+)/);
  const m2 = cmdline.match(/ohos\.boot\.odm\.conn\.gnsschiptype=(\S+)/);
  if (m1) modemChips.push(m1[1]);
  if (m2) modemChips.push(m2[1]);
  if (modemChips.length > 0) items.push({ key: t("通信芯片", "Modem Chip"), value: [...new Set(modemChips)].join(", ") });

  // --- 系统信息 ---
  let osVer = baseKv.OsVersion || "-";
  const osMatch = osVer.match(/(OpenHarmony|HarmonyOS)[-\d.]+/);
  if (osMatch) osVer = osMatch[0];
  items.push({ key: t("系统版本", "OS Version"), value: osVer });
  items.push({ key: t("设备类型", "Device Type"), value: baseKv.DeviceType || "-" });
  items.push({ key: t("产品系列", "Product Series"), value: baseKv.ProductSeries || "-" });
  items.push({ key: t("产品型号", "Product Model"), value: baseKv.ProductModel || "-" });

  items.push({ key: t("硬件型号", "Hardware Model"), value: baseKv.HardwareModel || "-" });
  items.push({ key: t("CPU架构", "ABI"), value: baseKv.ABIList || "-" });
  items.push({ key: t("安全补丁", "Security Patch"), value: baseKv.SecurityPatch || "-" });
  items.push({ key: t("增量版本", "Incremental"), value: baseKv.IncrementalVersion || "-" });
  items.push({ key: t("SDK API", "SDK API"), value: baseKv.SDKAPIVersion || "-" });
  items.push({ key: t("构建ID", "Build ID"), value: baseKv.BuildId || "-" });
  items.push({ key: t("发布类型", "Release Type"), value: baseKv.RleaseType || "-" });

  // --- 构建时间 + 系统指纹 ---
  let buildTime = baseKv.BuildTime || "-";
  const ts = parseInt(baseKv.BuildTime || "");
  if (!isNaN(ts) && ts > 1e12) {
    buildTime = new Date(ts).toLocaleString(isZh ? "zh-CN" : "en-US");
  }
  items.push({ key: t("系统指纹", "System Fingerprint"), value: getCmdParam("ohos.boot.hvb.digest") || "-" });
  items.push({ key: t("构建时间", "Build Time"), value: buildTime });

  // --- 运行信息 ---
  const rebootReason = getCmdParam("reboot_reason") || getCmdParam("ohos.boot.reboot_reason");
  if (rebootReason) items.push({ key: t("上次关机原因", "Last Reboot Reason"), value: rebootReason });

  // --- UDID ---
  const udid = getCmdParam("ohos.boot.udid");
  if (udid) items.push({ key: "UDID", value: udid });

  for (const line of lines) {
    if (line.includes("up ") && line.includes("load average")) {
      const match = line.match(/up\s+(.+?),\s+load average:\s+(.+)/);
      if (match) {
        let uptime = match[1].trim();
        uptime = uptime.replace(/0 weeks,?\s*/g, "").replace(/0 days,?\s*/g, "").replace(/0 hours,?\s*/g, "").trim();
        if (uptime.endsWith(",")) uptime = uptime.slice(0, -1);
        items.push({ key: t("运行时间", "Uptime"), value: uptime });
        items.push({ key: t("系统负载", "Load Average"), value: match[2].trim() });
      }
      break;
    }
  }

  return items;
}

function parseAndroidBaseInfo(raw: string): {
  items: { key: string; value: string }[];
  osVersion: string;
  sdkVersion: string;
  securityPatch: string;
  kernelVersion: string;
  screenRes: string;
  cpuInfo: string;
  totalMemory: string;
  abiList: string;
  batteryLevel: number | null;
  totalStorage: string;
  availStorage: string;
  marketName: string;
} {
  const isZh = navigator.language.startsWith("zh");
  const items: { key: string; value: string }[] = [];
  const result: any = {
    items, osVersion: "", sdkVersion: "", securityPatch: "", kernelVersion: "",
    screenRes: "", cpuInfo: "", totalMemory: "", abiList: "",
    batteryLevel: null, totalStorage: "", availStorage: "", marketName: "",
  };

  // 解析 KEY=VALUE 格式
  const kv: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const k = trimmed.slice(0, eqIdx).trim();
      const v = trimmed.slice(eqIdx + 1).trim();
      kv[k] = v;
    }
  }

  const v = (k: string) => kv[k] || "";
  const dash = (k: string) => kv[k] && kv[k].length > 0 ? kv[k] : "-";

  // 回填 cache 字段
  result.marketName = v("MARKET_NAME");
  result.osVersion = v("ANDROID");
  result.sdkVersion = v("SDK");
  result.securityPatch = v("PATCH");
  result.kernelVersion = v("KERNEL");
  result.screenRes = v("RESOLUTION");
  result.cpuInfo = [v("HARDWARE"), v("PROCESSOR")].filter(Boolean).join(" | ");
  result.totalMemory = v("MEM_TOTAL");
  result.abiList = v("ABI_LIST");
  const batLevel = parseInt(v("BAT_LEVEL"));
  if (!isNaN(batLevel)) result.batteryLevel = batLevel;
  const storageParts = v("STORAGE").split(/\s+/);
  if (storageParts.length >= 2) {
    result.totalStorage = storageParts[0];
    result.availStorage = storageParts[1];
  }

  // 构建显示列表
  items.push(
    { key: isZh ? "型号" : "Model", value: dash("MODEL") },
    { key: isZh ? "品牌" : "Brand", value: dash("BRAND") },
    { key: isZh ? "Android" : "Android", value: dash("ANDROID") },
    { key: isZh ? "SDK" : "SDK", value: v("SDK") ? `API ${v("SDK")}` : "-" },
    { key: isZh ? "安全补丁" : "Patch", value: dash("PATCH") },
    { key: isZh ? "版本号" : "Build", value: dash("BUILD") },
    { key: isZh ? "序列号" : "Serial", value: dash("SERIAL") },
    { key: isZh ? "分辨率" : "Resolution", value: dash("RESOLUTION") },
    { key: isZh ? "密度" : "Density", value: dash("DENSITY") },
    { key: isZh ? "刷新率" : "Refresh", value: v("REFRESH") ? `${v("REFRESH")} Hz` : "-" },
    { key: isZh ? "CPU" : "CPU", value: result.cpuInfo || dash("CPU_PLATFORM") || "-" },
    { key: isZh ? "核心数" : "Cores", value: v("CORES") ? `${v("CORES").trim()} ${isZh ? "核" : "cores"}` : "-" },
    { key: isZh ? "最大频率" : "Max Freq", value: dash("MAX_FREQ") },
    { key: isZh ? "GPU" : "GPU", value: dash("GPU") },
    { key: isZh ? "WiFi IP" : "WiFi IP", value: dash("WIFI_IP") === "-" ? (isZh ? "未连接" : "Not connected") : dash("WIFI_IP") },
    { key: isZh ? "支持架构" : "ABI List", value: dash("ABI_LIST") },
    { key: isZh ? "主架构" : "Primary ABI", value: dash("ABI_PRIMARY") },
    { key: isZh ? "内核" : "Kernel", value: dash("KERNEL") },
    { key: isZh ? "运行时间" : "Uptime", value: dash("UPTIME") },
  );

  return result;
}

export default HomePage;
