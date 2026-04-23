import React, { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useDeviceStore } from "../store/deviceStore";
import LoadingSpinner from "../components/LoadingSpinner";
import { takeScreenshot, getFileList, getLogcat, startLogcatStream, stopLogcatStream, hdcScreenshot, executeShell, hdcShell, hdcGetFileList, hdcPullFile, hdcPushFile, hdcCheckPathsPermission } from "../api/adb";
import { onLogOutput } from "../api/events";
import type { FileInfo, HdcFileInfo } from "../types";
import { open, save } from "@tauri-apps/plugin-dialog";

type ToolTab = "screenshot" | "filemanager" | "logcat" | "proxy";

// Screenshot history stored in localStorage
const SCREENSHOT_HISTORY_KEY = "screenshot_history";
const MAX_HISTORY = 20;

interface ScreenshotRecord {
  base64: string;
  timestamp: number;
  deviceSerial: string;
}

function getScreenshotHistory(): ScreenshotRecord[] {
  try {
    const raw = localStorage.getItem(SCREENSHOT_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveScreenshotHistory(history: ScreenshotRecord[]) {
  try {
    localStorage.setItem(SCREENSHOT_HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {
    // localStorage full, ignore
  }
}

// Export for HomePage to use
export function getLatestScreenshot(): string | null {
  const history = getScreenshotHistory();
  return history.length > 0 ? history[0].base64 : null;
}

export function saveDeviceScreenshot(base64: string, serial: string) {
  const history = getScreenshotHistory();
  history.unshift({ base64, timestamp: Date.now(), deviceSerial: serial });
  saveScreenshotHistory(history);
}

const ToolsPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentDevice, devices, fetchDevices } = useDeviceStore();
  const [activeTab, setActiveTab] = useState<ToolTab>("screenshot");

  // 判断当前设备是否为 HarmonyOS 设备
  const isHarmonyOS = currentDevice
    ? devices.find((d) => d.serial === currentDevice)?.platform === "harmonyos"
    : false;

  // 过滤掉 HarmonyOS 设备不支持的功能
  const tabs: { key: ToolTab; labelKey: string }[] = [
    { key: "screenshot" as ToolTab, labelKey: "tools.screenshot" },
    { key: "filemanager" as ToolTab, labelKey: "tools.fileManager" },
    { key: "logcat" as ToolTab, labelKey: "tools.logcat" },
    { key: "proxy" as ToolTab, labelKey: "tools.proxy" },
  ];

  // 如果当前选中的 tab 被隐藏了，自动切换到第一个 tab
  useEffect(() => {
    // 不再需要特殊处理鸿蒙设备，filemanager 现在支持鸿蒙
  }, [isHarmonyOS, activeTab]);

  return (
    <div className="p-6 h-full flex flex-col animate-fade-in">
      <h1 className="text-xl font-semibold text-dark-100 mb-4">{t("nav.tools")}</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-dark-800/50 border border-dark-700/50 rounded-lg p-1 mb-4 flex-shrink-0 w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-1.5 rounded-md text-sm transition-colors ${
              activeTab === tab.key
                ? "bg-accent-500/20 text-accent-400 font-medium"
                : "text-dark-400 hover:text-dark-300"
            }`}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === "screenshot" && <ScreenshotTab />}
        {activeTab === "filemanager" && <FileManagerTab />}
        {activeTab === "logcat" && <LogcatTab />}
        {activeTab === "proxy" && <ProxyTab />}
      </div>
    </div>
  );
};

const ScreenshotTab: React.FC = () => {
  const { t } = useTranslation();
  const { currentDevice, devices, fetchDevices } = useDeviceStore();
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ScreenshotRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setHistory(getScreenshotHistory());
  }, []);

  const handleScreenshot = async () => {
    if (!currentDevice) return;
    setLoading(true);
    setError(null);
    try {
      const platform = devices.find((d) => d.serial === currentDevice)?.platform || "android";
      const base64 = platform === "harmonyos"
        ? await hdcScreenshot(currentDevice)
        : await takeScreenshot(currentDevice);
      setScreenshot(base64);
      // Save to history
      const record: ScreenshotRecord = {
        base64,
        timestamp: Date.now(),
        deviceSerial: currentDevice,
      };
      const newHistory = [record, ...history].slice(0, MAX_HISTORY);
      saveScreenshotHistory(newHistory);
      setHistory(newHistory);
      // Also save for HomePage device icon
      saveDeviceScreenshot(base64, currentDevice);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("tools.screenshotFailed"));
      // 截图失败可能是因为设备 offline，主动检查设备状态
      fetchDevices();
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteHistory = (index: number) => {
    const newHistory = history.filter((_, i) => i !== index);
    saveScreenshotHistory(newHistory);
    setHistory(newHistory);
  };

  const handleClearHistory = () => {
    saveScreenshotHistory([]);
    setHistory([]);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleString();
  };

  return (
    <div className="h-full flex flex-col">
      {/* Current Screenshot */}
      <div className="flex-1 flex flex-col items-center justify-center min-h-0">
        {loading && <LoadingSpinner />}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}
        {screenshot && !loading && (
          <div className="mb-4 animate-fade-in max-h-[50vh] overflow-hidden">
            <img
              src={`data:image/png;base64,${screenshot}`}
              alt="Screenshot"
              className="max-h-[50vh] rounded-xl border border-dark-700/50 shadow-lg"
            />
          </div>
        )}
        <button
          onClick={handleScreenshot}
          disabled={!currentDevice || loading}
          className="px-6 py-2.5 rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium flex-shrink-0"
        >
          {t("tools.takeScreenshot")}
        </button>
      </div>

      {/* Screenshot History */}
      <div className="flex-shrink-0 mt-4 border-t border-dark-700/50 pt-3">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1.5 text-xs text-dark-400 hover:text-dark-300 transition-colors"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`transition-transform ${showHistory ? "rotate-90" : ""}`}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            {t("tools.screenshotHistory", { count: history.length })}
          </button>
          {history.length > 0 && (
            <button
              onClick={handleClearHistory}
              className="text-xs text-dark-500 hover:text-red-400 transition-colors"
            >
              {t("tools.clearLog")}
            </button>
          )}
        </div>

        {showHistory && history.length > 0 && (
          <div className="max-h-40 overflow-y-auto flex gap-2 pb-1">
            {history.map((record, i) => (
              <div
                key={record.timestamp}
                className="relative group flex-shrink-0"
              >
                <img
                  src={`data:image/png;base64,${record.base64}`}
                  alt={`Screenshot ${i + 1}`}
                  className="h-24 w-auto rounded-lg border border-dark-700/50 cursor-pointer hover:border-accent-500/50 transition-colors"
                  onClick={() => setScreenshot(record.base64)}
                  title={formatTime(record.timestamp)}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteHistory(i);
                  }}
                  className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const FileManagerTab: React.FC = () => {
  const { t } = useTranslation();
  const { currentDevice, devices } = useDeviceStore();
  const [files, setFiles] = useState<(FileInfo | HdcFileInfo)[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const pathInputRef = useRef<HTMLInputElement>(null);

  // 判断当前设备是否为 HarmonyOS 设备
  const isHarmonyOS = currentDevice
    ? devices.find((d) => d.serial === currentDevice)?.platform === "harmonyos"
    : false;

  const loadFiles = useCallback(
    async (path: string) => {
      if (!currentDevice) return;
      setLoading(true);
      setError(null);
      try {
        let fileList: (FileInfo | HdcFileInfo)[];
        if (isHarmonyOS) {
          fileList = await hdcGetFileList(currentDevice, path);
        } else {
          fileList = await getFileList(currentDevice, path);
        }
        setFiles(fileList);
        setCurrentPath(path);
      } catch (err: any) {
        // 处理权限错误
        console.error("Load files error:", err);
        let errorMessage = "Failed to load files";
        if (err.message) {
          errorMessage = err.message;
        } else if (typeof err === "string") {
          errorMessage = err;
        }
        console.error("Error message:", errorMessage);
        // 即使遇到错误，也要更新当前路径，这样用户可以看到他们尝试访问的路径
        setCurrentPath(path);
        if (errorMessage.includes("permission denied") || errorMessage.includes("Permission denied") || errorMessage.includes("权限")) {
          setError(t("tools.fetchFilesError", { error: t("tools.permissionDenied") }));
        } else {
          setError(t("tools.fetchFilesError", { error: errorMessage }));
        }
      } finally {
        setLoading(false);
      }
    },
    [currentDevice, isHarmonyOS, t]
  );

  useEffect(() => {
    if (currentDevice) {
      // 鸿蒙设备默认从 Photo 目录开始
      const initialPath = isHarmonyOS ? "/mnt/data/100/media_fuse/Photo" : "/";
      loadFiles(initialPath);
    }
  }, [currentDevice, isHarmonyOS, loadFiles]);

  const navigateTo = (path: string) => {
    loadFiles(path);
  };

  const handlePathSubmit = () => {
    let p = editValue.trim();
    if (!p) return;
    if (!p.startsWith("/")) p = "/" + p;
    navigateTo(p);
    setIsEditing(false);
  };

  const handlePathDoubleClick = () => {
    setEditValue(currentPath);
    setIsEditing(true);
    setTimeout(() => {
      pathInputRef.current?.select();
    }, 0);
  };

  const handlePathKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handlePathSubmit();
    } else if (e.key === "Escape") {
      setIsEditing(false);
    }
  };

  const handleDownload = async (file: FileInfo | HdcFileInfo) => {
    if (!currentDevice || file.is_directory) return;
    setDownloading(true);
    setError(null);
    const startTime = Date.now();
    try {
      const savePath = await save({
        defaultPath: file.name,
      });
      if (savePath) {
        if (isHarmonyOS) {
          await hdcPullFile(currentDevice, file.path, savePath);
          const elapsed = Date.now() - startTime;
          alert(t("tools.downloadSuccess") + `, 耗时 ${elapsed} ms`);
        } else {
          // 这里可以添加 Android 设备的文件下载逻辑
          alert(t("tools.downloadFailed") + `: Android download not implemented`);
        }
      }
    } catch (e: any) {
      let errorMessage = e.message || String(e);
      // 处理错误信息，移除技术词汇和标记
      errorMessage = errorMessage.replace(/HDC命令执行失败:|HDC 命令执行失败:|\[Fail\]/g, '').trim();
      alert(t("tools.downloadFailed") + `: ${errorMessage}`);
    } finally {
      setDownloading(false);
    }
  };

  const handleUpload = async () => {
    if (!currentDevice) return;
    setUploading(true);
    setError(null);
    const startTime = Date.now();
    try {
      const selectedFiles = await open({
        multiple: true,
        directory: false,
      });
      if (selectedFiles && selectedFiles.length > 0) {
        for (const filePath of selectedFiles) {
          const fileName = filePath.split('/').pop() || filePath;
          if (isHarmonyOS) {
            await hdcPushFile(currentDevice, filePath, `${currentPath}/${fileName}`);
          } else {
            // 这里可以添加 Android 设备的文件上传逻辑
            alert(t("tools.uploadFailed") + `: Android upload not implemented`);
          }
        }
        loadFiles(currentPath);
        const elapsed = Date.now() - startTime;
        alert(t("tools.uploadSuccess") + `, 耗时 ${elapsed} ms`);
      }
    } catch (e: any) {
      let errorMessage = e.message || String(e);
      // 处理错误信息，移除技术词汇和标记
      errorMessage = errorMessage.replace(/HDC命令执行失败:|HDC 命令执行失败:|\[Fail\]/g, '').trim();
      alert(t("tools.uploadFailed") + `: ${errorMessage}`);
    } finally {
      setUploading(false);
    }
  };

  // Build path segments for breadcrumb
  const pathParts = currentPath === "/" ? [] : currentPath.split("/").filter(Boolean);

  return (
    <div className="h-full flex flex-col">
      {/* Windows-style Address Bar */}
      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        {/* Back button */}
        <button
          onClick={() => {
            if (currentPath !== "/" && currentPath !== "/mnt/data/100/media_fuse/Photo") {
              const parent = "/" + pathParts.slice(0, -1).join("/");
              navigateTo(parent || "/");
            }
          }}
          disabled={currentPath === "/" || (isHarmonyOS && currentPath === "/mnt/data/100/media_fuse/Photo")}
          className="p-1.5 rounded-md hover:bg-dark-700/50 text-dark-400 hover:text-dark-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        {/* Path bar */}
        <div
          className="flex-1 flex items-center bg-dark-800/50 border border-dark-700/50 rounded-lg px-2 py-1.5 min-w-0 cursor-text"
          onDoubleClick={handlePathDoubleClick}
        >
          {isEditing ? (
            <input
              ref={pathInputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handlePathKeyDown}
              onBlur={handlePathSubmit}
              className="flex-1 bg-transparent text-sm text-dark-100 outline-none font-mono"
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-0.5 min-w-0 overflow-hidden">
              {/* 根目录 */}
              <button
                onClick={() => navigateTo("/")}
                className="text-xs text-accent-400 hover:text-accent-300 hover:bg-dark-700/30 px-1.5 py-0.5 rounded transition-colors flex-shrink-0"
              >
                /
              </button>
              {pathParts.map((part, i) => {
                return (
                  <React.Fragment key={i}>
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-dark-600 flex-shrink-0">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                    <button
                      onClick={() => navigateTo("/" + pathParts.slice(0, i + 1).join("/"))}
                      className="text-xs text-accent-400 hover:text-accent-300 hover:bg-dark-700/30 px-1.5 py-0.5 rounded transition-colors truncate"
                    >
                      {part}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>

        {/* Upload button */}
        <button
          onClick={handleUpload}
          disabled={!currentDevice || uploading}
          className="p-1.5 rounded-md hover:bg-dark-700/50 text-dark-400 hover:text-dark-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title={t("tools.upload")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </button>
      </div>

      {/* File List */}
      <div className="flex-1 overflow-y-auto bg-dark-800/30 border border-dark-700/30 rounded-xl">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <LoadingSpinner size="sm" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        ) : files.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-sm text-dark-400">{t("tools.emptyFolder")}</p>
          </div>
        ) : (
          <div className="divide-y divide-dark-700/30">
            {/* Back button */}
            {currentPath !== "/" && currentPath !== "/mnt/data/100/media_fuse/Photo" && (
              <button
                onClick={() => {
                  const parent = "/" + pathParts.slice(0, -1).join("/");
                  navigateTo(parent || "/");
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-dark-700/30 transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-dark-400">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                <span className="text-sm text-dark-300">..</span>
              </button>
            )}
            {files.map((file) => (
              <div key={file.path} className="w-full">
                <button
                  onClick={() => file.is_directory && navigateTo(file.path)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-dark-700/30 transition-colors text-left group"
                >
                  {file.is_directory ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-400 flex-shrink-0">
                      <path d="M22 19 a 2 2 0 0 1-2 2 H4 a 2 2 0 0 1-2-2 V5 a 2 2 0 0 1 2-2 h5 l2 3 h9 a 2 2 0 0 1 2 2 z" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-dark-400 flex-shrink-0">
                      <path d="M13 2 H6 a 2 2 0 0 0-2 2 v16 a 2 2 0 0 0 2 2 h12 a 2 2 0 0 0 2-2 V9 z" />
                      <polyline points="13 2 13 9 20 9" />
                    </svg>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 relative">
                      <p className="text-sm text-dark-200 truncate">{file.name}</p>
                      {'full_info' in file && file.full_info && (
                        <span className="absolute left-0 top-full mt-1 bg-dark-800/90 border border-dark-700/50 rounded px-2 py-1 text-xs text-dark-400 whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10 font-mono">
                          {file.full_info}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-dark-500 flex-shrink-0">
                      {file.is_directory ? t("tools.folder") : file.size}
                    </span>
                    {!file.is_directory && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(file);
                        }}
                        disabled={downloading}
                        className="p-1 rounded-md hover:bg-dark-700/50 text-dark-400 hover:text-dark-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        title={t("tools.download")}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="12 3 12 15" />
                          <polyline points="8 11 12 15 16 11" />
                          <line x1="21" y1="21" x2="3" y2="21" />
                        </svg>
                      </button>
                    )}
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const LogcatTab: React.FC = () => {
  const { t } = useTranslation();
  const { currentDevice } = useDeviceStore();
  const [logs, setLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [isCapturing, setIsCapturing] = useState(false);
  const [loading, setLoading] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      unlistenRef.current?.();
    };
  }, []);

  const startCapture = async () => {
    if (!currentDevice) return;
    setIsCapturing(true);
    setLogs([]);
    setLoading(true);

    try {
      // 启动实时日志流
      await startLogcatStream(currentDevice);
      setLoading(false);

      // 监听日志输出事件
      onLogOutput((event) => {
        setLogs((prev) => [...prev, event.line]);
      }).then((unlisten) => {
        unlistenRef.current = unlisten;
      });
    } catch (error) {
      console.error("启动日志流失败:", error);
      setLoading(false);
      setIsCapturing(false);
    }
  };

  const stopCapture = async () => {
    setIsCapturing(false);
    unlistenRef.current?.();
    unlistenRef.current = null;
    
    // 停止实时日志流
    try {
      await stopLogcatStream();
    } catch (error) {
      console.error("停止日志流失败:", error);
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [logs]);

  const filteredLogs = filter
    ? logs.filter((line) => line.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  return (
    <div className="h-full flex flex-col">
      {/* Controls */}
      <div className="flex items-center gap-3 mb-3 flex-shrink-0">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("tools.logFilter")}
          className="flex-1 px-3 py-1.5 bg-dark-800/50 border border-dark-700/50 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent-500"
        />
        {isCapturing ? (
          <button
            onClick={stopCapture}
            className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors text-sm"
          >
            {t("tools.stopLog")}
          </button>
        ) : (
          <button
            onClick={startCapture}
            disabled={!currentDevice}
            className="px-3 py-1.5 rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 transition-colors text-sm"
          >
            {t("tools.startLog")}
          </button>
        )}
        <button
          onClick={clearLogs}
          className="px-3 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm"
        >
          {t("tools.clearLog")}
        </button>
      </div>

      {/* Log Output */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto bg-dark-900 border border-dark-700/30 rounded-xl p-3 font-mono text-xs"
      >
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <LoadingSpinner size="sm" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <p className="text-dark-500">{t("tools.noLogs")}</p>
        ) : (
          filteredLogs.map((line, i) => (
            <div
              key={i}
              className={`py-0.5 ${
                line.includes("E/")
                  ? "text-red-400"
                  : line.includes("W/")
                  ? "text-yellow-400"
                  : line.includes("I/")
                  ? "text-dark-300"
                  : "text-dark-500"
              }`}
            >
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const ProxyTab: React.FC = () => {
  const { t } = useTranslation();
  const { currentDevice, devices } = useDeviceStore();
  const [proxyHost, setProxyHost] = useState("127.0.0.1");
  const [proxyPort, setProxyPort] = useState("8080");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApplyProxy = async () => {
    if (!currentDevice) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const platform = devices.find((d) => d.serial === currentDevice)?.platform || "android";
      
      if (platform === "harmonyos") {
        // HarmonyOS proxy settings using network-cfg
        const proxyCommand = `network-cfg set http_proxy ${proxyHost}:${proxyPort}`;
        await hdcShell(currentDevice, proxyCommand);
      } else {
        // Android proxy settings
        const proxyCommand = `settings put global http_proxy ${proxyHost}:${proxyPort}`;
        await executeShell(currentDevice, proxyCommand);
      }
      
      // Show success message
      alert(t("tools.proxyApplied"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("tools.proxyFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleClearProxy = async () => {
    if (!currentDevice) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const platform = devices.find((d) => d.serial === currentDevice)?.platform || "android";
      
      if (platform === "harmonyos") {
        // HarmonyOS clear proxy using network-cfg
        await hdcShell(currentDevice, `network-cfg set http_proxy 0`);
      } else {
        // Android clear proxy
        await executeShell(currentDevice, `settings put global http_proxy :0`);
      }
      
      // Show success message
      alert(t("tools.proxyCleared"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("tools.proxyFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-4">
        {/* Proxy Host */}
        <div className="mb-3">
          <label className="block text-sm text-dark-400 mb-1.5">{t("tools.proxyHost")}</label>
          <input
            type="text"
            value={proxyHost}
            onChange={(e) => setProxyHost(e.target.value)}
            placeholder="127.0.0.1"
            className="w-full px-3 py-1.5 bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent-500"
          />
        </div>

        {/* Proxy Port */}
        <div className="mb-4">
          <label className="block text-sm text-dark-400 mb-1.5">{t("tools.proxyPort")}</label>
          <input
            type="number"
            value={proxyPort}
            onChange={(e) => setProxyPort(e.target.value)}
            placeholder="8080"
            className="w-full px-3 py-1.5 bg-dark-800 border border-dark-700 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent-500"
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleApplyProxy}
            disabled={!currentDevice || loading}
            className="px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            {loading ? t("common.loading") : t("tools.applyProxy")}
          </button>
          <button
            onClick={handleClearProxy}
            disabled={!currentDevice || loading}
            className="px-4 py-2 rounded-lg bg-dark-700 text-dark-200 hover:bg-dark-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            {loading ? t("common.loading") : t("tools.clearProxy")}
          </button>
        </div>

        {/* Info */}
        <div className="mt-4 p-3 bg-dark-700/50 border border-dark-600/50 rounded-lg text-xs text-dark-400">
          <p>{t("tools.proxyInfo")}</p>
        </div>
      </div>
    </div>
  );
};

export default ToolsPage;
