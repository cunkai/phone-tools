import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeviceStore } from "../store/deviceStore";
import { getPerformanceInfo } from "../api/adb";
import type { PerformanceInfo } from "../types";
import LoadingSpinner from "../components/LoadingSpinner";

const MonitorPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentDevice } = useDeviceStore();
  const [perfInfo, setPerfInfo] = useState<PerformanceInfo | null>(null);
  const [loading, setLoading] = useState(false);

  const loadPerformance = async () => {
    if (!currentDevice) return;
    setLoading(true);
    try {
      const info = await getPerformanceInfo(currentDevice);
      setPerfInfo(info);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPerformance();
  }, [currentDevice]);

  useEffect(() => {
    if (!currentDevice) return;
    const interval = setInterval(loadPerformance, 3000);
    return () => clearInterval(interval);
  }, [currentDevice]);

  if (!currentDevice) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-dark-400">{t("device.noDevice")}</p>
      </div>
    );
  }

  if (!perfInfo) {
    return (
      <div className="p-6 max-w-4xl mx-auto animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-dark-100">
            {t("nav.monitor")}
          </h1>
        </div>
        <div className="flex items-center justify-center h-64">
          <LoadingSpinner />
        </div>
      </div>
    );
  }

  const memPercent = perfInfo.memory_total_bytes > 0
    ? (perfInfo.memory_used_bytes / perfInfo.memory_total_bytes) * 100
    : 0;
  const storagePercent = perfInfo.storage_total_bytes > 0
    ? (perfInfo.storage_used_bytes / perfInfo.storage_total_bytes) * 100
    : 0;

  return (
    <div className="p-6 max-w-4xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-dark-100">
          {t("nav.monitor")}
        </h1>
        {loading && <LoadingSpinner size="sm" />}
      </div>

      {!perfInfo ? (
        <div className="flex items-center justify-center h-64">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* CPU Gauge */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-dark-300 mb-4">
              {t("monitor.cpuUsage")}
            </h3>
            <div className="flex items-center justify-center">
              <div className="relative w-40 h-40">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    fill="none"
                    stroke="#334155"
                    strokeWidth="10"
                  />
                  <circle
                    cx="60"
                    cy="60"
                    r="50"
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${(perfInfo.cpu_usage / 100) * 314} 314`}
                    className="transition-all duration-1000 ease-out"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold text-dark-100">
                    {Math.round(perfInfo.cpu_usage)}
                  </span>
                  <span className="text-xs text-dark-400">%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Memory */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-dark-300 mb-4">
              {t("monitor.memoryUsage")}
            </h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs text-dark-400">{t("monitor.ram")}</span>
                  <span className="text-xs text-dark-300">
                    {perfInfo.memory_used} / {perfInfo.memory_total}
                  </span>
                </div>
                <div className="w-full h-3 bg-dark-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-accent-500 to-accent-400 rounded-full transition-all duration-1000"
                    style={{
                      width: `${memPercent}%`,
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                  <span className="text-xs text-dark-500">{t("monitor.used")}</span>
                  <p className="text-sm text-dark-200 font-medium mt-1">
                    {perfInfo.memory_used}
                  </p>
                </div>
                <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                  <span className="text-xs text-dark-500">{t("monitor.free")}</span>
                  <p className="text-sm text-dark-200 font-medium mt-1">
                    {perfInfo.memory_free}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Battery */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-dark-300 mb-4">
              {t("monitor.batteryStatus")}
            </h3>
            <div className="flex items-center gap-6">
              <div className="relative">
                <div
                  className={`w-20 h-32 rounded-xl border-2 flex items-end justify-center pb-2 transition-colors ${
                    perfInfo.battery_level > 20
                      ? "border-green-500/50"
                      : "border-red-500/50"
                  }`}
                >
                  <div
                    className={`w-14 rounded-md transition-all duration-1000 ${
                      perfInfo.battery_level > 20 ? "bg-green-500/30" : "bg-red-500/30"
                    }`}
                    style={{
                      height: `${(perfInfo.battery_level / 100) * 100}%`,
                    }}
                  />
                </div>
                <div className="absolute -right-1.5 top-6 w-2 h-4 bg-dark-600 rounded-r" />
              </div>
              <div className="flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-3xl font-bold text-dark-100">
                    {perfInfo.battery_level}
                  </span>
                  <span className="text-sm text-dark-400">%</span>
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-xs text-dark-500">{t("monitor.status")}</span>
                    <span className="text-xs text-dark-300">
                      {perfInfo.battery_status}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs text-dark-500">{t("monitor.temperature")}</span>
                    <span className="text-xs text-dark-300">
                      {perfInfo.battery_temperature}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Storage */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-dark-300 mb-4">
              {t("monitor.storageSpace")}
            </h3>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-xs text-dark-400">{t("monitor.rom")}</span>
                  <span className="text-xs text-dark-300">
                    {perfInfo.storage_used} / {perfInfo.storage_total}
                  </span>
                </div>
                <div className="w-full h-3 bg-dark-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded-full transition-all duration-1000"
                    style={{
                      width: `${storagePercent}%`,
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                  <span className="text-xs text-dark-500">{t("monitor.used")}</span>
                  <p className="text-sm text-dark-200 font-medium mt-1">
                    {perfInfo.storage_used}
                  </p>
                </div>
                <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                  <span className="text-xs text-dark-500">{t("monitor.free")}</span>
                  <p className="text-sm text-dark-200 font-medium mt-1">
                    {perfInfo.storage_free}
                  </p>
                </div>
                <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                  <span className="text-xs text-dark-500">{t("monitor.total")}</span>
                  <p className="text-sm text-dark-200 font-medium mt-1">
                    {perfInfo.storage_total}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonitorPage;
