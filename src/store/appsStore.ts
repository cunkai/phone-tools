import { create } from "zustand";
import type { InstalledApp } from "../types";
import * as adbApi from "../api/adb";
import { useDeviceStore } from "./deviceStore";

// 鸿蒙详情加载队列
let detailQueue: string[] = [];
let activeLoaders = 0;
const MAX_CONCURRENT_LOADERS = 3;

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
  prioritizeApp: (packageName: string) => void;
  launchApp: (serial: string, pkg: string) => Promise<void>;
  uninstallApp: (serial: string, pkg: string) => Promise<void>;
  clearData: (serial: string, pkg: string) => Promise<void>;
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
    // 取消之前的加载
    detailQueue = [];
    activeLoaders = 0;
    set({ isLoading: true, error: null });
    try {
      const devices = useDeviceStore.getState().devices;
      const platform = devices.find((d) => d.serial === serial)?.platform || "android";

      if (platform === "harmonyos") {
        // ===== 鸿蒙：两阶段加载 =====
        // 阶段1：快速获取包名列表
        const packages = await adbApi.hdcGetAppList(serial);
        const initialApps: InstalledApp[] = packages.map((pkg) => ({
          package_name: pkg,
          app_name: pkg.split(".").pop() || pkg,
          version_name: "",
          version_code: "",
          icon_base64: null,
          install_time: "",
          app_size: "",
          is_system: false,
        }));
        set({ apps: initialApps, isLoading: false });

        // 阶段2：后台逐个加载详情
        detailQueue = [...packages];
        const loadNext = async () => {
          if (detailQueue.length === 0) {
            activeLoaders--;
            return;
          }
          const pkg = detailQueue.shift()!;
          try {
            const detail = await adbApi.hdcGetAppDetail(serial, pkg);
            set((state) => ({
              apps: state.apps.map((a) =>
                a.package_name === pkg ? { ...a, ...detail } : a
              ),
            }));
          } catch {
            // 单个失败不影响其他
          }
          loadNext();
        };
        // 启动 3 个并发加载器
        activeLoaders = MAX_CONCURRENT_LOADERS;
        for (let i = 0; i < MAX_CONCURRENT_LOADERS; i++) {
          loadNext();
        }
      } else {
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

  /** 将指定应用移到加载队列前面（用户点击时调用） */
  prioritizeApp: (packageName: string) => {
    const idx = detailQueue.indexOf(packageName);
    if (idx > 0) {
      detailQueue.splice(idx, 1);
      detailQueue.unshift(packageName);
    }
  },

  launchApp: async (serial: string, pkg: string) => {
    try {
      const devices = useDeviceStore.getState().devices;
      const platform = devices.find((d) => d.serial === serial)?.platform || "android";
      if (platform === "harmonyos") {
        await adbApi.hdcStartApp(serial, pkg);
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
      // 从队列中移除
      detailQueue = detailQueue.filter((p) => p !== pkg);
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

  setSearchQuery: (q: string) => set({ searchQuery: q }),
  setFilterType: (t: "all" | "system" | "third_party") => set({ filterType: t }),
  setSortBy: (s: "name" | "size" | "date") => set({ sortBy: s }),
  setViewMode: (m: "grid" | "list") => set({ viewMode: m }),
  setSelectedApp: (app: InstalledApp | null) => set({ selectedApp: app }),
}));
