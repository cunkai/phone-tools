import React from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { useDeviceStore } from "../store/deviceStore";

interface SidebarProps {
  className?: string;
}

// 每个导航项支持的平台，空数组表示所有平台都支持
interface NavItem {
  path: string;
  icon: React.ReactNode;
  labelKey: string;
  platforms?: string[]; // 支持的平台列表，如 ["android"]，空=全部
}

const navItems: NavItem[] = [
  {
    path: "/",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <polyline points="9 22 9 12 15 12 15 22" />
      </svg>
    ),
    labelKey: "nav.home",
  },
  {
    path: "/install",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
    labelKey: "nav.install",
  },
  {
    path: "/apps",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
    labelKey: "nav.apps",
  },
  {
    path: "/tools",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    labelKey: "nav.tools",
  },
  {
    path: "/monitor",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
    labelKey: "nav.deviceInfo",
  },
  {
    path: "/control",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="2" />
        <line x1="6" y1="18" x2="6" y2="22" />
        <line x1="18" y1="18" x2="18" y2="22" />
        <line x1="8" y1="22" x2="16" y2="22" />
      </svg>
    ),
    labelKey: "nav.control",
    platforms: ["android"], // 设备控制仅 Android 支持
  },
  {
    path: "/fps",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20V10" />
        <path d="M18 20V4" />
        <path d="M6 20v-4" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    ),
    labelKey: "nav.fpsMonitor",
    platforms: ["android"], // FPS 监控仅 Android 支持
  },
  {
    path: "/terminal",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
    labelKey: "nav.terminal",
  },
  {
    path: "/automation",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
    labelKey: "nav.automation",
  },
  {
    path: "/settings",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
    labelKey: "nav.settings",
  },
];

const Sidebar: React.FC<SidebarProps> = ({ className = "" }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const currentDevice = useDeviceStore((s) => s.currentDevice);
  const devices = useDeviceStore((s) => s.devices);

  // 获取当前设备平台
  const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";

  // 根据平台过滤导航项
  const visibleNavItems = navItems.filter((item) => {
    if (!item.platforms || item.platforms.length === 0) return true;
    return item.platforms.includes(currentPlatform);
  });

  const isActive = (path: string) => {
    if (path === "/") return location.pathname === "/";
    return location.pathname === path || location.pathname.startsWith(path + "/");
  };

  return (
    <nav
      className={`flex flex-col items-center w-[60px] h-full bg-dark-900 border-r border-dark-700/50 py-4 ${className}`}
    >
      <div className="mb-6 flex items-center justify-center w-10 h-10 rounded-xl bg-accent-500 text-white font-bold text-lg">
        A
      </div>

      <div className="flex flex-col gap-1 flex-1">
        {visibleNavItems.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            title={t(item.labelKey)}
            className={`group relative flex items-center justify-center w-10 h-10 rounded-lg transition-all duration-200 ${
              isActive(item.path)
                ? "bg-accent-500/20 text-accent-400"
                : "text-dark-400 hover:text-dark-200 hover:bg-dark-800"
            }`}
          >
            {item.icon}
            {isActive(item.path) && (
              <div className="absolute left-0 w-0.5 h-5 bg-accent-500 rounded-r-full" />
            )}
            <span className="absolute left-full ml-3 px-2 py-1 text-xs rounded-md bg-dark-700 text-dark-200 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
              {t(item.labelKey)}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
};

export default Sidebar;
