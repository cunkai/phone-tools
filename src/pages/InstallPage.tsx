import React, { useState, useCallback, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDeviceStore } from "../store/deviceStore";
import { useAppStore } from "../store/appStore";
import { open } from "@tauri-apps/plugin-dialog";
import LoadingSpinner from "../components/LoadingSpinner";

const InstallPage: React.FC = () => {
  const { t } = useTranslation();
  const { devices, currentDevice } = useDeviceStore();
  const { apkInfo, installProgress, installStatus, installError, parseApk, installApp, resetInstall } =
    useAppStore();

  const [filePath, setFilePath] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";

  const handleFile = useCallback(
    async (path: string) => {
      const platform = devices.find((d) => d.serial === currentDevice)?.platform || "android";
      const validExtensions = platform === "harmonyos"
        ? [".hap"]
        : [".apk", ".apks", ".xapk", ".apkm"];
      if (!validExtensions.some((ext) => path.endsWith(ext))) {
        return;
      }
      setFilePath(path);
      setIsParsing(true);
      try {
        await parseApk(path);
      } finally {
        setIsParsing(false);
      }
    },
    [parseApk, currentDevice, devices]
  );

  const handleOpenFile = useCallback(async () => {
    try {
      const platform = devices.find((d) => d.serial === currentDevice)?.platform || "android";
      const filters = platform === "harmonyos"
        ? [{ name: "HarmonyOS App", extensions: ["hap", "app"] }]
        : [{ name: "APK", extensions: ["apk", "apks", "xapk", "apkm"] }];
      const selected = await open({
        multiple: false,
        filters,
      });
      if (selected && typeof selected === "string") {
        await handleFile(selected);
      }
    } catch {
      // user cancelled
    }
  }, [handleFile, currentDevice, devices]);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      // 拖拽文件无法获取完整路径，提示用户使用文件选择器
      const file = e.dataTransfer.files[0];
      if (file) {
        // 尝试从 file.path 获取（Tauri webview 可能支持）
        // @ts-expect-error Tauri extends File with path
        const fullPath = file.path || file.name;
        if (fullPath.includes(":\\") || fullPath.startsWith("/")) {
          await handleFile(fullPath);
        } else {
          // 无法获取完整路径，引导用户使用选择器
          await handleOpenFile();
        }
      }
    },
    [handleFile, handleOpenFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // HTML input 在 Tauri 中也可能无法获取完整路径
      // 优先使用 Tauri dialog
      handleOpenFile();
      e.target.value = "";
    },
    [handleOpenFile]
  );

  const handleInstall = async () => {
    if (!currentDevice || !filePath) return;
    if (currentPlatform === "harmonyos") {
      const { hdcInstallApp } = await import("../api/adb");
      await hdcInstallApp(currentDevice, filePath);
    } else {
      await installApp(currentDevice, filePath);
    }
  };

  const handleReset = () => {
    resetInstall();
    setFilePath("");
  };

  // SDK 兼容性检查
  const isSdkIncompatible = useMemo(() => {
    if (!apkInfo?.min_sdk_version || !currentDevice) return false;
    const device = devices.find((d) => d.serial === currentDevice);
    if (!device?.sdk_version) return false;
    const deviceSdk = parseInt(device.sdk_version, 10);
    if (isNaN(deviceSdk) || deviceSdk <= 0) return false;
    return deviceSdk < apkInfo.min_sdk_version!;
  }, [apkInfo, currentDevice, devices]);

  const renderStatus = () => {
    if (installStatus === "installing") {
      return (
        <div className="mt-6 p-6 bg-dark-800/50 border border-dark-700/50 rounded-xl animate-fade-in">
          <div className="flex items-center gap-3">
            <LoadingSpinner size="sm" />
            <span className="text-sm text-dark-200">{t("install.installing")}</span>
          </div>
        </div>
      );
    }

    if (installStatus === "success") {
      return (
        <div className="mt-6 p-6 bg-green-500/10 border border-green-500/30 rounded-xl animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-green-400"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-green-400">
                {t("install.installSuccess")}
              </p>
              <p className="text-xs text-dark-400 mt-0.5">
                {apkInfo?.app_name} v{apkInfo?.version_name}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={handleReset}
              className="flex-1 px-4 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm"
            >
              {t("common.done")}
            </button>
            {apkInfo?.package_name && currentDevice && (
              <button
                onClick={async () => {
                  try {
                    const { startApplication } = await import("../api/adb");
                    await startApplication(currentDevice, apkInfo.package_name!);
                  } catch {
                    // ignore
                  }
                }}
                className="flex-1 px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors text-sm"
              >
                {t("apps.launch")}
              </button>
            )}
          </div>
        </div>
      );
    }

    if (installStatus === "error") {
      return (
        <div className="mt-6 p-6 bg-red-500/10 border border-red-500/30 rounded-xl animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-red-400"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="15" y1="9" x2="9" y2="15" />
                <line x1="9" y1="9" x2="15" y2="15" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-red-400">
                {t("install.installFailed")}
              </p>
              <p className="text-xs text-dark-400 mt-0.5">{installError}</p>
            </div>
          </div>
          <div className="flex gap-3 mt-4">
            <button
              onClick={handleReset}
              className="px-4 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={handleInstall}
              className="px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors text-sm"
            >
              {t("common.retry")}
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="p-6 max-w-2xl mx-auto animate-fade-in">
      <h1 className="text-xl font-semibold text-dark-100 mb-6">
        {t("nav.install")}
      </h1>

      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleOpenFile}
        className={`relative border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all duration-200 ${
          isDragging
            ? "border-accent-500 bg-accent-500/10"
            : "border-dark-600 hover:border-dark-500 bg-dark-800/30"
        }`}
      >
        <div className="flex flex-col items-center">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className={`mb-4 ${isDragging ? "text-accent-400" : "text-dark-500"}`}
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p className="text-sm text-dark-300">
            {currentPlatform === "harmonyos" ? t("install.dropzoneHarmony") : t("install.dropzone")}
          </p>
          <p className="text-xs text-dark-500 mt-1">
            {currentPlatform === "harmonyos" ? t("install.dropzoneHintHarmony") : t("install.dropzoneHint")}
          </p>
        </div>
      </div>

      {/* Parsing */}
      {isParsing && (
        <div className="mt-4 flex items-center justify-center gap-2">
          <LoadingSpinner size="sm" />
          <span className="text-sm text-dark-400">{t("install.parsing")}</span>
        </div>
      )}

      {/* APK Info */}
      {apkInfo && installStatus === "idle" && (
        <div className="mt-6 bg-dark-800/50 border border-dark-700/50 rounded-xl p-6 animate-slide-in">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">
            {t("install.appInfo")}
          </h3>
          <div className="flex gap-4">
            {apkInfo.icon_base64 && (
              <img
                src={`data:image/png;base64,${apkInfo.icon_base64}`}
                alt=""
                className="w-16 h-16 rounded-xl bg-dark-700"
              />
            )}
            <div className="flex-1 space-y-2">
              <div>
                <span className="text-xs text-dark-500">{t("install.appName")}</span>
                <p className="text-sm text-dark-100 font-medium">{apkInfo.app_name}</p>
              </div>
              <div>
                <span className="text-xs text-dark-500">{t("install.packageName")}</span>
                <p className="text-sm text-dark-300 font-mono">{apkInfo.package_name}</p>
              </div>
              <div className="flex gap-6">
                <div>
                  <span className="text-xs text-dark-500">{t("install.version")}</span>
                  <p className="text-sm text-dark-300">{apkInfo.version_name}</p>
                </div>
                <div>
                  <span className="text-xs text-dark-500">{t("install.fileSize")}</span>
                  <p className="text-sm text-dark-300">{apkInfo.file_size}</p>
                </div>
                {apkInfo.min_sdk_version != null && (
                  <div>
                    <span className="text-xs text-dark-500">{t("install.minSdk")}</span>
                    <p className="text-sm text-dark-300">{apkInfo.min_sdk_version} (SDK {apkInfo.min_sdk_version})</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 折叠详细信息 */}
          <div className="mt-4 pt-4 border-t border-dark-700/50">
            <button
              onClick={() => setShowDetails(!showDetails)}
              className="flex items-center gap-1 text-xs text-dark-400 hover:text-dark-300 transition-colors"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`transition-transform ${showDetails ? "rotate-90" : ""}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              {t("install.details")}
              {apkInfo.permissions.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 rounded bg-dark-700 text-dark-500">
                  {apkInfo.permissions.length}
                </span>
              )}
            </button>

            {showDetails && (
              <div className="mt-3 space-y-3 animate-fade-in">
                {apkInfo.permissions.length > 0 && (
                  <div>
                    <span className="text-xs text-dark-500">{t("install.permissions")}</span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {apkInfo.permissions.map((perm, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 rounded bg-dark-700 text-dark-400 text-xs"
                        >
                          {perm}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {apkInfo.version_code && (
                  <div>
                    <span className="text-xs text-dark-500">Version Code</span>
                    <p className="text-sm text-dark-300">{apkInfo.version_code}</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* SDK 版本兼容性检查 */}
          {isSdkIncompatible && (() => {
            const device = devices.find((d) => d.serial === currentDevice);
            const deviceSdk = device ? parseInt(device.sdk_version, 10) : 0;
            return (
              <div className="mt-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                <div className="flex items-start gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-red-400 mt-0.5 shrink-0">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-red-400">
                      {t("install.sdkIncompatible")}
                    </p>
                    <p className="text-xs text-red-400/70 mt-0.5">
                      {t("install.sdkIncompatibleDesc", {
                        minSdk: String(apkInfo.min_sdk_version),
                        deviceSdk: String(deviceSdk),
                      })}
                    </p>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Install Button */}
          <div className="mt-6 flex items-center gap-4">
            <div className="flex-1">
              <span className="text-xs text-dark-500">{t("install.installTo")}</span>
              <p className="text-sm text-dark-200">
                {devices.find((d) => d.serial === currentDevice)
                  ? `${devices.find((d) => d.serial === currentDevice)!.brand} ${devices.find((d) => d.serial === currentDevice)!.model}`
                  : t("device.noDevice")}
              </p>
            </div>
            <button
              onClick={handleInstall}
              disabled={!currentDevice || isSdkIncompatible}
              className="px-6 py-2.5 rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              {t("install.install")}
            </button>
          </div>
        </div>
      )}

      {renderStatus()}
    </div>
  );
};

export default InstallPage;
