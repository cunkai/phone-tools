import { create } from "zustand";
import type { InstalledApp } from "../types";
import * as adbApi from "../api/adb";
import { useDeviceStore } from "./deviceStore";

interface AppsStore {
  apps: InstalledApp[];
  isLoading: boolean;
  error: string | null;
  searchQuery: string;
  filterType: "all" | "system" | "third_party";
  sortBy: "name" | "size" | "date";
  viewMode: "grid" | "list";
  selectedApp: InstalledApp | null;
  fetchApps: (serial: string) => Promise<void>;
  fetchAppDetail: (serial: string, packageName: string) => Promise<void>;
  launchApp: (serial: string, pkg: string) => Promise<void>;
  uninstallApp: (serial: string, pkg: string) => Promise<void>;
  clearData: (serial: string, pkg: string) => Promise<void>;
  clearCache: (serial: string, pkg: string) => Promise<void>;
  clearUserData: (serial: string, pkg: string) => Promise<void>;
  setSearchQuery: (q: string) => void;
  setFilterType: (t: "all" | "system" | "third_party") => void;
  setSortBy: (s: "name" | "size" | "date") => void;
  setViewMode: (m: "grid" | "list") => void;
  setSelectedApp: (app: InstalledApp | null) => void;
}

export const useAppsStore = create<AppsStore>((set, get) => ({
  apps: [],
  isLoading: false,
  error: null,
  searchQuery: "",
  filterType: "third_party" as "all" | "system" | "third_party",
  sortBy: "name",
  viewMode: "grid",
  selectedApp: null,

  fetchApps: async (serial: string) => {
    set({ isLoading: true, error: null });
    try {
      const devices = useDeviceStore.getState().devices;
      const platform = devices.find((d) => d.serial === serial)?.platform || "android";

      if (platform === "harmonyos") {
        // ===== 鸿蒙：仅获取包名和应用名称 =====
        const appList = await adbApi.hdcGetAppList(serial);
        const initialApps: InstalledApp[] = appList.map((app) => ({
          package_name: app.bundleName,
          app_name: app.label || app.bundleName.split(".").pop() || app.bundleName,
          version_name: "",
          version_code: "",
          icon_base64: null,
          install_time: "",
          app_size: "",
          is_system: app.bundleName.startsWith("com.huawei"),
        }));
        set({ apps: initialApps, isLoading: false });
      } else {
        // ===== Android：快速获取包名列表 =====
        const apps = await adbApi.getInstalledApps(serial, true);
        set({ apps, isLoading: false });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to fetch apps",
        isLoading: false,
      });
    }
  },

  fetchAppDetail: async (serial: string, packageName: string) => {
    try {
      const devices = useDeviceStore.getState().devices;
      const platform = devices.find((d) => d.serial === serial)?.platform || "android";

      let detail;
      if (platform === "harmonyos") {
        detail = await adbApi.hdcGetAppDetail(serial, packageName);
      } else {
        detail = await adbApi.getAppDetails(serial, packageName);
      }

      // 使用 set 回调中的 state 获取当前应用列表，确保获取到最新状态
      set((state) => {
        const existingApp = state.apps.find((a) => a.package_name === packageName);
        // 确保保留原有的应用名称，即使 API 返回了 app_name 字段
        // 因为列表中的应用名称是从 bm dump -a -l 获取的，包含了正确的应用名称
        const updatedDetail = {
          ...detail,
          app_name: existingApp?.app_name || detail.app_name || detail.package_name
        };
        return {
          apps: state.apps.map((a) => {
            if (a.package_name === packageName) {
              return { ...a, ...updatedDetail };
            }
            return a;
          }),
          selectedApp: updatedDetail,
        };
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to fetch app detail",
      });
    }
  },

  launchApp: async (serial: string, pkg: string) => {
    try {
      const devices = useDeviceStore.getState().devices;
      const platform = devices.find((d) => d.serial === serial)?.platform || "android";
      if (platform === "harmonyos") {
        const app = get().apps.find((a) => a.package_name === pkg);
        await adbApi.hdcStartApp(serial, pkg, app?.main_ability);
      } else {
        await adbApi.startApplication(serial, pkg);
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to launch app",
      });
    }
  },

  uninstallApp: async (serial: string, pkg: string) => {
    try {
      const devices = useDeviceStore.getState().devices;
      const platform = devices.find((d) => d.serial === serial)?.platform || "android";
      if (platform === "harmonyos") {
        await adbApi.hdcUninstallApp(serial, pkg);
      } else {
        await adbApi.uninstallApp(serial, pkg);
      }
      set((state) => ({
        apps: state.apps.filter((a) => a.package_name !== pkg),
        selectedApp: null,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to uninstall app",
      });
    }
  },

  clearData: async (serial: string, pkg: string) => {
    try {
      await adbApi.clearAppData(serial, pkg);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to clear app data",
      });
    }
  },

  clearCache: async (serial: string, pkg: string) => {
    try {
      const devices = useDeviceStore.getState().devices;
      const platform = devices.find((d) => d.serial === serial)?.platform || "android";
      if (platform === "harmonyos") {
        await adbApi.hdcClearCache(serial, pkg);
      } else {
        await adbApi.clearAppData(serial, pkg);
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to clear app cache",
      });
    }
  },

  clearUserData: async (serial: string, pkg: string) => {
    try {
      const devices = useDeviceStore.getState().devices;
      const platform = devices.find((d) => d.serial === serial)?.platform || "android";
      if (platform === "harmonyos") {
        await adbApi.hdcClearData(serial, pkg);
      } else {
        await adbApi.clearAppData(serial, pkg);
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to clear user data",
      });
    }
  },

  setSearchQuery: (q: string) => set({ searchQuery: q }),
  setFilterType: (t: "all" | "system" | "third_party") => set({ filterType: t }),
  setSortBy: (s: "name" | "size" | "date") => set({ sortBy: s }),
  setViewMode: (m: "grid" | "list") => set({ viewMode: m }),
  setSelectedApp: (app: InstalledApp | null) => set({ selectedApp: app }),
}));
