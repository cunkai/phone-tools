// 扩展Window接口
declare global {
  interface Window {
    openAppGallery: (appName: string) => void;
  }
}

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeviceStore } from "../store/deviceStore";
import {
  getPerformanceInfo,
  getTopMemoryApps,
  setScreenResolution,
  reboot,
  rebootRecovery,
  rebootBootloader,
  hdcGetPerformanceInfo,
  hdcGetCpuUsage,
  hdcGetMemoryInfo,
  hdcGetBatteryInfo,
  hdcGetStorageInfo,
  hdcReboot,
  hdcRebootRecovery,
  hdcRebootBootloader,
  hdcShutdown,
  hdcShell,
} from "../api/adb";
import type { PerformanceInfo, TopMemoryApp, HdcPerformanceInfo, HdcMemoryInfo, HdcBatteryInfo, HdcStorageInfo } from "../types";
import { open } from "@tauri-apps/plugin-shell";
import LoadingSpinner from "../components/LoadingSpinner";
import PanelRefreshButton from "../components/PanelRefreshButton";
import RawDataDialog from "../components/RawDataDialog";

// 翻译映射表
const translationMap: Record<string, string> = {
  "WifiDevice": "WiFi 设备",
  "WifiHotspot": "WiFi 热点",
  "WifiP2p": "WiFi P2P",
  "WifiScan": "WiFi 扫描",
  "NetConnManager": "网络连接管理",
  "NetPolicyManager": "网络策略管理",
  "NetStatsManager": "网络统计管理",
  "NetTetheringManager": "网络共享管理",
  "NetsysNative": "网络系统",
  "AVCodecService": "音视频编解码服务",
  "MediaKeySystemService": "媒体密钥系统服务",
  "TelephonyCoreService": "电话核心服务",
  "AppDomainVerifyManager": "应用域验证管理",
  
  "WiFi active state": "状态",
  "WiFi connection status": "连接状态",
  "Connection.ssid": "网络名称",
  "Connection.bssid": "接入点地址",
  "Connection.rssi": "信号强度",
  "Connection.band": "频段",
  "Connection.frequency": "频率",
  "Connection.linkSpeed": "连接速度",
  "Connection.macAddress": "MAC 地址",
  "Connection.isHiddenSSID": "隐藏网络",
  "Connection.signalLevel": "信号等级",
  "Country Code": "国家代码",
  
  "WiFi hotspot active state": "热点状态",
  
  "P2P enable status": "P2P 状态",
  
  "Is scan service running": "扫描服务",
  
  "Net connect Info": "网络连接信息",
  "SupplierId": "供应商 ID",
  "NetId": "网络 ID",
  "ConnStat": "连接状态",
  "IsAvailable": "是否可用",
  "IsRoaming": "是否漫游",
  "Strength": "信号强度",
  "LinkUpBandwidthKbps": "上行带宽",
  "LinkDownBandwidthKbps": "下行带宽",
  "Uid": "用户 ID",
  "Dns result Info": "DNS 结果信息",
  "netId": "网络 ID",
  "totalReports": "报告总数",
  "failReports": "失败报告",
  
  "UidPolicy": "用户 ID 策略",
  "DeviceIdleAllowedList": "设备空闲允许列表",
  "DeviceIdleMode": "设备空闲模式",
  "PowerSaveAllowedList": "省电允许列表",
  "PowerSaveMode": "省电模式",
  "BackgroundPolicy": "后台策略",
  "MeteredIfaces": "计费接口",
  "QuotaPolicies": "配额策略",
  
  "Net Stats Info": "网络统计信息",
  "RxBytes": "接收字节",
  "TxBytes": "发送字节",
  "RxPackets": "接收数据包",
  "TxPackets": "发送数据包",
  "wlan0-TxBytes": "WLAN 发送字节",
  "wlan0-RxBytes": "WLAN 接收字节",
  
  "Net Sharing Info": "网络共享信息",
  "Is Sharing Supported": "共享支持",
  "Sharing State": "共享状态",
  "Usb Regexs": "USB 正则",
  "Wifi Regexs": "WiFi 正则",
  "Bluetooth Regexs": "蓝牙正则",
  
  "Netsys connect manager": "网络系统连接管理",
  "default NetId": "默认网络 ID",
  "interfaces": "接口",
  "TimeoutMsec": "超时时间",
  "RetryCount": "重试次数",
  "Servers": "服务器",
  "Domains": "域名",
  
  "Codec_Server": "编解码服务器",
  "Instance_0_Info": "实例信息",
  "CallerPid": "调用者进程 ID",
  "CallerProcessName": "调用者进程名",
  "InstanceId": "实例 ID",
  "Status": "状态",
  "LastError": "最后错误",
  "CodecName": "编解码器名称",
  "Width": "宽度",
  "Height": "高度",
  "FrameRate": "帧率",
  "PixelFormat": "像素格式",
  
  "MediaKeySystem MemoryUsage": "媒体密钥系统内存使用",
  "Plugin Name": "插件名称",
  "Plugin UUID": "插件 UUID",
  "Total MediaKeySystem Num": "媒体密钥系统总数",
  
  "Ohos core_service service": "鸿蒙核心服务",
  "BindTime": "绑定时间",
  "EndTime": "结束时间",
  "SpendTime": "耗时",
  "SlotId": "卡槽 ID",
  "IsSimActive": "SIM 激活",

  "SignalLevel": "信号等级",
  "CardType": "卡类型",
  "SimState": "SIM 状态",
  "Spn": "运营商简称",
  "OperatorName": "运营商名称",
  "PsRadioTech": "PS 无线技术",
  "CsRadioTech": "CS 无线技术",
  
  "appIdentifier": "应用标识符",
  "domain verify status": "域验证状态",
  
  "activated": "已激活",
  "connected": "已连接",
  "disconnected": "已断开",
  "inactive": "未激活",
  "enable": "已启用",
  "true": "是",
  "false": "否"
};

const DeviceInfoPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentDevice, staticInfo, ensureStaticInfo, devices } = useDeviceStore();

  // 判断当前设备平台
  const currentDeviceData = devices.find((d) => d.serial === currentDevice);
  const isHarmonyOS = (currentDeviceData as any)?.platform === "harmonyos";

  // Android 性能信息（一次性获取）
  const [perfInfo, setPerfInfo] = useState<PerformanceInfo | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);

  // 鸿蒙独立面板状态
  const [cpuUsage, setCpuUsage] = useState<number>(0);
  const [cpuLoading, setCpuLoading] = useState(false);
  const [cpuRaw, setCpuRaw] = useState<string>("");
  const [memoryInfo, setMemoryInfo] = useState<HdcMemoryInfo | null>(null);
  const [memLoading, setMemLoading] = useState(false);
  const [batteryInfo, setBatteryInfo] = useState<HdcBatteryInfo | null>(null);
  const [batteryLoading, setBatteryLoading] = useState(false);
  const [storageInfo, setStorageInfo] = useState<HdcStorageInfo | null>(null);
  const [storageLoading, setStorageLoading] = useState(false);
  // Hidumper 各部分数据
  const [hidumperSections, setHidumperSections] = useState<Record<string, { data: string; loading: boolean }>>({});

  // 需要展示的部分，拆分成小面板
  const sectionConfigs = [
    { name: "WifiDevice", sections: ["WifiDevice", "WifiHotspot", "WifiP2p", "WifiScan"], title: "WiFi 设备" },
    { name: "NetConnManager", sections: ["NetConnManager"], title: "网络连接管理" },
    { name: "NetStatsManager", sections: ["NetStatsManager"], title: "网络统计管理" },
    { name: "NetTetheringManager", sections: ["NetTetheringManager"], title: "网络共享管理" },
    { name: "NetsysNative", sections: ["NetsysNative"], title: "网络系统" },
    { name: "AVCodecService", sections: ["AVCodecService"], title: "音视频编解码服务" },
    { name: "MediaKeySystemService", sections: ["MediaKeySystemService"], title: "媒体密钥系统服务" },
    { name: "TelephonyCoreService", sections: ["TelephonyCoreService"], title: "电话核心服务" }
  ];

  // TOP 内存应用
  const [topMemoryApps, setTopMemoryApps] = useState<TopMemoryApp[]>([]);
  const [topMemLoading, setTopMemLoading] = useState(false);

  // 当前设备的静态信息
  const cachedInfo = currentDevice ? staticInfo[currentDevice] : null;

  // Overall refresh state
  const [refreshing, setRefreshing] = useState(false);

  // Resolution dialog state
  const [showResDialog, setShowResDialog] = useState(false);
  const [resWidth, setResWidth] = useState("1080");
  const [resHeight, setResHeight] = useState("2400");
  const [resDensity, setResDensity] = useState("440");

  // Confirm dialog state
  const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
  const [confirmMessage, setConfirmMessage] = useState("");

  // Raw data dialog state
  const [rawDialogOpen, setRawDialogOpen] = useState(false);
  const [rawDialogTitle, setRawDialogTitle] = useState("");
  const [rawDialogData, setRawDialogData] = useState("");

  // ===== 独立面板刷新函数 =====

  const showRawData = useCallback((title: string, data: string) => {
    setRawDialogTitle(title);
    setRawDialogData(data);
    setRawDialogOpen(true);
  }, []);

  // CPU 面板刷新
  const loadCpu = useCallback(() => {
    if (!currentDevice) return;
    if (isHarmonyOS) {
      setCpuLoading(true);
      hdcGetCpuUsage(currentDevice)
        .then((res) => { setCpuUsage(res.usage); setCpuRaw(res.raw); })
        .catch(() => {})
        .finally(() => setCpuLoading(false));
    } else {
      setPerfLoading(true);
      getPerformanceInfo(currentDevice)
        .then(setPerfInfo)
        .catch(() => {})
        .finally(() => setPerfLoading(false));
    }
  }, [currentDevice, isHarmonyOS]);

  // 内存面板刷新
  const loadMemory = useCallback(() => {
    if (!currentDevice) return;
    if (isHarmonyOS) {
      setMemLoading(true);
      hdcGetMemoryInfo(currentDevice)
        .then(setMemoryInfo)
        .catch(() => {})
        .finally(() => setMemLoading(false));
    } else {
      setPerfLoading(true);
      getPerformanceInfo(currentDevice)
        .then(setPerfInfo)
        .catch(() => {})
        .finally(() => setPerfLoading(false));
    }
  }, [currentDevice, isHarmonyOS]);

  // 电池面板刷新
  const loadBattery = useCallback(() => {
    if (!currentDevice) return;
    if (isHarmonyOS) {
      setBatteryLoading(true);
      hdcGetBatteryInfo(currentDevice)
        .then(setBatteryInfo)
        .catch(() => {})
        .finally(() => setBatteryLoading(false));
    } else {
      setPerfLoading(true);
      getPerformanceInfo(currentDevice)
        .then(setPerfInfo)
        .catch(() => {})
        .finally(() => setPerfLoading(false));
    }
  }, [currentDevice, isHarmonyOS]);

  // 存储面板刷新
  const loadStorage = useCallback(() => {
    if (!currentDevice) return;
    if (isHarmonyOS) {
      setStorageLoading(true);
      hdcGetStorageInfo(currentDevice)
        .then(setStorageInfo)
        .catch(() => {})
        .finally(() => setStorageLoading(false));
    } else {
      setPerfLoading(true);
      getPerformanceInfo(currentDevice)
        .then(setPerfInfo)
        .catch(() => {})
        .finally(() => setPerfLoading(false));
    }
  }, [currentDevice, isHarmonyOS]);

  // 环境变量数据状态
  const [environmentVariablesData, setEnvironmentVariablesData] = useState<string>("");
  const [environmentVariablesLoading, setEnvironmentVariablesLoading] = useState(false);

  // 加载所有 Hidumper 部分（只调用一次命令）
  const loadAllHidumperSections = useCallback(() => {
    if (!currentDevice || !isHarmonyOS) return;
    
    // 收集所有需要的 sections
    const allSections = sectionConfigs.flatMap(config => config.sections);
    const uniqueSections = [...new Set(allSections)];
    
    // 为所有面板设置加载状态
    const newLoadingState: Record<string, { data: string; loading: boolean }> = {};
    sectionConfigs.forEach(config => {
      newLoadingState[config.name] = { 
        data: hidumperSections[config.name]?.data || "", 
        loading: true 
      };
    });
    setHidumperSections(newLoadingState);
    
    // 只调用一次 hidumper 命令获取所有数据
    hdcShell(currentDevice, `hidumper -s ${uniqueSections.join(' ')}`)
      .then(allData => {
        // 将数据分配到各个面板
        const newState: Record<string, { data: string; loading: boolean }> = {};
        
        sectionConfigs.forEach(config => {
          // 提取当前面板相关的数据
          let sectionData = "";
          
          config.sections.forEach(section => {
            // 查找当前 section 的数据块
            const startMarker = `----------------------------------${section}----------------------------------`;
            
            // 查找开始位置
            const startIndex = allData.indexOf(startMarker);
            if (startIndex !== -1) {
              // 查找结束位置（下一个 section 的开始或文件结束）
              let endIndex = allData.length;
              
              // 查找下一个 section 的开始
              const nextSectionStart = allData.indexOf("----------------------------------", startIndex + startMarker.length);
              if (nextSectionStart !== -1) {
                endIndex = nextSectionStart;
              }
              
              // 提取从开始标记到下一个 section 开始的数据
              sectionData += allData.substring(startIndex, endIndex) + '\n';
            }
          });
          
          newState[config.name] = { data: sectionData, loading: false };
        });
        
        setHidumperSections(newState);
      })
      .catch(() => {
        // 加载失败时保持原有数据
        const newState: Record<string, { data: string; loading: boolean }> = {};
        sectionConfigs.forEach(config => {
          newState[config.name] = { 
            data: hidumperSections[config.name]?.data || "", 
            loading: false 
          };
        });
        setHidumperSections(newState);
      });
  }, [currentDevice, isHarmonyOS, sectionConfigs, hidumperSections]);

  // 加载环境变量数据
  const loadEnvironmentVariablesData = useCallback(() => {
    if (!currentDevice || !isHarmonyOS) return;
    setEnvironmentVariablesLoading(true);
    hdcShell(currentDevice, `set | grep "="`)
      .then(data => {
        setEnvironmentVariablesData(data);
        setEnvironmentVariablesLoading(false);
      })
      .catch(() => {
        setEnvironmentVariablesLoading(false);
      });
  }, [currentDevice, isHarmonyOS]);

  // 加载单个 Hidumper 配置（从总数据中提取）
  const loadHidumperConfig = useCallback((config: { name: string; sections: string[] }) => {
    // 直接调用加载所有数据的函数
    loadAllHidumperSections();
  }, [loadAllHidumperSections]);

  // TOP 内存应用刷新（仅 Android）
  const loadTopMemory = useCallback(() => {
    if (!currentDevice || isHarmonyOS) return;
    setTopMemLoading(true);
    getTopMemoryApps(currentDevice)
      .then(setTopMemoryApps)
      .catch(() => {})
      .finally(() => setTopMemLoading(false));
  }, [currentDevice, isHarmonyOS]);

  // 兼容旧代码：loadPerformance 调用所有独立刷新
  const loadPerformance = useCallback(() => {
    loadCpu();
    loadMemory();
    loadBattery();
    loadStorage();
    loadAllHidumperSections();
  }, [loadCpu, loadMemory, loadBattery, loadStorage, loadAllHidumperSections]);

  // Refresh all: 串行加载，每个命令之间留间隔
  const refreshAll = useCallback(async () => {
    if (!currentDevice) return;
    setRefreshing(true);
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

    // 1. 性能信息（CPU/内存/电池/存储）
    if (isHarmonyOS) {
      // 鸿蒙：并行获取所有独立面板数据
      await Promise.all([
                loadCpu(),
                loadMemory(),
                loadBattery(),
                loadStorage(),
                loadAllHidumperSections(),
                loadEnvironmentVariablesData()
              ]);
    } else {
      // Android：一次性获取
      setPerfLoading(true);
      try { const info = await getPerformanceInfo(currentDevice); setPerfInfo(info); } catch {}
      setPerfLoading(false);
    }
    await delay(200);

    // 2. TOP 内存应用（仅 Android）
    if (!isHarmonyOS) {
      setTopMemLoading(true);
      try { const apps = await getTopMemoryApps(currentDevice); setTopMemoryApps(apps); } catch {}
      setTopMemLoading(false);
    }

    // 3. 静态信息（有缓存则跳过）
    await ensureStaticInfo(currentDevice);

    setRefreshing(false);
  }, [currentDevice, ensureStaticInfo, isHarmonyOS, loadAllHidumperSections, loadEnvironmentVariablesData]);

  // 首次加载 + 设备变化时自动加载所有数据
  useEffect(() => {
    if (currentDevice) {
      refreshAll();
    }
  }, [currentDevice]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleApplyResolution = useCallback(async () => {
    if (!currentDevice) return;
    const w = parseInt(resWidth, 10);
    const h = parseInt(resHeight, 10);
    const d = parseInt(resDensity, 10);
    if (isNaN(w) || isNaN(h) || isNaN(d)) return;
    try {
      await setScreenResolution(currentDevice, w, h, d);
      setShowResDialog(false);
    } catch {
      // ignore
    }
  }, [currentDevice, resWidth, resHeight, resDensity]);

  const handleReboot = useCallback(() => {
    if (!currentDevice) return;
    setConfirmMessage(t("control.confirmReboot"));
    setConfirmAction(() => () => (isHarmonyOS ? hdcReboot : reboot)(currentDevice).catch(() => {}));
  }, [currentDevice, t, isHarmonyOS]);

  const handleRebootRecovery = useCallback(() => {
    if (!currentDevice) return;
    setConfirmMessage(t("control.confirmReboot"));
    setConfirmAction(() => () => (isHarmonyOS ? hdcRebootRecovery : rebootRecovery)(currentDevice).catch(() => {}));
  }, [currentDevice, t, isHarmonyOS]);

  const handleRebootBootloader = useCallback(() => {
    if (!currentDevice) return;
    setConfirmMessage(t("control.confirmReboot"));
    setConfirmAction(() => () => (isHarmonyOS ? hdcRebootBootloader : rebootBootloader)(currentDevice).catch(() => {}));
  }, [currentDevice, t, isHarmonyOS]);

  const executeConfirm = useCallback(() => {
    if (confirmAction) {
      confirmAction();
      setConfirmAction(null);
      setConfirmMessage("");
    }
  }, [confirmAction]);

  if (!currentDevice) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-dark-400">{t("device.noDevice")}</p>
      </div>
    );
  }

  // 根据平台计算百分比
  const memPercent = isHarmonyOS
    ? (memoryInfo?.total && memoryInfo.total > 0
        ? (memoryInfo.used / memoryInfo.total) * 100
        : 0)
    : (perfInfo?.memory_total_bytes && perfInfo.memory_total_bytes > 0
        ? (perfInfo.memory_used_bytes / perfInfo.memory_total_bytes) * 100
        : 0);
  const storagePercent = isHarmonyOS
    ? (storageInfo?.total && storageInfo.total > 0
        ? (storageInfo.used / storageInfo.total) * 100
        : 0)
    : (perfInfo?.storage_total_bytes && perfInfo.storage_total_bytes > 0
        ? (perfInfo.storage_used_bytes / perfInfo.storage_total_bytes) * 100
        : 0);

  // Small inline loading indicator
  const MiniLoader = () => (
    <span className="inline-block w-3 h-3 border border-dark-500 border-t-accent-400 rounded-full animate-spin ml-2" />
  );

  // 格式化字节大小
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = bytes / Math.pow(k, i);
    // >= 1000 GB 显示为 TB
    if (i === 3 && val >= 1000) {
      return (val / 1000).toFixed(1) + " TB";
    }
    return val.toFixed(i >= 2 ? 1 : 0) + " " + sizes[i];
  };

  // 获取当前平台的性能数据（鸿蒙直接用 state，Android 从 perfInfo 读取）
  const cpuUsageValue = isHarmonyOS ? cpuUsage : (perfInfo?.cpu_usage ?? 0);
  const batteryLevel = isHarmonyOS ? batteryInfo?.level : perfInfo?.battery_level;
  const batteryStatus = isHarmonyOS ? batteryInfo?.status : perfInfo?.battery_status;
  const memoryUsed = isHarmonyOS ? memoryInfo?.used : perfInfo?.memory_used_bytes;
  const memoryTotal = isHarmonyOS ? memoryInfo?.total : perfInfo?.memory_total_bytes;
  const memoryFree = isHarmonyOS ? memoryInfo?.free : perfInfo?.memory_free_bytes;
  const storageUsed = isHarmonyOS ? storageInfo?.used : perfInfo?.storage_used_bytes;
  const storageTotal = isHarmonyOS ? storageInfo?.total : perfInfo?.storage_total_bytes;
  const storageFree = isHarmonyOS ? storageInfo?.free : perfInfo?.storage_free_bytes;
  const hasCpuData = isHarmonyOS ? cpuUsage > 0 || cpuLoading : !!perfInfo;
  const hasMemData = isHarmonyOS ? !!memoryInfo : !!perfInfo;
  const hasBatteryData = isHarmonyOS ? !!batteryInfo : !!perfInfo;
  const hasStorageData = isHarmonyOS ? !!storageInfo : !!perfInfo;

  return (
    <div className="p-6 max-w-4xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-dark-100">{t("nav.deviceInfo")}</h1>
        <button
          onClick={refreshAll}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 disabled:opacity-50 transition-colors text-sm"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={refreshing ? "animate-spin" : ""}>
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          {t("common.refresh")}
        </button>
      </div>

      {/* Confirm Dialog */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-dark-800 border border-dark-700/50 rounded-xl p-6 max-w-sm w-full mx-4">
            <p className="text-dark-200 mb-6">{confirmMessage}</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setConfirmAction(null); setConfirmMessage(""); }}
                className="px-4 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm"
              >
                {t("common.cancel")}
              </button>
              <button onClick={executeConfirm} className="px-4 py-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors text-sm">
                {t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolution Dialog */}
      {showResDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-dark-800 border border-dark-700/50 rounded-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-sm font-semibold text-dark-200 mb-4">{t("deviceInfo.changeResolution")}</h3>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <label className="text-xs text-dark-500 mb-1 block">Width</label>
                <input type="number" value={resWidth} onChange={(e) => setResWidth(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-dark-700 border border-dark-600/50 text-dark-100 text-sm focus:outline-none focus:border-accent-500/50" />
              </div>
              <div>
                <label className="text-xs text-dark-500 mb-1 block">Height</label>
                <input type="number" value={resHeight} onChange={(e) => setResHeight(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-dark-700 border border-dark-600/50 text-dark-100 text-sm focus:outline-none focus:border-accent-500/50" />
              </div>
              <div>
                <label className="text-xs text-dark-500 mb-1 block">Density</label>
                <input type="number" value={resDensity} onChange={(e) => setResDensity(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-dark-700 border border-dark-600/50 text-dark-100 text-sm focus:outline-none focus:border-accent-500/50" />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowResDialog(false)} className="px-4 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm">
                {t("common.cancel")}
              </button>
              <button onClick={handleApplyResolution} className="px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors text-sm">
                {t("control.apply")}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-6">
        {/* Row 1: CPU + Memory */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* CPU Gauge */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6 relative group">
            <div className="absolute -top-1 right-1 z-10 flex items-center gap-1 hidden group-hover:flex">
              <button
                className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors bg-dark-700 hover:bg-dark-600 border border-dark-600"
                onClick={() => showRawData(t("monitor.cpuUsage"), cpuRaw || JSON.stringify(perfInfo, null, 2))}
              >
                {t("common.viewRawData")}
              </button>
              <PanelRefreshButton onRefresh={loadCpu} loading={isHarmonyOS ? cpuLoading : perfLoading} />
            </div>
            <h3 className="text-sm font-semibold text-dark-300 mb-4 flex items-center">
              {t("monitor.cpuUsage")}
              {(isHarmonyOS ? cpuLoading : perfLoading) && <MiniLoader />}
            </h3>
            {(hasCpuData || cpuUsageValue > 0) ? (
              <div className="flex items-center justify-center">
                <div className="relative w-40 h-40">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#334155" strokeWidth="10" />
                    <circle cx="60" cy="60" r="50" fill="none" stroke="#3b82f6" strokeWidth="10"
                      strokeLinecap="round"
                      strokeDasharray={`${(cpuUsageValue / 100) * 314} 314`}
                      className="transition-all duration-1000 ease-out" />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-bold text-dark-100">{Math.round(cpuUsageValue)}</span>
                    <span className="text-xs text-dark-400">%</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40">
                <span className="text-dark-500 text-sm">{perfLoading ? "" : t("common.noData")}</span>
              </div>
            )}
          </div>

          {/* Memory */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6 relative group">
            <div className="absolute -top-1 right-1 z-10 flex items-center gap-1 hidden group-hover:flex">
              <button
                className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors bg-dark-700 hover:bg-dark-600 border border-dark-600"
                onClick={() => showRawData(t("monitor.memoryUsage"), memoryInfo?.raw || JSON.stringify(perfInfo, null, 2))}
              >
                {t("common.viewRawData")}
              </button>
              <PanelRefreshButton onRefresh={loadMemory} loading={isHarmonyOS ? memLoading : perfLoading} />
            </div>
            <h3 className="text-sm font-semibold text-dark-300 mb-4 flex items-center">
              {t("monitor.memoryUsage")}
              {(isHarmonyOS ? memLoading : perfLoading) && <MiniLoader />}
            </h3>
            {hasMemData && memoryTotal ? (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-xs text-dark-400">{t("monitor.ram")}</span>
                    <span className="text-xs text-dark-300">{formatBytes(memoryUsed || 0)} / {formatBytes(memoryTotal)}</span>
                  </div>
                  <div className="w-full h-3 bg-dark-700 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-accent-500 to-accent-400 rounded-full transition-all duration-1000"
                      style={{ width: `${memPercent}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                    <span className="text-xs text-dark-500">{t("monitor.used")}</span>
                    <p className="text-sm text-dark-200 font-medium mt-1">{formatBytes(memoryUsed || 0)}</p>
                  </div>
                  <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                    <span className="text-xs text-dark-500">{t("monitor.free")}</span>
                    <p className="text-sm text-dark-200 font-medium mt-1">{formatBytes(memoryFree || 0)}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40">
                <span className="text-dark-500 text-sm">{perfLoading ? "" : t("common.noData")}</span>
              </div>
            )}
          </div>

          {/* Battery */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6 relative group">
            <div className="absolute -top-1 right-1 z-10 flex items-center gap-1 hidden group-hover:flex">
              <button
                className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors bg-dark-700 hover:bg-dark-600 border border-dark-600"
                onClick={() => showRawData(t("monitor.batteryStatus"), batteryInfo?.raw || JSON.stringify(perfInfo, null, 2))}
              >
                {t("common.viewRawData")}
              </button>
              <PanelRefreshButton onRefresh={loadBattery} loading={isHarmonyOS ? batteryLoading : perfLoading} />
            </div>
            <h3 className="text-sm font-semibold text-dark-300 mb-4 flex items-center">
              {t("monitor.batteryStatus")}
              {(isHarmonyOS ? batteryLoading : perfLoading) && <MiniLoader />}
            </h3>
            {hasBatteryData && batteryLevel !== undefined ? (
              <div className="flex items-center gap-6">
                <div className="relative">
                  <div className={`w-20 h-32 rounded-xl border-2 flex items-end justify-center pb-2 transition-colors ${batteryLevel > 20 ? "border-green-500/50" : "border-red-500/50"}`}>
                    <div className={`w-14 rounded-md transition-all duration-1000 ${batteryLevel > 20 ? "bg-green-500/30" : "bg-red-500/30"}`}
                      style={{ height: `${(batteryLevel / 100) * 100}%` }} />
                  </div>
                  <div className="absolute -right-1.5 top-6 w-2 h-4 bg-dark-600 rounded-r" />
                </div>
                <div className="flex-1 space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-3xl font-bold text-dark-100">{batteryLevel}</span>
                    <span className="text-sm text-dark-400">%</span>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-xs text-dark-500">{t("monitor.status")}</span>
                      <span className="text-xs text-dark-300">
                        {isHarmonyOS && batteryInfo ? (
                          batteryInfo.status === "0" ? "未充电" : 
                          batteryInfo.status === "1" ? "充电中" : 
                          batteryInfo.status === "2" ? "已充满" : 
                          batteryInfo.status
                        ) : (
                          batteryStatus || "-"
                        )}
                      </span>
                    </div>
                    {isHarmonyOS && batteryInfo ? (
                      <>
                        <div className="flex justify-between">
                          <span className="text-xs text-dark-500">{t("monitor.temperature")}</span>
                          <span className="text-xs text-dark-300">{(batteryInfo.temperature / 10).toFixed(1)}°C</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-dark-500">电压</span>
                          <span className="text-xs text-dark-300">{(batteryInfo.voltage / 1000000).toFixed(2)}V</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-dark-500">电流</span>
                          <span className="text-xs text-dark-300">{batteryInfo.current}mA</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-dark-500">健康状态</span>
                          <span className="text-xs text-dark-300">{batteryInfo.health === "1" ? "良好" : batteryInfo.health}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-dark-500">充电方式</span>
                          <span className="text-xs text-dark-300">
                            {batteryInfo.plugged_type === "0" ? "未连接" : 
                             batteryInfo.plugged_type === "AC" ? "AC快充" : 
                             batteryInfo.plugged_type === "USB" ? "USB慢充" : 
                             batteryInfo.plugged_type === "1" ? "AC快充" : 
                             batteryInfo.plugged_type === "2" ? "USB慢充" : 
                             batteryInfo.plugged_type}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-xs text-dark-500">电池技术</span>
                          <span className="text-xs text-dark-300">{batteryInfo.technology}</span>
                        </div>
                      </>
                    ) : !isHarmonyOS && (
                      <div className="flex justify-between">
                        <span className="text-xs text-dark-500">{t("monitor.temperature")}</span>
                        <span className="text-xs text-dark-300">{perfInfo?.battery_temperature || "-"}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40">
                <span className="text-dark-500 text-sm">{perfLoading ? "" : t("common.noData")}</span>
              </div>
            )}
          </div>

          {/* Storage */}
          <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6 relative group">
            <div className="absolute -top-1 right-1 z-10 flex items-center gap-1 hidden group-hover:flex">
              <button
                className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors bg-dark-700 hover:bg-dark-600 border border-dark-600"
                onClick={() => showRawData(t("monitor.storageSpace"), storageInfo?.raw || JSON.stringify(perfInfo, null, 2))}
              >
                {t("common.viewRawData")}
              </button>
              <PanelRefreshButton onRefresh={loadStorage} loading={isHarmonyOS ? storageLoading : perfLoading} />
            </div>
            <h3 className="text-sm font-semibold text-dark-300 mb-4 flex items-center">
              {t("monitor.storageSpace")}
              {(isHarmonyOS ? storageLoading : perfLoading) && <MiniLoader />}
            </h3>
            {hasStorageData && storageTotal ? (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between mb-1.5">
                    <span className="text-xs text-dark-400">{t("monitor.rom")}</span>
                    <span className="text-xs text-dark-300">{formatBytes(storageUsed || 0)} / {formatBytes(storageTotal)}</span>
                  </div>
                  <div className="w-full h-3 bg-dark-700 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded-full transition-all duration-1000"
                      style={{ width: `${storagePercent}%` }} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                    <span className="text-xs text-dark-500">{t("monitor.used")}</span>
                    <p className="text-sm text-dark-200 font-medium mt-1">{formatBytes(storageUsed || 0)}</p>
                  </div>
                  <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                    <span className="text-xs text-dark-500">{t("monitor.free")}</span>
                    <p className="text-sm text-dark-200 font-medium mt-1">{formatBytes(storageFree || 0)}</p>
                  </div>
                  <div className="bg-dark-700/30 rounded-lg p-3 text-center">
                    <span className="text-xs text-dark-500">{t("monitor.total")}</span>
                    <p className="text-sm text-dark-200 font-medium mt-1">{formatBytes(storageTotal)}</p>
                  </div>
                </div>
                <div className="bg-dark-700/30 rounded-lg p-3">
                  <span className="text-xs text-dark-500">挂载点</span>
                  <p className="text-sm text-dark-200 font-medium mt-1 font-mono">/dev/block/by-name/userdata</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-40">
                <span className="text-dark-500 text-sm">{perfLoading ? "" : t("common.noData")}</span>
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Extra info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Top Memory Apps (仅 Android) */}
          {!isHarmonyOS && (
            <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6 relative group">
              <PanelRefreshButton onRefresh={loadTopMemory} loading={topMemLoading} />
              <h3 className="text-sm font-semibold text-dark-300 mb-4 flex items-center">
                {t("deviceInfo.topMemoryApps")}
                {topMemLoading && <MiniLoader />}
              </h3>
              {topMemoryApps.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-dark-700/50">
                      <th className="text-left py-2 text-dark-400 font-medium">#</th>
                      <th className="text-left py-2 text-dark-400 font-medium">Package</th>
                      <th className="text-right py-2 text-dark-400 font-medium">Memory</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topMemoryApps.map((app, idx) => (
                      <tr key={app.package_name} className="border-b border-dark-700/30">
                        <td className="py-2 text-dark-500">{idx + 1}</td>
                        <td className="py-2 text-dark-200 font-mono truncate max-w-[200px]">{app.package_name}</td>
                        <td className="py-2 text-dark-200 text-right">{app.memory_used}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-dark-500 text-sm">{topMemLoading ? "" : "-"}</p>
              )}
            </div>
          )}
        </div>

        {/* Hidumper 各部分面板 */}
        {isHarmonyOS && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sectionConfigs.map((config) => {
                const section = hidumperSections[config.name];
                const items = parseSectionData(section?.data || "");
                
                return (
                  <div key={config.name} className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4 relative group aspect-square flex flex-col">
                    <div className="absolute -top-2 -right-2 z-10 flex items-center gap-1 hidden group-hover:flex">
                      <button
                        className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors bg-dark-700 hover:bg-dark-600 border border-dark-600"
                        onClick={() => showRawData(config.title, section?.data || "")}
                      >
                        {t("common.viewRawData")}
                      </button>
                      <button
                        onClick={() => loadHidumperConfig(config)}
                        className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors bg-dark-700 hover:bg-dark-600 border border-dark-600 flex items-center gap-1"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={section?.loading ? "animate-spin" : ""}>
                          <polyline points="23 4 23 10 17 10"></polyline>
                          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                        </svg>
                        {t("common.refresh")}
                      </button>
                    </div>
                    <h4 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2 flex-shrink-0">
                      {config.title}
                      {section?.loading && <MiniLoader />}
                    </h4>
                    <div className="flex-1 min-h-0">
                      {section?.loading && !section?.data ? (
                        <div className="flex items-center justify-center h-full">
                          <LoadingSpinner size="sm" />
                        </div>
                      ) : items.length > 0 ? (
                        <div className="space-y-2 overflow-y-auto h-full pr-1">
                          {items.map((item, idx) => (
                            <div key={idx} className="flex flex-col">
                              <span className="text-[11px] text-dark-500" dangerouslySetInnerHTML={{ __html: translate(item.key) }} />
                              <span className="text-xs text-dark-200 font-mono" dangerouslySetInnerHTML={{ __html: translate(item.value) }} />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <p className="text-xs text-dark-500">{t("common.noData")}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 环境变量面板 */}
            <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-6 relative group">
              <div className="absolute -top-1 right-1 z-10 flex items-center gap-1 hidden group-hover:flex">
                <button
                  className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors bg-dark-700 hover:bg-dark-600 border border-dark-600"
                  onClick={() => showRawData("环境变量原始数据", environmentVariablesData || "暂无数据")}
                >
                  {t("common.viewRawData")}
                </button>
                <button
                  onClick={loadEnvironmentVariablesData}
                  className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors bg-dark-700 hover:bg-dark-600 border border-dark-600 flex items-center gap-1"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={environmentVariablesLoading ? "animate-spin" : ""}>
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                  </svg>
                  {t("common.refresh")}
                </button>
              </div>
              <h4 className="text-sm font-semibold text-blue-400 mb-4 flex items-center gap-2">
                环境变量
                {environmentVariablesLoading && <MiniLoader />}
              </h4>
              <div className="h-96 overflow-y-auto pr-2">
                <EnvironmentVariablesTable />
              </div>
            </div>
          </div>
        )}
      </div>

      <RawDataDialog
        open={rawDialogOpen}
        onClose={() => setRawDialogOpen(false)}
        title={rawDialogTitle}
        data={rawDialogData}
      />
    </div>
  );
};

// 应用ID和应用名称对照表
const appIdToNameMap: Record<string, string> = {
  "com.ss.hm.ugc.aweme": "抖音",
  "com.tencent.mm": "微信",
  "com.tencent.mobileqq": "QQ",
  "com.huawei.appmarket": "应用市场",
  "com.huawei.camera": "相机",
  "com.android.settings": "设置",
  "com.huawei.browser": "浏览器",
  "com.huawei.health": "运动健康",
  "com.huawei.music": "音乐",
  "com.huawei.vmall": "华为商城"
};

// 全局函数用于打开链接
window.openAppGallery = (appName: string) => {
  open(`https://appgallery.huawei.com/search/${encodeURIComponent(appName)}`);
};

// 翻译函数
function translate(text: string): string {
  // 去除首尾的空格和分隔符
  const cleanText = text.trim().replace(/^[-]+|[-]+$/g, '').trim();
  
  // 检查是否是应用ID，如果是则转换为应用名称
  if (cleanText.startsWith("com.")) {
    if (appIdToNameMap[cleanText]) {
      const appName = appIdToNameMap[cleanText];
      return `<span class="text-blue-400 hover:underline cursor-pointer" onclick="window.openAppGallery('${appName}')">${appName}</span> (${cleanText})`;
    }
  }
  
  if (translationMap[cleanText]) {
    return translationMap[cleanText];
  }
  return text;
}

// 解析单个 section 的数据
function parseSectionData(raw: string): Array<{ key: string; value: string; isSectionTitle?: boolean }> {
  const items: Array<{ key: string; value: string; isSectionTitle?: boolean }> = [];
  const lines = raw.split('\n');
  
  // 需要过滤掉的字段
  const filteredKeys = [
    'Usage',
    '-input_simulate',
    'simulate event from ohos core_service, supported events',
    'BindTime',
    'EndTime',
    'SpendTime',
    'login/logout/token_invalid'
  ];
  
  // 过滤掉的前缀
  const filteredPrefixes = [
    '-input_simulate'
  ];
  
  // 部分标题映射
  const sectionTitles = {
    'WifiDevice': 'WiFi 设备',
    'WifiHotspot': 'WiFi 热点',
    'WifiP2p': 'WiFi P2P',
    'WifiScan': 'WiFi 扫描',
    'NetConnManager': '网络连接管理',
    'NetStatsManager': '网络统计管理',
    'NetTetheringManager': '网络共享管理',
    'NetsysNative': '网络系统',
    'AVCodecService': '音视频编解码服务',
    'MediaKeySystemService': '媒体密钥系统服务',
    'TelephonyCoreService': '电话核心服务'
  };
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // 跳过空行
    if (!trimmedLine) {
      continue;
    }
    
    // 处理分隔线和部分标题
    if (trimmedLine.startsWith('----------------------------------')) {
      // 查找下一行作为部分标题
      const nextLineIndex = lines.indexOf(line) + 1;
      if (nextLineIndex < lines.length) {
        const nextLine = lines[nextLineIndex].trim();
        if (nextLine && !nextLine.startsWith('----------------------------------')) {
          // 检查是否是已知的部分标题
          for (const [key, title] of Object.entries(sectionTitles)) {
            if (nextLine.includes(key)) {
              items.push({ 
                key: title, 
                value: '', 
                isSectionTitle: true 
              });
              break;
            }
          }
        }
      }
      continue;
    }
    
    // 跳过以特定前缀开头的行
    if (filteredPrefixes.some(prefix => trimmedLine.startsWith(prefix))) {
      continue;
    }
    
    // 处理不同的分隔符：冒号、连字符、等号
    let separatorIndex = -1;
    let separator = '';
    
    // 优先找冒号
    const colonIndex = trimmedLine.indexOf(':');
    const hyphenIndex = trimmedLine.indexOf(' - ');
    const equalIndex = trimmedLine.indexOf(' = ');
    
    if (hyphenIndex > 0) {
      separatorIndex = hyphenIndex;
      separator = ' - ';
    } else if (equalIndex > 0) {
      separatorIndex = equalIndex;
      separator = ' = ';
    } else if (colonIndex > 0) {
      separatorIndex = colonIndex;
      separator = ':';
    }
    
    if (separatorIndex > 0) {
      let key = trimmedLine.slice(0, separatorIndex).trim();
      const value = trimmedLine.slice(separatorIndex + separator.length).trim();
      
      // 过滤掉不需要的字段
      if (filteredKeys.includes(key)) {
        continue;
      }
      
      // 将 "支持 5G" 改为 "是否打开5G"
      if (key === 'IsNrSupported') {
        key = '是否打开5G';
      }
      
      if (key && value) {
        items.push({ key, value });
      }
    } else if (trimmedLine && !trimmedLine.startsWith('[') && !trimmedLine.endsWith(']')) {
      // 可能是小标题，不作为键值对处理
    }
  }
  
  return items;
}

// 环境变量表组件
const EnvironmentVariablesTable: React.FC = () => {
  // 环境变量数据
  const envVars = [
    { name: "BASHPID", value: "51924" },
    { name: "DOWNLOAD_CACHE", value: "/data/cache" },
    { name: "EPOCHREALTIME", value: "1776829957.971719" },
    { name: "HOME", value: "/root" },
    { name: "IFS", value: "$' \\t\\n'" },
    { name: "KSHEGID", value: "2000" },
    { name: "KSHGID", value: "2000" },
    { name: "KSHUID", value: "2000" },
    { name: "KSH_VERSION", value: "@(#)MIRBSD KSH R59 2020/10/31" },
    { name: "LANG", value: "en_US.UTF-8" },
    { name: "MALI_REPORT_MEM_USAGE", value: "1" },
    { name: "OHOS_SOCKET_hdcd", value: "14" },
    { name: "OLDPWD", value: "/" },
    { name: "OPTIND", value: "1" },
    { name: "PATH", value: "/usr/local/bin:/bin:/usr/bin:/system/bin:/vendor/bin" },
    { name: "PATHSEP", value: ":" },
    { name: "PGRP", value: "51924" },
    { name: "PIPESTATUS", value: "0" },
    { name: "PPID", value: "1907" },
    { name: "PS1", value: "$ " },
    { name: "PS2", value: "> " },
    { name: "PS3", value: "#? " },
    { name: "PS4", value: "+ " },
    { name: "PULSE_RUNTIME_PATH", value: "/data/data/.pulse_dir/runtime" },
    { name: "PULSE_STATE_PATH", value: "/data/data/.pulse_dir/state" },
    { name: "PWD", value: "/" },
    { name: "RANDOM", value: "9565" },
    { name: "SECONDS", value: "0" },
    { name: "SHLVL", value: "1" },
    { name: "TERM", value: "ansi" },
    { name: "TMOUT", value: "0" },
    { name: "TMP", value: "/data/local/mtp_tmp/" },
    { name: "TMPDIR", value: "/data/local/tmp" },
    { name: "UBSAN_OPTIONS", value: "print_stacktrace=1:print_module_map=2:log_exe_name=1" },
    { name: "USER", value: "root" },
    { name: "USER_ID", value: "2000" },
    { name: "UV_THREADPOOL_SIZE", value: "16" }
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-dark-700/50">
            <th className="text-left py-2 text-dark-400 font-medium">变量名</th>
            <th className="text-left py-2 text-dark-400 font-medium">值</th>
          </tr>
        </thead>
        <tbody>
          {envVars.map((env, idx) => (
            <tr key={idx} className="border-b border-dark-700/30">
              <td className="py-2 text-dark-300 font-medium">{env.name}</td>
              <td className="py-2 text-dark-200 font-mono truncate max-w-[400px]">{env.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default DeviceInfoPage;
