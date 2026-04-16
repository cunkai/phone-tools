import { create } from "zustand";
import type { ApkInfo } from "../types";
import * as adbApi from "../api/adb";
import { onInstallProgress } from "../api/events";

interface AppStore {
  apkInfo: ApkInfo | null;
  installProgress: number;
  installStatus: "idle" | "installing" | "success" | "error";
  installError: string | null;
  parseApk: (path: string) => Promise<void>;
  installApp: (serial: string, path: string) => Promise<void>;
  resetInstall: () => void;
  initEventListeners: () => () => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  apkInfo: null,
  installProgress: 0,
  installStatus: "idle",
  installError: null,

  parseApk: async (path: string) => {
    set({ installStatus: "idle", installError: null });
    try {
      const info = await adbApi.parseApkInfo(path);
      set({ apkInfo: info });
    } catch (err) {
      set({
        installError: err instanceof Error ? err.message : "Failed to parse APK",
        installStatus: "error",
      });
    }
  },

  installApp: async (serial: string, path: string) => {
    set({ installStatus: "installing", installProgress: 0, installError: null });
    try {
      await adbApi.installApp(serial, path);
      set({ installStatus: "success", installProgress: 100 });
    } catch (err) {
      set({
        installError: err instanceof Error ? err.message : "Install failed",
        installStatus: "error",
      });
    }
  },

  resetInstall: () => {
    set({
      apkInfo: null,
      installProgress: 0,
      installStatus: "idle",
      installError: null,
    });
  },

  initEventListeners: () => {
    let unlisten: (() => void) | null = null;

    onInstallProgress((event) => {
      set({ installProgress: event.progress });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  },
}));
