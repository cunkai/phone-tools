import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useDeviceStore } from "../store/deviceStore";

const DeviceSelector: React.FC = () => {
  const { t } = useTranslation();
  const { devices, currentDevice, setCurrentDevice, connectWifi, fetchDevices } =
    useDeviceStore();
  const [isOpen, setIsOpen] = useState(false);
  const [showWifiDialog, setShowWifiDialog] = useState(false);
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("5555");
  const [connecting, setConnecting] = useState(false);
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
    try {
      await connectWifi(ip.trim(), port.trim() || "5555");
      setShowWifiDialog(false);
      setIp("");
      setPort("5555");
    } catch {
      // error handled in store
    } finally {
      setConnecting(false);
    }
  }, [ip, port, connectWifi]);

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
              ? `${currentDeviceData.brand || ""} ${currentDeviceData.model || ""}`.trim() || currentDeviceData.serial
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
                        {device.brand} {device.model}
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

      {showWifiDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] animate-fade-in">
          <div className="bg-dark-800 border border-dark-600 rounded-xl p-6 w-96 shadow-2xl animate-slide-in">
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
                  placeholder="5555"
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
          </div>
        </div>
      )}
    </>
  );
};

export default DeviceSelector;
