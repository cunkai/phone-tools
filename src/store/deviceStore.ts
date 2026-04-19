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

/** 首页设备详情缓存（per serial） */
interface HomePageCache {
  batteryLevel: number | null;
  totalStorage: string;
  availStorage: string;
  totalMemory: string;
  cpuInfo: string;
  screenRes: string;
  model: string;
  brand: string;
  marketName: string;
  deviceType: string;
  osVersion: string;
  sdkVersion: string;
  securityPatch: string;
  kernelVersion: string;
  incrementalVersion: string;
  abiList: string;
  maxRefreshRate: number;
  screenshot: string | null;
  baseInfo: string;
  udid: string;
  loaded: boolean;
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
  // 首页数据缓存（per serial，切页不丢失）
  homeCache: Record<string, HomePageCache>;
  setHomeCache: (serial: string, data: Partial<HomePageCache>) => void;
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
  homeCache: {},

  setHomeCache: (serial: string, data: Partial<HomePageCache>) => {
    const existing = get().homeCache[serial] || {
      batteryLevel: null, totalStorage: "", availStorage: "",
      totalMemory: "", cpuInfo: "", screenRes: "",
      model: "", brand: "", marketName: "", deviceType: "",
      osVersion: "", sdkVersion: "", securityPatch: "",
      kernelVersion: "", incrementalVersion: "", abiList: "",
      screenshot: null, loaded: false,
    };
    set({ homeCache: { ...get().homeCache, [serial]: { ...existing, ...data } } });
  },

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
      // 第一阶段：快速获取设备列表（并行 ADB + HDC，HDC 不带详情）
      const [adbDevices, hdcDevices] = await Promise.all([
        adbApi.getDevices().catch(() => [] as any[]),
        adbApi.getHdcDevices().catch(() => [] as any[]),
      ]);

      // HDC 设备优先：同一 serial 以 HDC 为准
      const hdcSerials = new Set(hdcDevices.map((d: any) => d.serial));
      const filteredAdb = adbDevices.filter((d: any) => !hdcSerials.has(d.serial));
      const quickDevices = [...filteredAdb, ...hdcDevices];

      // 立即更新设备列表和当前设备（让前端瞬间显示）
      set({ devices: quickDevices as any, isLoading: false });
      const { currentDevice } = get();
      if (!currentDevice && quickDevices.length > 0) {
        set({ currentDevice: quickDevices[0].serial });
      } else if (currentDevice && !quickDevices.find((d: any) => d.serial === currentDevice)) {
        if (quickDevices.length > 0) {
          set({ currentDevice: quickDevices[0].serial });
        }
      }

      // 第二阶段：后台补充 HDC 设备详情（model, brand, cpu 等）
      // 不再调 getAllDevices（会重复查 ADB + HDC 列表），改为只调 hdc_get_device_info
      const hdcDevs = hdcDevices as any[];
      if (hdcDevs.length > 0) {
        const detailedList = await Promise.all(
          hdcDevs.map(async (dev: any) => {
            try {
              const detailed = await adbApi.hdcGetDeviceInfo(dev.serial);
              // 保留 devices() 返回的 status
              detailed.status = dev.status;
              return detailed;
            } catch {
              return dev;
            }
          })
        );
        // 合并：用详情版本替换快速版本
        const detailedSerials = new Set(detailedList.map((d: any) => d.serial));
        const merged = [
          ...quickDevices.filter((d: any) => !detailedSerials.has(d.serial)),
          ...detailedList,
        ];
        set({ devices: merged as any });
      }
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to fetch devices",
        isLoading: false,
      });
    }
  },

  /** 心跳轮询：ADB + HDC 并行查询（都很快，~20-70ms） */
  pollDevices: async () => {
    try {
      const [adbDevices, hdcDevices] = await Promise.all([
        adbApi.getDevices().catch(() => [] as any[]),
        adbApi.getHdcDevices().catch(() => [] as any[]),
      ]);

      const existingDevices = get().devices;
      const existingSerials = new Set(existingDevices.map((d) => d.serial));

      // 合并新发现的设备
      const hdcSerials = new Set(hdcDevices.map((d: any) => d.serial));
      const adbSerials = new Set(adbDevices.map((d: any) => d.serial));
      const filteredAdb = adbDevices.filter((d: any) => !hdcSerials.has(d.serial));

      const newDevices = [...filteredAdb, ...hdcDevices];

      // 更新已有设备的 status，保留详情；添加新设备
      const updatedDevices = existingDevices.map((ed: any) => {
        const newDev = newDevices.find((d: any) => d.serial === ed.serial);
        if (newDev) {
          // 只更新 status，保留其他详情字段
          return { ...ed, status: newDev.status };
        }
        return ed;
      });

      // 添加新发现的设备
      const addedSerials: string[] = [];
      for (const nd of newDevices) {
        if (!existingSerials.has(nd.serial)) {
          updatedDevices.push(nd);
          addedSerials.push(nd.serial);
        }
      }

      // 移除已断开的设备（不在新列表中的）
      const allSerials = new Set(newDevices.map((d: any) => d.serial));
      const finalDevices = updatedDevices.filter((d: any) => allSerials.has(d.serial));

      set({ devices: finalDevices as any });
      const { currentDevice } = get();
      if (currentDevice && !finalDevices.find((d) => d.serial === currentDevice)) {
        if (finalDevices.length > 0) {
          set({ currentDevice: finalDevices[0].serial });
        } else {
          set({ currentDevice: null });
        }
      }

      // 新设备插入：自动选中 + 通知
      if (addedSerials.length > 0) {
        const newDev = finalDevices.find((d: any) => d.serial === addedSerials[0]);
        if (newDev) {
          // 自动选中第一个新设备
          if (!currentDevice) {
            set({ currentDevice: newDev.serial });
          } else {
            // 已有当前设备，显示通知
            set({
              notification: {
                serial: newDev.serial,
                brand: newDev.brand || "",
                model: newDev.model || "",
                platform: newDev.platform || "android",
              },
            });
            // 5秒后自动消失
            setTimeout(() => {
              set({ notification: null });
            }, 5000);
          }
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
      // 先尝试鸿蒙 hdc tconn
      try {
        const { hdcConnectWifi } = await import("../api/adb");
        await hdcConnectWifi(`${ip}:${port}`);
        await get().fetchDevices();
        set({ isLoading: false });
        return;
      } catch {
        // 鸿蒙连接失败，尝试 Android
      }
      await adbApi.connectWifiDevice(ip, parseInt(port, 10) || 5555);
      await get().fetchDevices();
      set({ isLoading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      set({ error: msg, isLoading: false });
      throw new Error(msg || "WIFI_CONNECT_FAILED");
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
          // 5秒后自动消失
          setTimeout(() => {
            set({ notification: null });
          }, 5000);
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
