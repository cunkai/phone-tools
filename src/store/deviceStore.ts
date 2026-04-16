import { create } from "zustand";
import type { AdbDevice } from "../types";
import * as adbApi from "../api/adb";
import { onDeviceConnected, onDeviceDisconnected } from "../api/events";

interface DeviceStaticInfo {
  cpuArch: string;
  screenResolution: string;
  model: string;
  brand: string;
  androidVersion: string;
  sdkVersion: string;
  deviceType: string;
}

interface DeviceStore {
  devices: AdbDevice[];
  currentDevice: string | null;
  isLoading: boolean;
  error: string | null;
  isReconnecting: boolean;
  adbBusy: boolean;
  // 新设备插入通知
  notification: { serial: string; brand: string; model: string; platform: string } | null;
  dismissNotification: () => void;
  // 设备静态信息缓存（per serial，切换设备不丢失）
  staticInfo: Record<string, DeviceStaticInfo>;
  ensureStaticInfo: (serial: string) => Promise<DeviceStaticInfo>;
  fetchDevices: () => Promise<void>;
  pollDevices: () => Promise<void>;
  setCurrentDevice: (serial: string) => void;
  connectWifi: (ip: string, port: string) => Promise<void>;
  disconnect: (serial: string) => Promise<void>;
  initEventListeners: () => () => void;
  reconnect: () => Promise<void>;
  setAdbBusy: (busy: boolean) => void;
}

export const useDeviceStore = create<DeviceStore>((set, get) => ({
  devices: [],
  currentDevice: null,
  isLoading: false,
  error: null,
  isReconnecting: false,
  adbBusy: false,
  notification: null,
  staticInfo: {},

  ensureStaticInfo: async (serial: string) => {
    const { staticInfo, devices } = get();
    // 已缓存则直接返回
    if (staticInfo[serial]) return staticInfo[serial];

    const info: DeviceStaticInfo = {
      cpuArch: "",
      screenResolution: "",
      model: "",
      brand: "",
      androidVersion: "",
      sdkVersion: "",
      deviceType: "",
    };

    // 从 devices 列表获取基本信息
    const device = devices.find((d) => d.serial === serial);
    if (device) {
      info.model = device.model;
      info.brand = device.brand;
      info.androidVersion = device.android_version;
      info.sdkVersion = device.sdk_version;
      info.deviceType = device.device_type;
    }

    // 根据设备平台选择对应 API
    const platform = device?.platform || "android";
    if (platform === "harmonyos") {
      // 鸿蒙设备：通过 hdc_get_device_info 获取完整信息
      try {
        const hdcInfo: any = await adbApi.hdcGetDeviceInfo(serial);
        if (hdcInfo) {
          info.model = hdcInfo.model || info.model;
          info.brand = hdcInfo.brand || info.brand;
          info.cpuArch = hdcInfo.cpu_info || "";
          info.screenResolution = hdcInfo.screen_resolution || "";
          info.androidVersion = hdcInfo.android_version || "";
          info.deviceType = hdcInfo.device_type || info.deviceType;
        }
      } catch {}
    } else {
      // Android 设备：用 ADB 获取 CPU 和分辨率
      const cpuArch = await adbApi.getCpuArchitecture(serial).catch(() => "");
      info.cpuArch = cpuArch;

      const resolution = await adbApi.getScreenResolution(serial).catch(() => "");
      info.screenResolution = resolution;
    }

    // 存入缓存
    set({ staticInfo: { ...get().staticInfo, [serial]: info } });
    return info;
  },

  fetchDevices: async () => {
    set({ isLoading: true, error: null });
    try {
      const devices = await adbApi.getAllDevices();
      set({ devices, isLoading: false });
      const { currentDevice } = get();
      if (currentDevice && !devices.find((d) => d.serial === currentDevice)) {
        if (devices.length > 0) {
          set({ currentDevice: devices[0].serial });
        } else {
          set({ currentDevice: null });
        }
      } else if (!currentDevice && devices.length > 0) {
        set({ currentDevice: devices[0].serial });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to fetch devices",
        isLoading: false,
      });
      // 只有在没有鸿蒙设备在线时才触发 ADB 重连
      const hasHarmonyDevice = get().devices.some((d) => d.platform === "harmonyos" && (d.status === "Connected" || d.status === "Ready"));
      if (!hasHarmonyDevice) {
        get().reconnect();
      }
    }
  },

  /** 心跳轮询：仅查询 ADB 设备（轻量），不查 HDC */
  pollDevices: async () => {
    try {
      const devices = await adbApi.getDevices();
      const hdcDevices = get().devices.filter((d) => d.platform === "harmonyos");
      const allDevices = [...devices, ...hdcDevices];
      set({ devices: allDevices });
      const { currentDevice } = get();
      if (currentDevice && !allDevices.find((d) => d.serial === currentDevice)) {
        if (allDevices.length > 0) {
          set({ currentDevice: allDevices[0].serial });
        } else {
          set({ currentDevice: null });
        }
      }
    } catch {
      // 心跳失败静默忽略
    }
  },

  setCurrentDevice: (serial: string) => {
    const { devices } = get();
    const device = devices.find((d) => d.serial === serial);
    set({ currentDevice: serial, notification: null }); // 切换设备时清除通知
    // 如果选中的设备是 offline/unauthorized，触发重连
    // 鸿蒙设备状态为 "Connected"，不需要重连
    const needsReconnect = device && device.status !== "device" && device.status !== "Connected" && device.status !== "Ready";
    if (needsReconnect) {
      get().reconnect();
    }
  },

  connectWifi: async (ip: string, port: string) => {
    set({ isLoading: true, error: null });
    try {
      await adbApi.connectWifiDevice(ip, parseInt(port, 10) || 5555);
      await get().fetchDevices();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to connect",
        isLoading: false,
      });
    }
  },

  disconnect: async (serial: string) => {
    try {
      await adbApi.disconnectDevice(serial);
      await get().fetchDevices();
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to disconnect",
      });
    }
  },

  dismissNotification: () => set({ notification: null }),

  reconnect: async () => {
    const { isReconnecting, currentDevice, devices } = get();
    if (isReconnecting) return; // 防止重复重连

    // 如果当前设备是鸿蒙设备，不触发 ADB 重连
    const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";
    if (currentPlatform === "harmonyos") {
      console.log("[reconnect] HarmonyOS device, skipping ADB reconnect");
      return;
    }

    set({ isReconnecting: true });
    console.log("[reconnect] Device offline, restarting ADB server...");

    try {
      await adbApi.resetAdb();
      console.log("[reconnect] ADB server restarted, fetching devices...");
      // 多次轮询等待设备重新上线（最多等 10 秒）
      for (let i = 0; i < 5; i++) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await get().fetchDevices();
        const { devices: updatedDevices, currentDevice: updatedCurrent } = get();
        // 如果有设备上线了（兼容 Android "device" 和 HarmonyOS "Connected"），停止轮询
        if (updatedDevices.some((d) => d.status === "device" || d.status === "Connected" || d.status === "Ready")) {
          if (updatedCurrent && updatedDevices.some((d) => d.serial === updatedCurrent && (d.status === "device" || d.status === "Connected" || d.status === "Ready"))) {
            console.log("[reconnect] Device back online:", updatedCurrent);
          }
          break;
        }
      }
      console.log("[reconnect] Reconnect done");
    } catch (err) {
      console.error("[reconnect] Failed:", err);
    } finally {
      set({ isReconnecting: false });
    }
  },

  setAdbBusy: (busy: boolean) => {
    set({ adbBusy: busy });
  },

  initEventListeners: () => {
    const unlisteners: (() => void)[] = [];

    onDeviceConnected(() => {
      // 先刷新设备列表
      get().fetchDevices().then(() => {
        const { devices, currentDevice } = get();
        const newDevices = devices.filter((d) => d.serial !== currentDevice);
        if (newDevices.length > 0) {
          const newDevice = newDevices[0];
          // 如果当前没有选中设备，自动切换到新设备
          if (!currentDevice) {
            get().setCurrentDevice(newDevice.serial);
            return; // setCurrentDevice 内部已清除通知
          }
          // 显示通知
          set({
            notification: {
              serial: newDevice.serial,
              brand: newDevice.brand || "",
              model: newDevice.model || "",
              platform: newDevice.platform || "android",
            },
          });
          // 3秒后自动消失
          setTimeout(() => {
            set({ notification: null });
          }, 3000);
        }
      });
    }).then((unlisten) => unlisteners.push(unlisten));

    onDeviceDisconnected(() => {
      get().fetchDevices();
    }).then((unlisten) => unlisteners.push(unlisten));

    // ADB 状态管理器：空闲时定期刷新设备列表，忙碌时暂停
    // 空闲：每 5 秒刷新（仅查 ADB，不查 HDC，避免无谓开销）
    // 忙碌：不刷新（避免干扰截图流等任务）
    const heartbeat = setInterval(() => {
      const { isReconnecting, adbBusy } = get();
      if (!isReconnecting && !adbBusy) {
        get().pollDevices();
      }
    }, 5000);

    return () => {
      unlisteners.forEach((fn) => fn());
      clearInterval(heartbeat);
    };
  },
}));
