import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useDeviceStore } from "../store/deviceStore";
import { hdcGetDeviceInfo } from "../api/adb";

const WIFI_HISTORY_KEY = "wifi_connect_history";

interface WifiHistoryItem {
  udid: string;
  ip: string;
  port: string;
  marketName: string;
  lastConnected: number;
}

function getWifiHistory(): WifiHistoryItem[] {
  try {
    const raw = localStorage.getItem(WIFI_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveWifiHistory(history: WifiHistoryItem[]) {
  localStorage.setItem(WIFI_HISTORY_KEY, JSON.stringify(history));
}

function addToWifiHistory(ip: string, port: string, udid: string, marketName: string) {
  const history = getWifiHistory();
  // 用 UDID 去重，同一设备更新 ip/port 和时间
  const filtered = history.filter((h) => h.udid !== udid && `${h.ip}:${h.port}` !== `${ip}:${port}`);
  filtered.unshift({ udid, ip, port, marketName, lastConnected: Date.now() });
  saveWifiHistory(filtered.slice(0, 20));
}

const DeviceSelector: React.FC = () => {
  const { t } = useTranslation();
  const { devices, currentDevice, setCurrentDevice, connectWifi, fetchDevices } =
    useDeviceStore();
  const homeCache = useDeviceStore((s) => s.homeCache);
  const [isOpen, setIsOpen] = useState(false);
  const [showWifiDialog, setShowWifiDialog] = useState(false);
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("36868");
  const [connecting, setConnecting] = useState(false);
  const [connectedTip, setConnectedTip] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [wifiHistory, setWifiHistory] = useState<WifiHistoryItem[]>(getWifiHistory);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentDeviceData = devices.find((d) => d.serial === currentDevice);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleWifiConnect = useCallback(async () => {
    if (!ip.trim()) return;
    setConnecting(true);
    setConnectError("");
    try {
      await connectWifi(ip.trim(), port.trim() || "36868");

      // 用获取 UDID 来验证连接是否真正成功
      const targetIp = ip.trim();
      const state = useDeviceStore.getState();
      // 重新 fetchDevices 获取最新列表
      await state.fetchDevices();
      const freshState = useDeviceStore.getState();
      // 找到包含目标 IP 的设备
      const targetDev = freshState.devices.find((d) => d.serial.includes(targetIp));
      const serial = targetDev?.serial || "";
      if (!serial) throw new Error("NO_UDID");

      let udid = "";
      let mName = "";

      // 尝试从 homeCache 获取
      const cache = state.homeCache[serial];
      if (cache?.udid) udid = cache.udid;
      if (cache?.marketName) mName = cache.marketName;

      // 如果 cache 没有 UDID，主动获取
      if (!udid && serial) {
        try {
          const platform = state.devices.find((d) => d.serial === serial)?.platform || "";
          if (platform === "harmonyos") {
            const detailed = await hdcGetDeviceInfo(serial);
            if (detailed?.market_name) mName = detailed.market_name;
            // 获取 baseInfo 提取 UDID
            const { hdcGetBaseInfo } = await import("../api/adb");
            const baseInfo = await hdcGetBaseInfo(serial);
            const udidMatch = baseInfo.match(/ohos\.boot\.udid=(\S+)/);
            if (udidMatch) udid = udidMatch[1];
          } else {
            // Android: 从 getprop ro.serialno 获取
            const { getAndroidBaseInfo } = await import("../api/adb");
            const baseInfo = await getAndroidBaseInfo(serial);
            const serialMatch = baseInfo.match(/SERIAL=(\S+)/);
            if (serialMatch) udid = serialMatch[1];
            const marketMatch = baseInfo.match(/MARKET_NAME=(\S+)/);
            if (marketMatch && marketMatch[1] !== "") mName = marketMatch[1];
          }
        } catch {}
      }

      // 拿不到 UDID = 连接失败
      if (!udid) throw new Error("NO_UDID");

      // 去掉 brand 前缀
      const dev = state.devices.find((d) => d.serial === serial);
      const brand = dev?.brand || cache?.brand || "";
      if (brand && mName.startsWith(brand + " ")) {
        mName = mName.slice(brand.length + 1);
      }
      if (!mName) mName = (dev as any)?.market_name || dev?.model || "";

      addToWifiHistory(ip.trim(), port.trim() || "36868", udid, mName);
      setWifiHistory(getWifiHistory());
      setConnectedTip(true);
      setTimeout(() => {
        setShowWifiDialog(false);
        setConnectedTip(false);
      }, 2000);
      setIp("");
      setPort("36868");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      // 内部标识符走 i18n，后端返回的具体错误直接显示
      if (!msg || msg === "WIFI_CONNECT_FAILED" || msg === "NO_DEVICE" || msg === "NO_UDID") {
        setConnectError(t("device.connectFailed"));
      } else {
        setConnectError(msg);
      }
    } finally {
      setConnecting(false);
    }
  }, [ip, port, connectWifi]);

  const handleSelectHistory = useCallback((item: WifiHistoryItem) => {
    setIp(item.ip);
    setPort(item.port);
  }, []);

  const handleDeleteHistory = useCallback((e: React.MouseEvent, item: WifiHistoryItem) => {
    e.stopPropagation();
    const filtered = getWifiHistory().filter((h) => h.udid !== item.udid);
    saveWifiHistory(filtered);
    setWifiHistory(filtered);
  }, []);

  return (
    <>
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-800 hover:bg-dark-700 border border-dark-600 transition-colors min-w-[200px]"
        >
          <span
            className={`w-2 h-2 rounded-full ${
              currentDeviceData?.status === "device" || currentDeviceData?.status === "Connected" || currentDeviceData?.status === "Ready"
                ? "bg-green-400"
                : currentDeviceData
                  ? "bg-red-400"
                  : "bg-dark-500"
            }`}
          />
          <span className="text-sm text-dark-200 truncate flex-1 text-left">
            {currentDeviceData && (currentDeviceData.status === "device" || currentDeviceData.status === "Connected" || currentDeviceData.status === "Ready")
              ? `${homeCache[currentDevice!]?.marketName || (currentDeviceData as any).market_name || `${currentDeviceData.brand || ""} ${currentDeviceData.model || ""}`.trim() || currentDeviceData.serial}`
              : t("device.noDevice")}
          </span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-dark-400"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-72 bg-dark-800 border border-dark-600 rounded-lg shadow-xl z-50 animate-fade-in overflow-hidden">
            {devices.length === 0 ? (
              <div className="p-4 text-center text-dark-400 text-sm">
                {t("device.noDevice")}
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto">
                {devices.map((device) => (
                  <button
                    key={device.serial}
                    onClick={() => {
                      setCurrentDevice(device.serial);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-dark-700 transition-colors ${
                      currentDevice === device.serial
                        ? "bg-accent-500/10 text-accent-400"
                        : "text-dark-200"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        device.status === "device" || device.status === "Connected" || device.status === "Ready"
                          ? "bg-green-400"
                          : device.status === "offline"
                            ? "bg-red-400"
                            : "bg-yellow-400"
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {homeCache[device.serial]?.marketName || (device as any).market_name || `${device.brand || ""} ${device.model || ""}`.trim() || device.serial}
                      </div>
                      <div className="text-xs text-dark-400 truncate">
                        {device.serial}
                      </div>
                    </div>
                    {device.status !== "device" && device.status !== "Connected" && device.status !== "Ready" && (
                      <span className={`text-xs flex-shrink-0 px-1.5 py-0.5 rounded ${
                        device.status === "offline"
                          ? "bg-red-500/10 text-red-400"
                          : "bg-yellow-500/10 text-yellow-400"
                      }`}>
                        {device.status === "offline" && t(`device.offline`)}
                        {device.status === "unauthorized" && t(`device.unauthorized`)}
                        {device.status === "recovery" && t(`device.recovery`)}
                        {device.status !== "device" && device.status !== "offline" && device.status !== "unauthorized" && device.status !== "recovery" && device.status}
                      </span>
                    )}
                    {device.battery_level !== null && device.status === "device" && (
                      <span className="text-xs text-dark-400 flex-shrink-0">
                        {device.battery_level}%
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="border-t border-dark-600">
              <button
                onClick={() => {
                  setWifiHistory(getWifiHistory());
                  setShowWifiDialog(true);
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-accent-400 hover:bg-dark-700 transition-colors text-sm"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                  <path d="M1.42 9a16 16 0 0 1 21.16 0" />
                  <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                  <line x1="12" y1="20" x2="12.01" y2="20" />
                </svg>
                {t("device.wifiConnect")}
              </button>
            </div>
          </div>
        )}
      </div>

      {showWifiDialog && createPortal(
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999] animate-fade-in overflow-auto p-4">
          <div className="bg-dark-800 border border-dark-600 rounded-xl shadow-2xl animate-slide-in my-auto flex overflow-hidden" style={{ width: "560px", maxWidth: "calc(100vw - 2rem)" }}>
            {/* 左侧：历史记录 */}
            <div className="w-48 border-r border-dark-700 flex flex-col shrink-0 bg-dark-850">
              <div className="px-3 py-2.5 text-xs text-dark-400 font-medium border-b border-dark-700">
                {t("device.wifiHistory")}
              </div>
              <div className="flex-1 overflow-y-auto">
                {wifiHistory.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-dark-500">
                    {t("device.noHistory")}
                  </div>
                ) : (
                  wifiHistory.map((item) => (
                    <button
                      key={item.udid || `${item.ip}:${item.port}`}
                      onClick={() => handleSelectHistory(item)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-dark-700 transition-colors group ${
                        ip === item.ip && port === item.port ? "bg-accent-500/10" : ""
                      }`}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-dark-500 shrink-0">
                        <path d="M5 12.55a11 11 0 0 1 14.08 0" />
                        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                        <line x1="12" y1="20" x2="12.01" y2="20" />
                      </svg>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-dark-200 truncate">{item.marketName || item.ip}</div>
                        <div className="text-[10px] text-dark-500">{item.ip}:{item.port}</div>
                      </div>
                      <div
                      onClick={(e) => handleDeleteHistory(e, item)}
                      className="opacity-0 group-hover:opacity-100 text-dark-500 hover:text-red-400 transition-all p-0.5 cursor-pointer"
                      title={t("common.delete")}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </div>
                    </button>
                  ))
                )}
              </div>
            </div>
            {/* 右侧：连接表单 */}
            <div className="flex-1 p-6">
              {connectedTip ? (
                <div className="flex flex-col items-center justify-center h-full gap-3">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-green-400">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                  <p className="text-sm text-green-400 font-medium">{t("device.connectedSuccess")}</p>
                  <p className="text-xs text-dark-400 text-center">{t("device.staticIpTip")}</p>
                </div>
              ) : (
                <>
                  <h3 className="text-lg font-semibold text-dark-100 mb-4">
                    {t("device.wifiConnect")}
                  </h3>
                  <div className="space-y-4">
                <div>
                  <label className="block text-sm text-dark-300 mb-1.5">
                    {t("device.ipAddress")}
                  </label>
                  <input
                    type="text"
                    value={ip}
                    onChange={(e) => setIp(e.target.value)}
                    placeholder="192.168.1.100"
                    className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-dark-100 text-sm placeholder-dark-500 focus:outline-none focus:border-accent-500 transition-colors"
                    onKeyDown={(e) => e.key === "Enter" && handleWifiConnect()}
                  />
                </div>
                <div>
                  <label className="block text-sm text-dark-300 mb-1.5">
                    {t("device.port")}
                  </label>
                  <input
                    type="text"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder="36868"
                    className="w-full px-3 py-2 bg-dark-900 border border-dark-600 rounded-lg text-dark-100 text-sm placeholder-dark-500 focus:outline-none focus:border-accent-500 transition-colors"
                    onKeyDown={(e) => e.key === "Enter" && handleWifiConnect()}
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowWifiDialog(false)}
                  className="flex-1 px-4 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={handleWifiConnect}
                  disabled={!ip.trim() || connecting}
                  className="flex-1 px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                >
                  {connecting ? t("device.connecting") : t("device.connect")}
                </button>
              </div>
              {connectError && (
                <p className="text-xs text-red-400 mt-2 text-center">{connectError}</p>
              )}
                </>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default DeviceSelector;
