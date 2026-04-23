import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeviceStore } from "../store/deviceStore";
import { useAppsStore } from "../store/appsStore";
import { hdcShell } from "../api/adb";
import { open } from "@tauri-apps/plugin-shell";
import ConfirmDialog from "../components/ConfirmDialog";
import LoadingSpinner from "../components/LoadingSpinner";

const AppsPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentDevice, devices } = useDeviceStore();
  const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";
  const {
    apps,
    isLoading,
    searchQuery,
    filterType,
    sortBy,
    selectedApp,
    fetchApps,
    fetchAppDetail,
    launchApp,
    uninstallApp,
    clearData,
    clearCache,
    clearUserData,
    setSearchQuery,
    setFilterType,
    setSortBy,
    setSelectedApp,
  } = useAppsStore();

  const [confirmAction, setConfirmAction] = useState<{
    type: "uninstall" | "clearData";
    app: { package_name: string; app_name: string };
  } | null>(null);
  const [showClearTypeDialog, setShowClearTypeDialog] = useState(false);
  const [showRawData, setShowRawData] = useState(false);
  const [showPermissionsDialog, setShowPermissionsDialog] = useState(false);
  const [permissionsData, setPermissionsData] = useState<any>(null);
  const [permissionsLoading, setPermissionsLoading] = useState(false);

  useEffect(() => {
    if (currentDevice) {
      // 只有 apps 为空时才全量加载，否则不重复获取（用户可手动刷新）
      if (apps.length === 0) {
        fetchApps(currentDevice);
      }
    }
  }, [currentDevice]);

  const filteredApps = useMemo(() => {
    let result = [...apps];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (app) =>
          app.package_name.toLowerCase().includes(q) ||
          (app.app_name && app.app_name.toLowerCase().includes(q)) ||
          (app.vendor && app.vendor.toLowerCase().includes(q))
      );
    }

    if (filterType === "system") {
      result = result.filter((app) => app.is_system);
    } else if (filterType === "third_party") {
      result = result.filter((app) => !app.is_system);
    }

    if (sortBy === "name") {
      result.sort((a, b) => a.package_name.localeCompare(b.package_name));
    } else if (sortBy === "size") {
      result.sort((a, b) => {
        const parseSize = (s: string) => {
          const num = parseFloat(s);
          if (s.includes("GB")) return num * 1024;
          if (s.includes("MB")) return num;
          if (s.includes("KB")) return num / 1024;
          return num;
        };
        return parseSize(b.app_size) - parseSize(a.app_size);
      });
    } else if (sortBy === "date") {
      result.sort(
        (a, b) =>
          new Date(b.install_time).getTime() - new Date(a.install_time).getTime()
      );
    }

    return result;
  }, [apps, searchQuery, filterType, sortBy]);

  const handleConfirmAction = async () => {
    if (!confirmAction || !currentDevice) return;
    const { type, app } = confirmAction;
    if (type === "uninstall") {
      await uninstallApp(currentDevice, app.package_name);
    } else {
      await clearData(currentDevice, app.package_name);
    }
    setConfirmAction(null);
  };

  // 获取应用权限信息
  const handleGetPermissions = async () => {
    if (!currentDevice || !selectedApp) return;
    setPermissionsLoading(true);
    try {
      const result = await hdcShell(currentDevice, `atm dump -t -b ${selectedApp.package_name}`);
      const parsed = JSON.parse(result);
      setPermissionsData(parsed);
      setShowPermissionsDialog(true);
    } catch (error) {
      console.error("Failed to get permissions:", error);
    } finally {
      setPermissionsLoading(false);
    }
  };

  if (!currentDevice) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-dark-400">{t("device.noDevice")}</p>
      </div>
    );
  }

  // 是否有鸿蒙扩展信息
  const hasHarmonyFields = currentPlatform === "harmonyos" && apps.some((a) => a.vendor || a.install_source);

  return (
    <div className="p-6 h-full flex flex-col animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <h1 className="text-xl font-semibold text-dark-100">{t("apps.appList")}</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => currentDevice && fetchApps(currentDevice)}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 disabled:opacity-50 transition-colors text-sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={isLoading ? "animate-spin" : ""}>
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {t("common.refresh")}
          </button>
          <span className="text-xs text-dark-400">
            {t("apps.appCount", { count: filteredApps.length })}
          </span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "name" | "size" | "date")}
            className="px-2 py-1 bg-dark-800 border border-dark-600 rounded text-xs text-dark-300 focus:outline-none focus:border-accent-500"
          >
            <option value="name">{t("apps.sortByName")}</option>
            <option value="size">{t("apps.sortBySize")}</option>
            <option value="date">{t("apps.sortByDate")}</option>
          </select>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-3 mb-4 flex-shrink-0">
        <div className="flex-1 relative">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-500">
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("apps.search")}
            className="w-full pl-9 pr-3 py-2 bg-dark-800/50 border border-dark-700/50 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent-500 transition-colors"
          />
        </div>
        <div className="flex bg-dark-800/50 border border-dark-700/50 rounded-lg overflow-hidden">
          {(["all", "third_party", "system"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-3 py-2 text-xs transition-colors ${
                filterType === type ? "bg-accent-500/20 text-accent-400" : "text-dark-400 hover:text-dark-300"
              }`}
            >
              {type === "all" ? t("apps.allApps") : type === "third_party" ? t("apps.thirdPartyApps") : t("apps.systemApps")}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-hidden flex gap-4">
        <div className="flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <LoadingSpinner />
            </div>
          ) : filteredApps.length === 0 ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-dark-400">{t("apps.noApps")}</p>
            </div>
          ) : (
            <div className="border border-dark-700/50 rounded-xl overflow-hidden">
              <table className="w-full text-sm" style={{ minWidth: hasHarmonyFields ? 900 : 640 }}>
                <thead className="bg-dark-800/80 sticky top-0 z-10">
                  <tr className="text-dark-400 text-xs whitespace-nowrap">
                    <th className="text-left px-3 py-3 font-medium w-10">#</th>
                    <th className="text-left px-3 py-3 font-min-w-[200px]">{t("apps.appName")}</th>
                    <th className="text-left px-3 py-3 font-medium">{t("install.version")}</th>
                    <th className="text-left px-3 py-3 font-medium">{t("apps.size")}</th>
                    <th className="text-left px-3 py-3 font-medium">{t("apps.installTime")}</th>
                    <th className="text-left px-3 py-3 font-medium whitespace-nowrap">{t("apps.type")}</th>
                    {hasHarmonyFields && (
                      <>
                        <th className="text-left px-3 py-3 font-medium whitespace-nowrap">{t("apps.vendor")}</th>
                        <th className="text-left px-3 py-3 font-medium whitespace-nowrap">{t("apps.installSource")}</th>
                      </>
                    )}
                    <th className="text-right px-3 py-3 font-medium w-20">{t("apps.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApps.map((app, idx) => (
                    <tr
                      key={app.package_name}
                      onClick={() => {
                        if (selectedApp?.package_name === app.package_name) {
                          setSelectedApp(null);
                        } else {
                          setSelectedApp(app);
                          // 如果应用没有详细信息，获取详情
                          if (!app.version_name && currentDevice) {
                            fetchAppDetail(currentDevice, app.package_name);
                          }
                        }
                      }}
                      className={`border-t border-dark-700/30 cursor-pointer transition-colors ${
                        selectedApp?.package_name === app.package_name
                          ? "bg-accent-500/10"
                          : "hover:bg-dark-800/40"
                      }`}
                    >
                      <td className="px-3 py-2 text-dark-500 text-xs whitespace-nowrap">{idx + 1}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap" title={app.package_name}>
                        {app.app_name ? (
                          <span 
                            onClick={() => open(`https://appgallery.huawei.com/search/${encodeURIComponent(app.app_name)}`)} 
                            className="text-blue-400 hover:underline font-mono cursor-pointer"
                          >
                            {app.app_name}
                          </span>
                        ) : (
                          <span className="text-dark-200 font-mono">{app.package_name}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-dark-300 text-xs whitespace-nowrap">
                        {app.version_name || "-"}
                        {app.version_code && (
                          <span className="text-dark-500 ml-1">({app.version_code})</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-dark-300 text-xs whitespace-nowrap">{app.app_size || "-"}</td>
                      <td className="px-3 py-2 text-dark-400 text-xs whitespace-nowrap">{app.install_time || "-"}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-xs whitespace-nowrap ${
                          app.is_system
                            ? "bg-yellow-500/15 text-yellow-400"
                            : "bg-blue-500/15 text-blue-400"
                        }`}>
                          {app.is_system ? t("apps.systemApps") : t("apps.thirdPartyApps")}
                        </span>
                      </td>
                      {hasHarmonyFields && (
                        <>
                          <td className="px-3 py-2 text-dark-400 text-xs whitespace-nowrap max-w-[160px] truncate" title={app.vendor}>
                            {app.vendor || "-"}
                          </td>
                          <td className="px-3 py-2 text-dark-400 text-xs whitespace-nowrap max-w-[180px] truncate" title={app.install_source}>
                            {app.install_source || "-"}
                          </td>
                        </>
                      )}
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => currentDevice && launchApp(currentDevice, app.package_name)}
                            className="p-1.5 rounded hover:bg-dark-700 text-dark-400 hover:text-accent-400 transition-colors"
                            title={t("apps.launch")}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polygon points="5 3 19 12 5 21 5 3" />
                            </svg>
                          </button>
                          <button
                            onClick={() => setConfirmAction({ type: "uninstall", app })}
                            className="p-1.5 rounded hover:bg-dark-700 text-dark-400 hover:text-red-400 transition-colors"
                            title={t("apps.uninstall")}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail Panel */}
        {selectedApp && (
          <div className="w-80 bg-dark-800/50 border border-dark-700/50 rounded-xl p-4 flex-shrink-0 overflow-y-auto animate-slide-in">
            <div className="flex flex-col items-center text-center mb-4">
              <div className="w-14 h-14 rounded-xl bg-dark-700 flex items-center justify-center text-dark-300 text-xl font-medium">
                {selectedApp.app_name.charAt(0).toUpperCase() || selectedApp.package_name.split('.').pop()?.charAt(0).toUpperCase() || "?"}
              </div>
              {selectedApp.app_name ? (
                <span 
                  onClick={() => open(`https://appgallery.huawei.com/search/${encodeURIComponent(selectedApp.app_name)}`)} 
                  className="text-sm font-semibold text-blue-400 hover:underline mt-2 break-all cursor-pointer"
                >
                  {selectedApp.app_name}
                </span>
              ) : (
                <p className="text-sm font-semibold text-dark-100 mt-2 break-all">{selectedApp.package_name}</p>
              )}
            </div>

            <div className="space-y-2.5 mb-4">
              <DetailRow label={t("apps.packageName")} value={selectedApp.package_name} />
              <DetailRow label={t("install.version")} value={`${selectedApp.version_name || "-"}${selectedApp.version_code ? ` (${selectedApp.version_code})` : ""}`} />
              <DetailRow label={t("apps.size")} value={selectedApp.app_size || "-"} />
              <DetailRow label={t("apps.installTime")} value={selectedApp.install_time || "-"} />
              <DetailRow label={t("apps.type")} value={selectedApp.is_system ? t("apps.systemApps") : t("apps.thirdPartyApps")} />

              {/* 鸿蒙扩展信息 */}
              {selectedApp.vendor && <DetailRow label={t("apps.vendor")} value={selectedApp.vendor} />}
              {selectedApp.install_source && <DetailRow label={t("apps.installSource")} value={selectedApp.install_source} />}
              {selectedApp.cpu_abi && <DetailRow label="CPU ABI" value={selectedApp.cpu_abi} />}
              {selectedApp.compile_sdk && <DetailRow label="SDK" value={selectedApp.compile_sdk} />}
              {selectedApp.code_path && <DetailRow label={t("apps.codePath")} value={selectedApp.code_path} />}
              {selectedApp.uid !== undefined && selectedApp.uid > 0 && <DetailRow label="UID" value={String(selectedApp.uid)} />}
              {selectedApp.removable !== undefined && <DetailRow label={t("apps.removable")} value={selectedApp.removable ? t("common.yes") : t("common.no")} />}
              {selectedApp.app_distribution_type && <DetailRow label={t("apps.distributionType")} value={selectedApp.app_distribution_type} />}
            </div>

            <div className="space-y-2">
              <button
                onClick={() => currentDevice && launchApp(currentDevice, selectedApp.package_name)}
                className="w-full px-3 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors text-xs font-medium"
              >
                {t("apps.launch")}
              </button>
              <button
                onClick={() => setShowClearTypeDialog(true)}
                className="w-full px-3 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-xs"
              >
                {t("apps.clearData")}
              </button>
              <button
                onClick={() => setConfirmAction({ type: "uninstall", app: selectedApp })}
                className="w-full px-3 py-2 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors text-xs"
              >
                {t("apps.uninstall")}
              </button>
              <button
                onClick={handleGetPermissions}
                disabled={currentPlatform !== "harmonyos"}
                className={`w-full px-3 py-2 rounded-lg transition-colors text-xs ${currentPlatform === "harmonyos" ? "bg-dark-700 text-dark-300 hover:bg-dark-600" : "bg-dark-700 text-dark-500 cursor-not-allowed"}`}
              >
                {t("apps.viewPermissions")}
              </button>
              {selectedApp.raw_data && (
                <button
                  onClick={() => setShowRawData(!showRawData)}
                  className="w-full px-3 py-2 rounded-lg bg-dark-700 text-dark-400 hover:bg-dark-600 transition-colors text-xs"
                >
                  {showRawData ? t("apps.hideRawData") : t("apps.showRawData")}
                </button>
              )}
            </div>
            {showRawData && selectedApp.raw_data && (
              <div className="mt-3 p-2 bg-dark-900 rounded-lg border border-dark-700/50 max-h-60 overflow-auto">
                <pre className="text-[10px] text-dark-400 whitespace-pre-wrap break-all font-mono leading-relaxed">
                  {(() => {
                    try { return JSON.stringify(JSON.parse(selectedApp.raw_data), null, 2); }
                    catch { return selectedApp.raw_data; }
                  })()}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={!!confirmAction}
        title={confirmAction?.type === "uninstall" ? t("apps.uninstall") : t("apps.clearData")}
        message={
          confirmAction?.type === "uninstall"
            ? t("apps.uninstallConfirm", { name: confirmAction?.app.app_name || confirmAction?.app.package_name })
            : t("apps.clearDataConfirm", { name: confirmAction?.app.app_name || confirmAction?.app.package_name })
        }
        variant="danger"
        confirmText={confirmAction?.type === "uninstall" ? t("apps.uninstall") : t("apps.clearData")}
        onConfirm={handleConfirmAction}
        onCancel={() => setConfirmAction(null)}
      />

      {/* 清除数据类型选择对话框 */}
      {showClearTypeDialog && selectedApp && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-dark-800 border border-dark-700 rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-dark-100 mb-4">{t("apps.selectClearType")}</h3>
            <div className="space-y-3">
              <button
                onClick={async () => {
                  if (currentDevice) {
                    await clearCache(currentDevice, selectedApp.package_name);
                  }
                  setShowClearTypeDialog(false);
                }}
                className="w-full px-4 py-3 bg-dark-700 hover:bg-dark-600 text-dark-100 rounded-lg transition-colors text-left"
              >
                <div className="font-medium">{t("apps.cacheData")}</div>
              </button>
              <button
                onClick={async () => {
                  if (currentDevice) {
                    await clearUserData(currentDevice, selectedApp.package_name);
                  }
                  setShowClearTypeDialog(false);
                }}
                className="w-full px-4 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors text-left"
              >
                <div className="font-medium">{t("apps.userData")}</div>
              </button>
            </div>
            <button
              onClick={() => setShowClearTypeDialog(false)}
              className="w-full mt-4 px-4 py-2 bg-dark-700 hover:bg-dark-600 text-dark-300 rounded-lg transition-colors"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {/* 权限查看对话框 */}
      {showPermissionsDialog && permissionsData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-dark-800 border border-dark-700 rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-dark-100">{t("apps.permissions")} - {permissionsData.bundleName}</h3>
              <button
                onClick={() => setShowPermissionsDialog(false)}
                className="p-1.5 rounded hover:bg-dark-700 text-dark-400 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {permissionsLoading ? (
              <div className="flex items-center justify-center py-8">
                <LoadingSpinner />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2 text-xs text-dark-400 border-b border-dark-700 pb-2">
                  <div className="font-medium">{t("apps.permissionName")}</div>
                  <div className="font-medium text-center">{t("apps.grantStatus")}</div>
                  <div className="font-medium text-center">{t("apps.grantFlag")}</div>
                </div>
                {permissionsData.permStateList.map((perm: any, index: number) => (
                  <div key={index} className="grid grid-cols-3 gap-2 text-xs">
                    <div className="text-dark-200 break-all">{translatePermission(perm.permissionName)}</div>
                    <div className="text-center">
                      <span className={perm.grantStatus === 0 ? "text-green-400" : "text-red-400"}>
                        {perm.grantStatus === 0 ? t("apps.granted") : t("apps.denied")}
                      </span>
                    </div>
                    <div className="text-center text-dark-300">{perm.grantFlag}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/** 详情面板的键值对行 */
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-xs text-dark-500 flex-shrink-0">{label}</span>
      <span className="text-xs text-dark-300 text-right break-all">{value}</span>
    </div>
  );
}

/** 权限名称翻译函数 */
function translatePermission(permissionName: string): string {
  const permissionMap: Record<string, string> = {
    // 开放权限（系统授权）
    "ohos.permission.USE_BLUETOOTH": "查看蓝牙配置",
    "ohos.permission.GET_BUNDLE_INFO": "查询应用基本信息",
    "ohos.permission.PREPARE_APP_TERMINATE": "应用关闭前执行预关闭动作",
    "ohos.permission.PRINT": "获取打印框架能力",
    "ohos.permission.DISCOVER_BLUETOOTH": "配置本地蓝牙并查找远端设备",
    "ohos.permission.ACCELEROMETER": "读取加速度传感器数据",
    "ohos.permission.ACCESS_BIOMETRIC": "使用生物特征识别能力进行身份认证",
    "ohos.permission.ACCESS_NOTIFICATION_POLICY": "访问通知策略",
    "ohos.permission.GET_NETWORK_INFO": "获取数据网络信息",
    "ohos.permission.SET_NETWORK_INFO": "配置数据网络",
    "ohos.permission.GET_WIFI_INFO": "获取Wi-Fi信息和使用P2P能力",
    "ohos.permission.GYROSCOPE": "读取陀螺仪传感器数据",
    "ohos.permission.INTERNET": "使用Internet网络",
    "ohos.permission.KEEP_BACKGROUND_RUNNING": "Service Ability在后台持续运行",
    "ohos.permission.NFC_CARD_EMULATION": "实现卡模拟功能",
    "ohos.permission.NFC_TAG": "读写Tag卡片",
    "ohos.permission.PRIVACY_WINDOW": "将窗口设置为隐私窗口，禁止截屏录屏",
    "ohos.permission.PUBLISH_AGENT_REMINDER": "使用后台代理提醒",
    "ohos.permission.SET_WIFI_INFO": "配置Wi-Fi设备",
    "ohos.permission.VIBRATE": "控制马达振动",
    "ohos.permission.CLEAN_BACKGROUND_PROCESSES": "识别并清理相关后台进程",
    "ohos.permission.COMMONEVENT_STICKY": "发布粘性公共事件",
    "ohos.permission.ACCESS_CERT_MANAGER": "查询证书及私有凭据等操作",
    "ohos.permission.RUN_DYN_CODE": "在受限模式下执行动态下发的方舟字节码",
    "ohos.permission.READ_CLOUD_SYNC_CONFIG": "查询应用云同步相关配置信息",
    "ohos.permission.STORE_PERSISTENT_DATA": "存储持久化数据",
    "ohos.permission.ACCESS_EXTENSIONAL_DEVICE_DRIVER": "使用外接设备增强功能",
    "ohos.permission.READ_ACCOUNT_LOGIN_STATE": "读取用户账号的登录状态",
    "ohos.permission.ACCESS_SERVICE_NAVIGATION_INFO": "访问导航信息服务",
    "ohos.permission.PROTECT_SCREEN_LOCK_DATA": "在锁屏后保护本应用敏感数据",
    "ohos.permission.ACCESS_CAR_DISTRIBUTED_ENGINE": "访问出行分布式业务引擎",
    "ohos.permission.WINDOW_TOPMOST": "将窗口设置为应用置顶窗口",
    "ohos.permission.MANAGE_INPUT_INFRARED_EMITTER": "使用红外接口",
    "ohos.permission.INPUT_KEYBOARD_CONTROLLER": "设置键盘功能键状态",
    "ohos.permission.SET_ABILITY_INSTANCE_INFO": "单独配置每个Ability的图标和标签信息",
    "ohos.permission.NDK_START_SELF_UI_ABILITY": "通过C API启动同应用的UIAbility",
    "ohos.permission.GET_FILE_ICON": "获取指定类型文件的文件图标",
    "ohos.permission.DETECT_GESTURE": "感知手势操作",
    "ohos.permission.kernel.NET_RAW": "抓取网络数据包",
    "ohos.permission.kernel.DEBUGGER": "获取调试能力",
    "ohos.permission.kernel.ALLOW_DEBUG": "允许C/C++程序被调试",
    "ohos.permission.BACKGROUND_MANAGER_POWER_SAVE_MODE": "设置自身进程的省电模式",
    "ohos.permission.SET_WINDOW_TRANSPARENT": "设置主窗容器透明和去除主窗外边框阴影",
    "ohos.permission.START_WINDOW_BELOW_LOCK_SCREEN": "在锁屏状态下被启动",
    "ohos.permission.kernel.IGNORE_LIBRARY_VALIDATION": "加载具有不同ownerid的独立二进制SO",
    "ohos.permission.TIMEOUT_SCREENOFF_DISABLE_LOCK": "使能超时息屏不锁屏功能",
    "ohos.permission.LOCK_WINDOW_CURSOR": "在窗口获焦时锁定鼠标光标",
    "ohos.permission.CUSTOMIZE_MENU_ICON": "在\"文件管理\"的右键菜单中配置自定义图标",
    "ohos.permission.kernel.EXEMPT_ANONYMOUS_EXECUTABLE_MEMORY": "声明匿名可执行内存",
    "ohos.permission.INHERIT_PARENT_PERMISSION": "子进程继承父进程的权限",
    "ohos.permission.GET_DONOTDISTURB_STATE": "获取系统的免打扰状态",
    "ohos.permission.ALLOW_COREDUMP": "将应用进程的内存转储到应用沙箱",
    
    // 开放权限（用户授权）
    "ohos.permission.ACCESS_BLUETOOTH": "接入蓝牙并使用蓝牙功能",
    "ohos.permission.MEDIA_LOCATION": "访问用户媒体文件中的地理位置信息",
    "ohos.permission.APP_TRACKING_CONSENT": "读取开放匿名设备标识符",
    "ohos.permission.ACTIVITY_MOTION": "读取用户的运动状态",
    "ohos.permission.CAMERA": "使用相机",
    "ohos.permission.DISTRIBUTED_DATASYNC": "不同设备间的数据交换",
    "ohos.permission.LOCATION_IN_BACKGROUND": "在后台运行时获取设备位置信息",
    "ohos.permission.LOCATION": "获取设备位置信息",
    "ohos.permission.APPROXIMATELY_LOCATION": "获取设备模糊位置信息",
    "ohos.permission.MICROPHONE": "使用麦克风",
    "ohos.permission.READ_CALENDAR": "读取日历信息",
    "ohos.permission.WRITE_CALENDAR": "添加、移除或更改日历活动",
    "ohos.permission.READ_HEALTH_DATA": "读取用户的健康数据",
    "ohos.permission.ACCESS_NEARLINK": "接入星闪并使用星闪能力",
    "ohos.permission.READ_WRITE_DOWNLOAD_DIRECTORY": "访问公共目录下Download目录及子目录",
    "ohos.permission.READ_WRITE_DOCUMENTS_DIRECTORY": "访问公共目录下的Documents目录及子目录",
    "ohos.permission.CUSTOM_SCREEN_CAPTURE": "获取屏幕图像",
    "ohos.permission.READ_MEDIA": "读取用户外部存储中的媒体文件信息",
    "ohos.permission.WRITE_MEDIA": "读写用户外部存储中的媒体文件信息",
    
    // 受限开放权限
    "ohos.permission.SYSTEM_FLOAT_WINDOW": "使用悬浮窗的能力",
    "ohos.permission.READ_CONTACTS": "读取联系人数据",
    "ohos.permission.WRITE_CONTACTS": "添加、移除或更改联系人数据",
    "ohos.permission.READ_AUDIO": "读取用户公共目录的音频文件",
    "ohos.permission.WRITE_AUDIO": "修改用户公共目录的音频文件",
    "ohos.permission.READ_IMAGEVIDEO": "读取用户公共目录的图片或视频文件",
    "ohos.permission.WRITE_IMAGEVIDEO": "修改用户公共目录的图片或视频文件",
    "ohos.permission.READ_WRITE_DESKTOP_DIRECTORY": "访问公共目录下Desktop目录及子目录",
    "ohos.permission.ACCESS_DDK_USB": "扩展外设驱动访问USB DDK接口",
    "ohos.permission.ACCESS_DDK_HID": "扩展外设驱动访问HID DDK接口",
    "ohos.permission.READ_PASTEBOARD": "读取剪贴板",
    "ohos.permission.FILE_ACCESS_PERSIST": "支持持久化访问文件Uri",
    "ohos.permission.INTERCEPT_INPUT_EVENT": "拦截输入事件",
    "ohos.permission.INPUT_MONITORING": "监听输入事件",
    "ohos.permission.SHORT_TERM_WRITE_IMAGEVIDEO": "保存图片、视频到用户公共目录",
    "ohos.permission.READ_WRITE_USER_FILE": "访问并修改用户目录下的文件",
    "ohos.permission.READ_WRITE_USB_DEV": "连接设备并通过USB调试读写该设备",
    "ohos.permission.GET_WIFI_PEERS_MAC": "获取对端Wi-Fi设备的MAC地址",
    "ohos.permission.SET_TELEPHONY_ESIM_STATE_OPEN": "运营商应用添加eSIM配置文件",
    "ohos.permission.kernel.DISABLE_CODE_MEMORY_PROTECTION": "禁用本应用的代码运行时完整性保护",
    "ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY": "申请可写可执行匿名内存",
    "ohos.permission.kernel.ALLOW_EXECUTABLE_FORT_MEMORY": "系统JS引擎申请带MAP_FORT标识的匿名可执行内存",
    "ohos.permission.MANAGE_PASTEBOARD_APP_SHARE_OPTION": "设置或移除剪贴板数据的可粘贴范围",
    "ohos.permission.MANAGE_UDMF_APP_SHARE_OPTION": "设置或移除其使用UDMF支持的数据分享范围",
    "ohos.permission.ACCESS_DISK_PHY_INFO": "获取硬盘的硬件信息",
    "ohos.permission.PRELOAD_FILE": "预加载文件以提升文件打开速度",
    "ohos.permission.SET_PAC_URL": "设置代理自动配置脚本地址",
    "ohos.permission.PERSONAL_MANAGE_RESTRICTIONS": "个人管理限制",
    "ohos.permission.START_PROVISIONING_MESSAGE": "启动配置消息",
    "ohos.permission.USE_FRAUD_CALL_LOG_PICKER": "使用欺诈通话记录选择器",
    "ohos.permission.USE_FRAUD_MESSAGES_PICKER": "使用欺诈消息选择器",
    "ohos.permission.PERSISTENT_BLUETOOTH_PEERS_MAC": "持久化蓝牙对等设备MAC地址",
    "ohos.permission.ACCESS_VIRTUAL_SCREEN": "访问虚拟屏幕",
    "ohos.permission.MANAGE_APN_SETTING": "管理APN设置",
    "ohos.permission.GET_WIFI_LOCAL_MAC": "获取WiFi本地MAC地址",
    "ohos.permission.kernel.ALLOW_USE_JITFORT_INTERFACE": "使用JITFORT接口",
    "ohos.permission.GET_ETHERNET_LOCAL_MAC": "获取以太网本地MAC地址",
    "ohos.permission.kernel.DISABLE_GOTPLT_RO_PROTECTION": "禁用GOTPLT只读保护",
    "ohos.permission.USE_FRAUD_APP_PICKER": "使用欺诈应用选择器",
    "ohos.permission.ACCESS_DDK_DRIVERS": "访问DDK驱动",
    "ohos.permission.ACCESS_DDK_SCSI_PERIPHERAL": "访问DDK SCSI外设",
    "ohos.permission.kernel.SUPPORT_PLUGIN": "支持插件",
    "ohos.permission.CUSTOM_SANDBOX": "自定义沙箱",
    "ohos.permission.MANAGE_SCREEN_TIME_GUARD": "管理屏幕时间保护",
    "ohos.permission.CUSTOMIZE_SAVE_BUTTON": "自定义保存按钮",
    "ohos.permission.GET_ABILITY_INFO": "获取Ability信息",
    "ohos.permission.ACCESS_FIDO2_ONLINEAUTH": "访问FIDO2在线认证",
    "ohos.permission.USE_FLOAT_BALL": "使用悬浮球",
    "ohos.permission.DLP_GET_HIDE_STATUS": "获取DLP隐藏状态",
    "ohos.permission.READ_LOCAL_DEVICE_NAME": "读取本地设备名称",
    "ohos.permission.KEEP_BACKGROUND_RUNNING_SYSTEM": "系统在后台持续运行",
    "ohos.permission.LINKTURBO": "LinkTurbo",
    "ohos.permission.ACCESS_NET_TRACE_INFO": "访问网络跟踪信息",
    "ohos.permission.READ_WHOLE_CALENDAR": "读取完整日历",
    "ohos.permission.WRITE_WHOLE_CALENDAR": "写入完整日历",
    "ohos.permission.SET_SYSTEMSHARE_APPLAUNCHTRUSTLIST": "设置系统共享应用启动信任列表",
    "ohos.permission.HOOK_KEY_EVENT": "钩子键盘事件",
    "ohos.permission.WEB_NATIVE_MESSAGING": "Web原生消息传递",
    "ohos.permission.SUBSCRIBE_NOTIFICATION": "订阅通知",
    "ohos.permission.CUSTOM_SCREEN_RECORDING": "自定义屏幕录制",
    "ohos.permission.GET_IP_MAC_INFO": "获取IP MAC信息",
    "ohos.permission.ACCESS_USER_FULL_DISK": "访问用户完整磁盘",
    "ohos.permission.kernel.LOAD_INDEPENDENT_LIBRARY": "加载独立库",
    "ohos.permission.CRYPTO_EXTENSION_REGISTER": "加密扩展注册",
    
    // 企业类应用可用权限
    "ohos.permission.SET_FILE_GUARD_POLICY": "下发文件管控策略",
    "ohos.permission.FILE_GUARD_MANAGER": "进行公共目录扫描及设置文件扩展属性",
    "ohos.permission.FILE_GUARD_FILE_WRITE": "修改文件",
    "ohos.permission.INTERACT_ACROSS_LOCAL_ACCOUNTS": "跨系统本地账号交互",
    "ohos.permission.GET_RUNNING_INFO": "获取运行态信息",
    "ohos.permission.RUNNING_STATE_OBSERVER": "监听应用状态",
    "ohos.permission.GET_BUNDLE_INFO_PRIVILEGED": "查询应用的基本信息和其他敏感信息",
    "ohos.permission.GET_WIFI_CONFIG": "获取Wi-Fi的配置信息",
    "ohos.permission.SET_WIFI_CONFIG": "配置Wi-Fi信息",
    "ohos.permission.GET_DOMAIN_ACCOUNTS": "查询域账号信息",
    "ohos.permission.QUERY_AUDIT_EVENT": "查询安全审计事件",
    "ohos.permission.KILL_APP_PROCESSES": "结束其他应用进程",
    "ohos.permission.MANAGE_ENTERPRISE_WIFI_CONNECTION": "管理Wi-Fi的连接",
    "ohos.permission.ACCESS_ENTERPRISE_USER_TRUSTED_CERT": "管理企业设备的用户CA证书",
    "ohos.permission.MANAGE_NET_FIREWALL": "配置防火墙规则",
    "ohos.permission.GET_NET_FIREWALL": "查询防火墙规则和查询防火墙拦截记录",
    "ohos.permission.GET_DOMAIN_ACCOUNT_SERVER_CONFIGS": "获取域账号服务器配置",
    "ohos.permission.MANAGE_DOMAIN_ACCOUNT_SERVER_CONFIGS": "管理域账号服务器配置",
    "ohos.permission.MANAGE_DOMAIN_ACCOUNTS": "管理域账号",
    "ohos.permission.GET_SIGNATURE_INFO": "获取应用包的签名信息",
    "ohos.permission.VISIBLE_WINDOW_INFO": "获取当前屏幕的可见窗口信息",
    "ohos.permission.kernel.AUTH_AUDIT_EVENT": "阻断安全审计事件",
    "ohos.permission.SUPPORT_APP_SERVICE_EXTENSION": "作为AppServiceExtension被拉起",
    "ohos.permission.ENTERPRISE_MANAGE_EAP": "在EAP报文中新增私有信息",
    "ohos.permission.SUPPORT_INSTALL_ON_U1": "安装在特定用户下",
    "ohos.permission.QUERY_LOCAL_WORKSPACES": "查询工作空间和不允许删除的空间列表",
    "ohos.permission.SET_NET_EXT_ATTRIBUTE": "设置网络扩展属性",
    "ohos.permission.MANAGE_ANTIVIRUS": "管理防病毒软件",
    "ohos.permission.REGISTER_ANTIVIRUS": "向系统注册、更新基本信息",
    "ohos.permission.CALL_TPM_CMD": "调用TPM（Trusted Platform Module）命令",
    "ohos.permission.ENTERPRISE_WORKSPACES_EVENT_SUBSCRIBE": "订阅企业数字空间相关事件",
    "ohos.permission.sec.ACCESS_UDID": "获取UDID",
    
    // 仅MDM应用可用权限
    "ohos.permission.ENTERPRISE_GET_DEVICE_INFO": "激活设备管理应用",
    "ohos.permission.ENTERPRISE_GET_NETWORK_INFO": "查询网络信息",
    "ohos.permission.ENTERPRISE_INSTALL_BUNDLE": "安装和卸载包",
    "ohos.permission.ENTERPRISE_MANAGE_SET_APP_RUNNING_POLICY": "设置应用运行管理策略",
    "ohos.permission.ENTERPRISE_RESET_DEVICE": "恢复设备出厂设置",
    "ohos.permission.ENTERPRISE_SET_ACCOUNT_POLICY": "设置账户管理策略",
    "ohos.permission.ENTERPRISE_SET_BUNDLE_INSTALL_POLICY": "设置包安装管理策略",
    "ohos.permission.ENTERPRISE_SET_DATETIME": "设置系统时间",
    "ohos.permission.ENTERPRISE_SET_NETWORK": "设置网络信息",
    "ohos.permission.ENTERPRISE_SET_WIFI": "设置和查询WiFi信息",
    "ohos.permission.ENTERPRISE_SUBSCRIBE_MANAGED_EVENT": "订阅管理事件",
    "ohos.permission.ENTERPRISE_RESTRICT_POLICY": "下发和获取限制类策略",
    "ohos.permission.ENTERPRISE_SET_SCREENOFF_TIME": "设置系统休眠时间",
    "ohos.permission.ENTERPRISE_MANAGE_USB": "管理USB",
    "ohos.permission.ENTERPRISE_MANAGE_NETWORK": "管理网络",
    "ohos.permission.ENTERPRISE_MANAGE_CERTIFICATE": "管理证书",
    "ohos.permission.ENTERPRISE_GET_SETTINGS": "查询\"设置\"应用数据",
    "ohos.permission.ENTERPRISE_SET_BROWSER_POLICY": "设置/取消浏览器策略",
    "ohos.permission.SET_ENTERPRISE_INFO": "设置企业信息",
    "ohos.permission.ENTERPRISE_MANAGE_SECURITY": "设置安全管理策略",
    "ohos.permission.ENTERPRISE_MANAGE_BLUETOOTH": "设置和查询蓝牙信息",
    "ohos.permission.ENTERPRISE_MANAGE_SYSTEM": "管理系统设置参数策略",
    "ohos.permission.ENTERPRISE_MANAGE_WIFI": "设置和查询WIFI信息",
    "ohos.permission.ENTERPRISE_MANAGE_RESTRICTIONS": "管理限制策略",
    "ohos.permission.ENTERPRISE_MANAGE_APPLICATION": "管理应用策略",
    "ohos.permission.ENTERPRISE_MANAGE_LOCATION": "设置和查询位置信息",
    "ohos.permission.ENTERPRISE_REBOOT": "进行关机重启操作",
    "ohos.permission.ENTERPRISE_LOCK_DEVICE": "锁定设备",
    "ohos.permission.ENTERPRISE_MANAGE_SETTINGS": "管理设置",
    "ohos.permission.ENTERPRISE_OPERATE_DEVICE": "操作设备",
    "ohos.permission.ENTERPRISE_ADMIN_MANAGE": "管理设备管理应用",
    "ohos.permission.ENTERPRISE_RECOVERY_KEY": "管理企业级恢复密钥",
    "ohos.permission.ENTERPRISE_MANAGE_DELEGATED_POLICY": "委托其他应用设置设备管控策略",
    "ohos.permission.ENTERPRISE_GET_ALL_BUNDLE_INFO": "获取设备所有应用信息",
    "ohos.permission.ENTERPRISE_SET_USER_RESTRICTION": "限制用户修改系统设置",
    "ohos.permission.ENTERPRISE_MANAGE_APN": "管理设备APN策略",
    "ohos.permission.ENTERPRISE_MANAGE_TELEPHONY": "管理设备通话策略",
    "ohos.permission.ENTERPRISE_SET_KIOSK": "设置Kiosk模式",
    "ohos.permission.ENTERPRISE_MANAGE_LOCAL_PUBLICSPACES": "启用、创建、删除工作空间",
    "ohos.permission.ENTERPRISE_FILE_TRANSFER_AUDIT_POLICY_MANAGEMENT": "管理文件传输的策略和审计信息",
    "ohos.permission.ENTERPRISE_SET_WALLPAPER": "设置壁纸",
    "ohos.permission.MANAGE_PREINSTALLED_ANTIVIRUS": "管理系统预装的防病毒软件",
    "ohos.permission.ENTERPRISE_MANAGE_USER_GRANT_PERMISSION": "设置user_grant类权限策略",
    "ohos.permission.ENTERPRISE_DATA_IDENTIFY_FILE": "识别文件敏感内容",
    "ohos.permission.ENTERPRISE_ACCESS_DLP_FILE": "生成、解密DLP文件，查询DLP文件策略"
  };
  
  return permissionMap[permissionName] || permissionName;
}

export default AppsPage;
