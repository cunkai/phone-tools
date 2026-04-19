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

        // 阶段2：批量获取详情（合并为一条命令）
        if (packages.length > 0) {
          // 分批处理，每批最多 50 个包（避免单条命令过长）
          const BATCH_SIZE = 50;
          for (let i = 0; i < packages.length; i += BATCH_SIZE) {
            const batch = packages.slice(i, i + BATCH_SIZE);
            try {
              const details = await adbApi.hdcGetAppsDetailsBatch(serial, batch);
              set((state) => ({
                apps: state.apps.map((a) => {
                  const detail = details.find((d: any) => d.package_name === a.package_name);
                  return detail ? { ...a, ...detail } : a;
                }),
              }));
            } catch {
              // 批量失败不影响已加载的数据
            }
          }
        }
      } else {
        // ===== Android：两阶段加载 =====
        // 阶段1：快速获取包名列表
        const apps = await adbApi.getInstalledApps(serial, true);
        set({ apps, isLoading: false });

        // 阶段2：批量获取详情（合并为一条命令）
        const needDetail = apps.filter((a) => !a.version_name);
        if (needDetail.length > 0) {
          const packages = needDetail.map((a) => a.package_name);
          // 分批处理，每批最多 50 个包
          const BATCH_SIZE = 50;
          for (let i = 0; i < packages.length; i += BATCH_SIZE) {
            const batch = packages.slice(i, i + BATCH_SIZE);
            try {
              const details = await adbApi.getAppsDetailsBatch(serial, batch);
              set((state) => ({
                apps: state.apps.map((a) => {
                  const detail = details.find((d) => d.package_name === a.package_name);
                  return detail ? { ...a, ...detail } : a;
                }),
              }));
            } catch {
              // 批量失败不影响已加载的数据
            }
          }
        }
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to fetch apps",
        isLoading: false,
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

  setSearchQuery: (q: string) => set({ searchQuery: q }),
  setFilterType: (t: "all" | "system" | "third_party") => set({ filterType: t }),
  setSortBy: (s: "name" | "size" | "date") => set({ sortBy: s }),
  setViewMode: (m: "grid" | "list") => set({ viewMode: m }),
  setSelectedApp: (app: InstalledApp | null) => set({ selectedApp: app }),
}));
