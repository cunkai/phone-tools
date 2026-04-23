import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useDeviceStore } from "../store/deviceStore";
import ConfirmDialog from "../components/ConfirmDialog";
import LoadingSpinner from "../components/LoadingSpinner";
import type { AdbDevice } from "../types";
import { getDeviceProps, getBatteryInfo, getStorageInfo, getMemoryInfo, getCpuArchitecture, getScreenResolution, takeScreenshot, hdcGetDeviceInfo, hdcScreenshot, exportBugreport, cancelBugreport, hdcGetBaseInfo, getAndroidBaseInfo, restartAdbService, restartHdcService, reboot, rebootRecovery, rebootBootloader, hdcReboot, hdcRebootRecovery, hdcRebootBootloader } from "../api/adb";
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
  const [showRestartConfirm, setShowRestartConfirm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showRebootDialog, setShowRebootDialog] = useState(false);

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
  const currentPlatform = device?.platform || "android";

  const handleRebootNormal = useCallback(async () => {
    if (!currentDevice) return;
    try {
      if (currentPlatform === "harmonyos") {
        await hdcReboot(currentDevice);
      } else {
        await reboot(currentDevice);
      }
    } catch {}
    setShowRebootDialog(false);
  }, [currentDevice, currentPlatform]);

  const handleRebootRecovery = useCallback(async () => {
    if (!currentDevice) return;
    try {
      if (currentPlatform === "harmonyos") {
        await hdcRebootRecovery(currentDevice);
      } else {
        await rebootRecovery(currentDevice);
      }
    } catch {}
    setShowRebootDialog(false);
  }, [currentDevice, currentPlatform]);

  const handleRebootBootloader = useCallback(async () => {
    if (!currentDevice) return;
    try {
      if (currentPlatform === "harmonyos") {
        await hdcRebootBootloader(currentDevice);
      } else {
        await rebootBootloader(currentDevice);
      }
    } catch {}
    setShowRebootDialog(false);
  }, [currentDevice, currentPlatform]);

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
            const parsed = parseAndroidBaseInfo(info, t);
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
        <div className="flex-1 overflow-auto">
          <div className="max-w-2xl mx-auto py-8">
            {/* 等待设备标题 */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-dark-800 flex items-center justify-center">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-dark-500">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
                  <line x1="12" y1="18" x2="12.01" y2="18" />
                </svg>
              </div>
              <p className="text-dark-400 mb-4">{t("device.noDevice")}</p>
            </div>

            {/* 步骤1 */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-2">
                <span className="w-6 h-6 rounded-full bg-accent-500/20 text-accent-400 flex items-center justify-center text-sm font-semibold">1</span>
                <h3 className="text-sm font-semibold text-dark-200">{t('guide.step1Title')}</h3>
              </div>
              <p className="text-sm text-dark-400 ml-9">{t('guide.step1Desc')}</p>
            </div>

            {/* 步骤2 */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-2">
                <span className="w-6 h-6 rounded-full bg-accent-500/20 text-accent-400 flex items-center justify-center text-sm font-semibold">2</span>
                <h3 className="text-sm font-semibold text-dark-200">{t('guide.step2Title')}</h3>
              </div>
              <p className="text-sm text-dark-400 ml-9">{t('guide.step2Desc')}</p>
            </div>

            {/* 步骤3 */}
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-2">
                <span className="w-6 h-6 rounded-full bg-accent-500/20 text-accent-400 flex items-center justify-center text-sm font-semibold">3</span>
                <h3 className="text-sm font-semibold text-dark-200">{t('guide.step3Title')}</h3>
              </div>

              {/* 方法一 USB */}
              <div className="ml-9 mb-4">
                <h4 className="text-xs font-semibold text-dark-300 mb-2">{t('guide.step3Title')}</h4>
                <p className="text-sm text-dark-400">
                  {t('guide.step3Desc')}
                </p>
              </div>

              {/* 方法二 WiFi */}
              <div className="ml-9">
                <h4 className="text-xs font-semibold text-dark-300 mb-2">{t('guide.step4Title')}</h4>
                <p className="text-sm text-dark-400">
                  {t('guide.step4Desc')}
                </p>
              </div>
            </div>

            {/* 重启服务提示 */}
            <div className="mt-8 text-center">
              <p className="text-sm text-blue-400 cursor-pointer hover:underline" onClick={async () => {
                useDeviceStore.setState({ isReconnecting: true });
                try {
                  await restartAdbService();
                  await restartHdcService();
                  // 服务重启成功，立即关闭通知
                  useDeviceStore.setState({ isReconnecting: false });
                  // 刷新设备列表
                  fetchDevices();
                } catch (e: any) {
                  console.error("restart service failed:", e);
                  useDeviceStore.setState({ isReconnecting: false });
                }
              }}>
                {t('common.restartService')}
              </p>
            </div>
          </div>
        </div>
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
                <div className="relative w-full max-w-[200px] mb-3 group">
                  <img
                    src={`data:image/jpeg;base64,${deviceScreenshot}`}
                    alt="Screenshot"
                    className="w-full rounded-lg border border-dark-700/50"
                  />
                  {/* 悬停按钮 */}
                  <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
                      className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors bg-dark-700 hover:bg-dark-600 border border-dark-600"
                    >
                      {t("common.refresh")}
                    </button>
                    <button
                      onClick={async () => {
                        if (!deviceScreenshot) return;
                        try {
                          const safeName = (marketName || device?.model || currentDevice).replace(/[\\/:*?"<>|]/g, "_");
                          const result = await save({
                            defaultPath: `screenshot_${safeName}_${new Date().toISOString().slice(0, 10)}.jpeg`,
                            filters: [{ name: "JPEG", extensions: ["jpeg", "jpg"] }],
                          });
                          if (!result) return;
                          
                          // 使用浏览器的 Blob API 来保存文件
                          const binaryData = atob(deviceScreenshot);
                          const arrayBuffer = new ArrayBuffer(binaryData.length);
                          const uint8Array = new Uint8Array(arrayBuffer);
                          for (let i = 0; i < binaryData.length; i++) {
                            uint8Array[i] = binaryData.charCodeAt(i);
                          }
                          
                          // 创建 Blob 对象
                          const blob = new Blob([uint8Array], { type: 'image/jpeg' });
                          
                          // 创建下载链接
                          const url = URL.createObjectURL(blob);
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = result.split('/').pop() || `screenshot_${safeName}.jpeg`;
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                          URL.revokeObjectURL(url);
                          
                          // 同时更新截图历史
                          saveDeviceScreenshot(deviceScreenshot, currentDevice);
                        } catch (e: any) {
                          console.error("download screenshot failed:", e);
                        }
                      }}
                      className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors bg-dark-700 hover:bg-dark-600 border border-dark-600"
                    >
                      {t('tools.saveScreenshot')}
                    </button>
                    <button
                      onClick={() => setShowRebootDialog(true)}
                      className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-yellow-400 transition-colors bg-dark-700 hover:bg-yellow-500/20 border border-dark-600"
                    >
                      {t('control.reboot')}
                    </button>
                  </div>
                </div>
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
              {/* 操作按钮 */}
          {detailHover && (
          <div className="absolute -top-1 right-1 z-10 flex items-center gap-1">
            <button
              onClick={() => setShowRawData(true)}
              className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors bg-dark-700 hover:bg-dark-600 border border-dark-600"
            >
              {t("common.viewRawData")}
            </button>
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
              className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors bg-dark-700 hover:bg-dark-600 border border-dark-600"
            >
              {t("common.refresh")}
            </button>
          </div>
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
                  {/* 显示基础信息 */}
                  {(currentPlatform === "harmonyos" ? parseBaseInfo(baseInfo, screenRes, maxRefreshRate, device?.serial || "", t) : parseAndroidBaseInfo(baseInfo, t).items).map((item) => (
                    <div key={item.key} className="flex items-baseline gap-3">
                      <span className="text-dark-500 whitespace-nowrap shrink-0 w-32 text-right">{item.key}</span>
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
          
          // 构建完整的设备信息对象，包含所有主页显示的参数
          const deviceInfo: Record<string, any> = {
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
            securityPatch,
            abiList,
            maxRefreshRate,
          };
          
          // 如果有 baseInfo，解析出更多参数添加到 deviceInfo
          if (baseInfo) {
            const parsedItems = parseBaseInfo(baseInfo, screenRes, maxRefreshRate || 0, currentDevice, (key: string, fallback: string) => fallback);
            for (const item of parsedItems) {
              // 将解析出的键值对转换为驼峰命名并添加到 deviceInfo
              const key = item.key.replace(/\s+/g, '').replace(/[^\w]/g, '');
              if (!deviceInfo[key] && item.value && item.value !== "-") {
                deviceInfo[key] = item.value;
              }
            }
          }
          
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
              onClick={() => {
                if (!currentDevice) return;
                navigate("/terminal");
              }}
              className="flex flex-col items-center gap-2 p-4 bg-dark-800/50 border border-dark-700/50 rounded-xl hover:bg-dark-800 transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-400">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span className="text-xs text-dark-300">Shell</span>
            </button>
            <button
              onClick={() => {
                if (!currentDevice) return;
                navigate("/automation");
              }}
              className="flex flex-col items-center gap-2 p-4 bg-dark-800/50 border border-dark-700/50 rounded-xl hover:bg-dark-800 transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400">
                <rect x="5" y="11" width="14" height="10" rx="2" />
                <rect x="7" y="3" width="10" height="8" rx="2" />
                <line x1="12" y1="19" x2="12" y2="21" />
                <circle cx="9" cy="7" r="1" />
                <circle cx="15" cy="7" r="1" />
              </svg>
              <span className="text-xs text-dark-300">{t('nav.automation')}</span>
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

      {/* 重启对话框 */}
      {showRebootDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowRebootDialog(false)}>
          <div className="bg-dark-800 border border-dark-700/50 rounded-xl max-w-sm w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-dark-100 mb-6">{t('control.reboot')}</h3>
            <div className="space-y-3">
              <button
                onClick={handleRebootNormal}
                className="w-full px-4 py-3 rounded-lg bg-dark-700 text-dark-200 hover:bg-yellow-500/20 hover:text-yellow-400 transition-colors text-sm font-medium"
              >
                {t('control.reboot')}
              </button>
              <button
                onClick={handleRebootRecovery}
                className="w-full px-4 py-3 rounded-lg bg-dark-700 text-dark-200 hover:bg-orange-500/20 hover:text-orange-400 transition-colors text-sm font-medium"
              >
                {t('control.rebootRecovery')}
              </button>
              <button
                onClick={handleRebootBootloader}
                className="w-full px-4 py-3 rounded-lg bg-dark-700 text-dark-200 hover:bg-red-500/20 hover:text-red-400 transition-colors text-sm font-medium"
              >
                {t('control.rebootBootloader')}
              </button>
            </div>
            <button
              onClick={() => setShowRebootDialog(false)}
              className="w-full px-4 py-3 mt-4 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm font-medium"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
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
        { (onRefresh || rawData) && (
          <div className="hidden group-hover:flex absolute -top-1 right-1 z-10 items-center gap-1">
            {rawData && (
              <button
                onClick={() => setShowRaw(true)}
                className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors bg-dark-700 hover:bg-dark-600 border border-dark-600"
              >
                {t("common.viewRawData")}
              </button>
            )}
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors bg-dark-700 hover:bg-dark-600 border border-dark-600"
              >
                {t("common.refresh")}
              </button>
            )}
          </div>
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
function parseBaseInfo(raw: string, screenRes: string, maxRefreshRate: number, serial: string, t: any): { key: string; value: string }[] {
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

  // --- 基本信息 ---
  items.push({ key: t("device.marketName", "Market Name"), value: baseKv.MarketName || "-" });
  // 制造商信息：如果Manufacture和Brand相同，只显示一个
  const manufacture = baseKv.Manufacture || "";
  const brand = baseKv.Brand || "";
  let manufacturerValue = "-";
  if (manufacture && brand) {
    if (manufacture === brand) {
      manufacturerValue = manufacture;
    } else {
      manufacturerValue = `${manufacture} / ${brand}`;
    }
  } else if (manufacture) {
    manufacturerValue = manufacture;
  } else if (brand) {
    manufacturerValue = brand;
  }
  items.push({ key: t("device.manufacturer", "Manufacturer"), value: manufacturerValue });

  // --- 硬件信息（商品名之后）---
  const cpuChip = getCmdParam("ohos.boot.hardware") || getCmdParam("ohos.boot.chiptype");
  if (cpuChip) items.push({ key: t("device.cpu", "CPU"), value: cpuChip });

  // GPU 信息优先使用 hidumper RenderService 数据
  const gpuRenderer = gpuKv.GL_RENDERER;
  const gpuVersion = gpuKv.GL_VERSION;
  const gpuVendor = getCmdParam("ohos.boot.gpu_vendor");
  if (gpuRenderer) {
    let gpuValue = gpuRenderer;
    if (gpuVendor) {
      gpuValue += ` (${gpuVendor})`;
    }
    items.push({ key: "GPU", value: gpuValue });
    if (gpuVersion) items.push({ key: "OpenGL", value: gpuVersion });
  } else {
    // 回退到 cmdline
    const gpu = getCmdParam("ohos.boot.gpu_vendor");
    if (gpu) items.push({ key: "GPU", value: gpu });
  }
  const ufs = getCmdParam("ufs_product_name");
  if (ufs) items.push({ key: t("device.storage", "Storage"), value: ufs });
  const modemChips: string[] = [];
  const m1 = cmdline.match(/ohos\.boot\.odm\.conn\.chiptype=(\S+)/);
  const m2 = cmdline.match(/ohos\.boot\.odm\.conn\.gnsschiptype=(\S+)/);
  if (m1) modemChips.push(m1[1]);
  if (m2) modemChips.push(m2[1]);
  if (modemChips.length > 0) items.push({ key: t("device.modemChip", "Modem Chip"), value: [...new Set(modemChips)].join(", ") });

  // --- 显示信息 ---
  if (screenRes) items.push({ key: t("device.screenResolution", "Screen Resolution"), value: screenRes });
  if (maxRefreshRate > 0) items.push({ key: t("device.maxRefreshRate", "Max Refresh Rate"), value: `${maxRefreshRate} Hz` });

  // --- 系统信息 ---
  let osVer = baseKv.OsVersion || "-";
  const osMatch = osVer.match(/(OpenHarmony|HarmonyOS)[-\d.]+/);
  if (osMatch) osVer = osMatch[0];
  items.push({ key: t("device.osVersion", "OS Version"), value: osVer });
  items.push({ key: t("device.deviceType", "Device Type"), value: baseKv.DeviceType || "-" });
  items.push({ key: t("device.productSeries", "Product Series"), value: baseKv.ProductSeries || "-" });
  items.push({ key: t("device.productModel", "Product Model"), value: baseKv.ProductModel || "-" });

  items.push({ key: t("device.hardwareModel", "Hardware Model"), value: baseKv.HardwareModel || "-" });
  items.push({ key: t("device.abiList", "ABI"), value: baseKv.ABIList || "-" });
  items.push({ key: t("device.securityPatch", "Security Patch"), value: baseKv.SecurityPatch || "-" });
  items.push({ key: t("device.incremental", "Incremental"), value: baseKv.IncrementalVersion || "-" });
  items.push({ key: t("device.sdkVersion", "SDK API"), value: baseKv.SDKAPIVersion || "-" });
  items.push({ key: t("device.buildId", "Build ID"), value: baseKv.BuildId || "-" });
  items.push({ key: t("device.releaseType", "Release Type"), value: baseKv.RleaseType || "-" });

  // --- 构建时间 + 系统指纹 ---
  let buildTime = baseKv.BuildTime || "-";
  const ts = parseInt(baseKv.BuildTime || "");
  if (!isNaN(ts) && ts > 1e12) {
    buildTime = new Date(ts).toLocaleString(isZh ? "zh-CN" : "en-US");
  }
  items.push({ key: t("device.systemFingerprint", "System Fingerprint"), value: getCmdParam("ohos.boot.hvb.digest") || "-" });
  items.push({ key: t("device.buildTime", "Build Time"), value: buildTime });

  // --- 运行信息 ---
  const rebootReason = getCmdParam("reboot_reason") || getCmdParam("ohos.boot.reboot_reason");
  if (rebootReason) items.push({ key: t("device.lastRebootReason", "Last Reboot Reason"), value: rebootReason });

  // --- UDID ---
  const udid = getCmdParam("ohos.boot.udid");
  if (udid) items.push({ key: "UDID", value: udid });

  // --- SN ---
  const cmdlineSn = getCmdParam("sn");
  // 对于 HarmonyOS 设备，优先使用 cmdline 中的 SN，因为 device.serial 可能是 IP:端口
  const displaySn = cmdlineSn || serial;
  if (displaySn) items.push({ key: t("device.serial", "Serial"), value: displaySn });

  // --- 电池SN ---
  const batterySn = getCmdParam("battery_nv_sn");
  if (batterySn) items.push({ key: t("device.batterySn", "Battery SN"), value: batterySn });

  // --- 存储芯片 CID 码 ---
  const storageCid = getCmdParam("storage_cid");
  if (storageCid) items.push({ key: t("device.storageCid", "Storage CID"), value: storageCid });

  // --- 系统崩溃 ---
  const panicPc = getCmdParam("panic_pc");
  if (panicPc) items.push({ key: t("device.systemCrash", "System Crash"), value: panicPc === "NA" ? t("common.none", "None") : panicPc });

  // --- 系统类型 ---
  const hvbEnable = getCmdParam("ohos.boot.hvb.enable");
  if (hvbEnable) items.push({ key: t("device.systemType", "System Type"), value: hvbEnable === "green" ? t("device.officialSystem", "Official System") : t("device.thirdPartySystem", "Third-party System") });

  // --- Bootloader锁 ---
  const hvbDeviceState = getCmdParam("ohos.boot.hvb.device_state");
  if (hvbDeviceState) items.push({ key: t("device.bootloaderLock", "Bootloader Lock"), value: hvbDeviceState === "locked" ? t("common.yes", "Yes") : t("common.no", "No") });

  // --- 设备区域 ---
  const deviceRegion = getCmdParam("device_region");
  if (deviceRegion) items.push({ key: t("device.deviceRegion", "Device Region"), value: deviceRegion });

  // --- OEM模式 ---
  const oemMode = getCmdParam("oemmode");
  if (oemMode) items.push({ key: t("device.oemMode", "OEM Mode"), value: oemMode });

  // --- 主板ID ---
  const boardId = getCmdParam("ohos.boot.board.boardid") || getCmdParam("boardid");
  if (boardId) items.push({ key: t("device.boardId", "Board ID"), value: boardId });

  for (const line of lines) {
    if (line.includes("up ") && line.includes("load average")) {
      const match = line.match(/up\s+(.+?),\s+load average:\s+(.+)/);
      if (match) {
        let uptime = match[1].trim();
        uptime = uptime.replace(/0 weeks,?\s*/g, "").replace(/0 days,?\s*/g, "").replace(/0 hours,?\s*/g, "").trim();
        if (uptime.endsWith(",")) uptime = uptime.slice(0, -1);
        items.push({ key: t("device.uptime", "Uptime"), value: uptime });
        items.push({ key: t("device.loadAverage", "Load Average"), value: match[2].trim() });
      }
      break;
    }
  }

  return items;
}

function parseAndroidBaseInfo(raw: string, t: any): {
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
    { key: t("device.model", "Model"), value: dash("MODEL") },
    { key: t("device.brand", "Brand"), value: dash("BRAND") },
    { key: "Android", value: dash("ANDROID") },
    { key: t("device.sdkVersion", "SDK"), value: v("SDK") ? `API ${v("SDK")}` : "-" },
    { key: t("device.securityPatch", "Security Patch"), value: dash("PATCH") },
    { key: t("device.buildId", "Build"), value: dash("BUILD") },
    { key: t("device.serial", "Serial"), value: dash("SERIAL") },
    { key: t("device.screenResolution", "Resolution"), value: dash("RESOLUTION") },
    { key: t("device.density", "Density"), value: dash("DENSITY") },
    { key: t("device.refreshRate", "Refresh"), value: v("REFRESH") ? `${v("REFRESH")} Hz` : "-" },
    { key: t("device.cpu", "CPU"), value: result.cpuInfo || dash("CPU_PLATFORM") || "-" },
    { key: t("device.cores", "Cores"), value: v("CORES") ? `${v("CORES").trim()} ${isZh ? "核" : "cores"}` : "-" },
    { key: t("device.maxFreq", "Max Freq"), value: dash("MAX_FREQ") },
    { key: "GPU", value: dash("GPU") },
    { key: t("device.wifiIp", "WiFi IP"), value: dash("WIFI_IP") === "-" ? t("device.notConnected", "Not connected") : dash("WIFI_IP") },
    { key: t("device.abiList", "ABI List"), value: dash("ABI_LIST") },
    { key: t("device.primaryAbi", "Primary ABI"), value: dash("ABI_PRIMARY") },
    { key: t("device.kernelVersion", "Kernel"), value: dash("KERNEL") },
    { key: t("device.uptime", "Uptime"), value: dash("UPTIME") },
  );

  return result;
}

export default HomePage;
