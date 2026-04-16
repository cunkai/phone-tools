import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeviceStore } from "../store/deviceStore";
import {
  getPerformanceInfo,
  getTopMemoryApps,
  setScreenResolution,
  reboot,
  rebootRecovery,
  rebootBootloader,
} from "../api/adb";
import type { PerformanceInfo, TopMemoryApp } from "../types";
import LoadingSpinner from "../components/LoadingSpinner";

const DeviceInfoPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentDevice, staticInfo, ensureStaticInfo } = useDeviceStore();

  // Each data section has its own state + loading
  const [perfInfo, setPerfInfo] = useState<PerformanceInfo | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);
  const [topMemoryApps, setTopMemoryApps] = useState<TopMemoryApp[]>([]);
  const [topMemLoading, setTopMemLoading] = useState(false);

  // 当前设备的静态信息
  const cachedInfo = currentDevice ? staticInfo[currentDevice] : null;

  // Overall refresh state
  const [refreshing, setRefreshing] = useState(false);

  // Resolution dialog state
  const [showResDialog, setShowResDialog] = useState(false);
  const [resWidth, setResWidth] = useState("1080");
  const [resHeight, setResHeight] = useState("2400");
  const [resDensity, setResDensity] = useState("440");

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [confirmMessage, setConfirmMessage] = useState("");

  const loadPerformance = useCallback(() => {
    if (!currentDevice) return;
    setPerfLoading(true);
    getPerformanceInfo(currentDevice)
      .then(setPerfInfo)
      .catch(() => {})
      .finally(() => setPerfLoading(false));
  }, [currentDevice]);

  const loadTopMemory = useCallback(() => {
    if (!currentDevice) return;
    setTopMemLoading(true);
    getTopMemoryApps(currentDevice)
      .then(setTopMemoryApps)
      .catch(() => {})
      .finally(() => setTopMemLoading(false));
  }, [currentDevice]);

  // Refresh all: 串行加载，每个命令之间留间隔
  const refreshAll = useCallback(async () => {
    if (!currentDevice) return;
    setRefreshing(true);
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // 1. 性能信息（CPU/内存/电池/存储）
    setPerfLoading(true);
    try { const info = await getPerformanceInfo(currentDevice); setPerfInfo(info); } catch {}
    setPerfLoading(false);
    await delay(200);

    // 2. TOP 内存应用
    setTopMemLoading(true);
    try { const apps = await getTopMemoryApps(currentDevice); setTopMemoryApps(apps); } catch {}
    setTopMemLoading(false);

    // 3. 静态信息（有缓存则跳过）
    await ensureStaticInfo(currentDevice);

    setRefreshing(false);
  }, [currentDevice, ensureStaticInfo]);

  // 首次加载 + 设备变化时自动加载所有数据
  useEffect(() => {
    if (currentDevice) {
      refreshAll();
    }
  }, [currentDevice]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApplyResolution = useCallback(async () => {
    if (!currentDevice) return;
    const w = parseInt(resWidth, 10);
    const h = parseInt(resHeight, 10);
    const d = parseInt(resDensity, 10);
    if (isNaN(w) || isNaN(h) || isNaN(d)) return;
    try {
      await setScreenResolution(currentDevice, w, h, d);
      setShowResDialog(false);
    } catch {
      // ignore
    }
  }, [currentDevice, resWidth, resHeight, resDensity]);

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

  if (!currentDevice) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-dark-400">{t("device.noDevice")}</p>
      </div>
    );
  }

  const memPercent = perfInfo?.memory_total_bytes && perfInfo.memory_total_bytes > 0
    ? (perfInfo.memory_used_bytes / perfInfo.memory_total_bytes) * 100
    : 0;
  const storagePercent = perfInfo?.storage_total_bytes && perfInfo.storage_total_bytes > 0
    ? (perfInfo.storage_used_bytes / perfInfo.storage_total_bytes) * 100
    : 0;

  // Small inline loading indicator
  const MiniLoader = () => (
    <span className="inline-block w-3 h-3 border border-dark-500 border-t-accent-400 rounded-full animate-spin ml-2" />
  );

  return (
    <div className="p-6 max-w-4xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-dark-100">{t("nav.deviceInfo")}</h1>
        <button
          onClick={refreshAll}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 disabled:opacity-50 transition-colors text-sm"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={refreshing ? "animate-spin" : ""}>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {t("common.refresh")}
        </button>
      </div>

      {/* Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-dark-800 border border-dark-700/50 rounded-xl p-6 max-w-sm w-full mx-4">
            <p className="text-dark-200 mb-6">{confirmMessage}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setConfirmAction(null); setConfirmMessage(""); }}
                className="px-4 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm"
              >
                {t("common.cancel")}
              </button>
              <button onClick={executeConfirm} className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors text-sm">
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolution Dialog */}
      {showResDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-dark-800 border border-dark-700/50 rounded-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-sm font-semibold text-dark-200 mb-4">{t("deviceInfo.changeResolution")}</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="text-xs text-dark-500 mb-1 block">Width</label>
                <input type="number" value={resWidth} onChange={(e) => setResWidth(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-dark-700 border border-dark-600/50 text-dark-100 text-sm focus:outline-none focus:border-accent-500/50" />
              </div>
              <div>
                <label className="text-xs text-dark-500 mb-1 block">Height</label>
                <input type="number" value={resHeight} onChange={(e) => setResHeight(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-dark-700 border border-dark-600/50 text-dark-100 text-sm focus:outline-none focus:border-accent-500/50" />
              </div>
              <div>
                <label className="text-xs text-dark-500 mb-1 block">Density</label>
                <input type="number" value={resDensity} onChange={(e) => setResDensity(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-dark-700 border border-dark-600/50 text-dark-100 text-sm focus:outline-none focus:border-accent-500/50" />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowResDialog(false)} className="px-4 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm">
                {t("common.cancel")}
              </button>
              <button onClick={handleApplyResolution} className="px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors text-sm">
                {t("control.apply")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Row 1: CPU + Memory */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* CPU Gauge */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-dark-300 mb-4 flex items-center">
              {t("monitor.cpuUsage")}
              {perfLoading && <MiniLoader />}
            </h3>
            {perfInfo ? (
              <div className="flex items-center justify-center">
                <div className="relative w-40 h-40">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#334155" strokeWidth="10" />
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#3b82f6" strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={`${(perfInfo.cpu_usage / 100) * 314} 314`}
                      className="transition-all duration-1000 ease-out" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold text-dark-100">{Math.round(perfInfo.cpu_usage)}</span>
                    <span className="text-xs text-dark-400">%</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40">
                <span className="text-dark-500 text-sm">{perfLoading ? "" : t("common.noData")}</span>
              </div>
            )}
          </div>

          {/* Memory */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-dark-300 mb-4 flex items-center">
              {t("monitor.memoryUsage")}
              {perfLoading && <MiniLoader />}
            </h3>
            {perfInfo ? (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-xs text-dark-400">{t("monitor.ram")}</span>
                    <span className="text-xs text-dark-300">{perfInfo.memory_used} / {perfInfo.memory_total}</span>
                  </div>
                  <div className="w-full h-3 bg-dark-700 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-accent-500 to-accent-400 rounded-full transition-all duration-1000"
                      style={{ width: `${memPercent}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                    <span className="text-xs text-dark-500">{t("monitor.used")}</span>
                    <p className="text-sm text-dark-200 font-medium mt-1">{perfInfo.memory_used}</p>
                  </div>
                  <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                    <span className="text-xs text-dark-500">{t("monitor.free")}</span>
                    <p className="text-sm text-dark-200 font-medium mt-1">{perfInfo.memory_free}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40">
                <span className="text-dark-500 text-sm">{perfLoading ? "" : t("common.noData")}</span>
              </div>
            )}
          </div>

          {/* Battery */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-dark-300 mb-4 flex items-center">
              {t("monitor.batteryStatus")}
              {perfLoading && <MiniLoader />}
            </h3>
            {perfInfo ? (
              <div className="flex items-center gap-6">
                <div className="relative">
                  <div className={`w-20 h-32 rounded-xl border-2 flex items-end justify-center pb-2 transition-colors ${perfInfo.battery_level > 20 ? "border-green-500/50" : "border-red-500/50"}`}>
                    <div className={`w-14 rounded-md transition-all duration-1000 ${perfInfo.battery_level > 20 ? "bg-green-500/30" : "bg-red-500/30"}`}
                      style={{ height: `${(perfInfo.battery_level / 100) * 100}%` }} />
                  </div>
                  <div className="absolute -right-1.5 top-6 w-2 h-4 bg-dark-600 rounded-r" />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-3xl font-bold text-dark-100">{perfInfo.battery_level}</span>
                    <span className="text-sm text-dark-400">%</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-xs text-dark-500">{t("monitor.status")}</span>
                      <span className="text-xs text-dark-300">{perfInfo.battery_status}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-dark-500">{t("monitor.temperature")}</span>
                      <span className="text-xs text-dark-300">{perfInfo.battery_temperature}</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40">
                <span className="text-dark-500 text-sm">{perfLoading ? "" : t("common.noData")}</span>
              </div>
            )}
          </div>

          {/* Storage */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-dark-300 mb-4 flex items-center">
              {t("monitor.storageSpace")}
              {perfLoading && <MiniLoader />}
            </h3>
            {perfInfo ? (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-xs text-dark-400">{t("monitor.rom")}</span>
                    <span className="text-xs text-dark-300">{perfInfo.storage_used} / {perfInfo.storage_total}</span>
                  </div>
                  <div className="w-full h-3 bg-dark-700 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded-full transition-all duration-1000"
                      style={{ width: `${storagePercent}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                    <span className="text-xs text-dark-500">{t("monitor.used")}</span>
                    <p className="text-sm text-dark-200 font-medium mt-1">{perfInfo.storage_used}</p>
                  </div>
                  <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                    <span className="text-xs text-dark-500">{t("monitor.free")}</span>
                    <p className="text-sm text-dark-200 font-medium mt-1">{perfInfo.storage_free}</p>
                  </div>
                  <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                    <span className="text-xs text-dark-500">{t("monitor.total")}</span>
                    <p className="text-sm text-dark-200 font-medium mt-1">{perfInfo.storage_total}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40">
                <span className="text-dark-500 text-sm">{perfLoading ? "" : t("common.noData")}</span>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Extra info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* CPU Architecture */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-dark-300 mb-4">
              {t("deviceInfo.cpuArch")}
            </h3>
            <p className="text-dark-100 font-mono text-sm">{cachedInfo?.cpuArch || "-"}</p>
          </div>

          {/* Top Memory Apps */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-dark-300 mb-4 flex items-center">
              {t("deviceInfo.topMemoryApps")}
              {topMemLoading && <MiniLoader />}
            </h3>
            {topMemoryApps.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-700/50">
                    <th className="text-left py-2 text-dark-400 font-medium">#</th>
                    <th className="text-left py-2 text-dark-400 font-medium">Package</th>
                    <th className="text-right py-2 text-dark-400 font-medium">Memory</th>
                  </tr>
                </thead>
                <tbody>
                  {topMemoryApps.map((app, idx) => (
                    <tr key={app.package_name} className="border-b border-dark-700/30">
                      <td className="py-2 text-dark-500">{idx + 1}</td>
                      <td className="py-2 text-dark-200 font-mono truncate max-w-[200px]">{app.package_name}</td>
                      <td className="py-2 text-dark-200 text-right">{app.memory_used}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-dark-500 text-sm">{topMemLoading ? "" : "-"}</p>
            )}
          </div>

          {/* Reboot */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-dark-300 mb-4">{t("control.reboot")}</h3>
            <div className="flex gap-2">
              <button onClick={handleReboot}
                className="flex-1 px-3 py-2 rounded-lg bg-dark-700 text-dark-200 hover:bg-yellow-500/20 hover:text-yellow-400 transition-colors text-sm font-medium">
                {t("control.reboot")}
              </button>
              <button onClick={handleRebootRecovery}
                className="flex-1 px-3 py-2 rounded-lg bg-dark-700 text-dark-200 hover:bg-orange-500/20 hover:text-orange-400 transition-colors text-sm font-medium">
                {t("control.rebootRecovery")}
              </button>
              <button onClick={handleRebootBootloader}
                className="flex-1 px-3 py-2 rounded-lg bg-dark-700 text-dark-200 hover:bg-red-500/20 hover:text-red-400 transition-colors text-sm font-medium">
                {t("control.rebootBootloader")}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeviceInfoPage;
