import React, { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import DeviceSelector from "./DeviceSelector";
import DeviceNotification from "./DeviceNotification";
import { useDeviceStore } from "../store/deviceStore";
import { useAppStore } from "../store/appStore";
import { useTranslation } from "react-i18next";

const Layout: React.FC = () => {
  const { t } = useTranslation();
  const initDeviceListeners = useDeviceStore((s) => s.initEventListeners);
  const initAppListeners = useAppStore((s) => s.initEventListeners);
  const fetchDevices = useDeviceStore((s) => s.fetchDevices);
  const isReconnecting = useDeviceStore((s) => s.isReconnecting);

  useEffect(() => {
    // 启动时静默获取设备列表，不弹初始化窗口
    fetchDevices().catch(() => {});

    const cleanupDevice = initDeviceListeners();
    const cleanupApp = initAppListeners();
    return () => {
      cleanupDevice();
      cleanupApp();
    };
  }, []);

  return (
    <div className="flex h-screen w-screen bg-dark-950 text-dark-100 overflow-hidden">
      <Sidebar />
      <DeviceNotification />
      <div className="flex flex-col flex-1 min-w-0">
        <header className="flex items-center justify-between px-4 h-12 bg-dark-900/80 border-b border-dark-700/50 backdrop-blur-sm flex-shrink-0">
          <h1 className="text-sm font-semibold text-dark-200">{t("app.title")}</h1>
          <DeviceSelector />
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>

      {/* 设备离线重连弹窗 */}
      {isReconnecting && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-dark-800 border border-dark-700/50 rounded-xl p-6 max-w-sm w-full mx-4 text-center">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-yellow-500/20 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-yellow-400 animate-pulse">
                <path d="M1 1l22 22" />
                <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
                <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
                <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
                <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
                <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
                <line x1="12" y1="20" x2="12.01" y2="20" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-dark-200 mb-2">
              {t("device.reconnecting")}
            </h3>
            <p className="text-xs text-dark-400 mb-4">
              {t("device.reconnectingDesc")}
            </p>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 rounded-full bg-accent-400 animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="w-2 h-2 rounded-full bg-accent-400 animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="w-2 h-2 rounded-full bg-accent-400 animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Layout;
