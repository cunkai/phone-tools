import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDeviceStore } from "../store/deviceStore";
import { useAppsStore } from "../store/appsStore";
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
    launchApp,
    uninstallApp,
    clearData,
    setSearchQuery,
    setFilterType,
    setSortBy,
    setSelectedApp,
    prioritizeApp,
  } = useAppsStore();

  const [confirmAction, setConfirmAction] = useState<{
    type: "uninstall" | "clearData";
    app: { package_name: string; app_name: string };
  } | null>(null);
  const [showRawData, setShowRawData] = useState(false);

  useEffect(() => {
    if (currentDevice) {
      fetchApps(currentDevice);
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
      result.sort((a, b) => a.app_name.localeCompare(b.app_name) || a.package_name.localeCompare(b.package_name));
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
              <table className="w-full text-sm">
                <thead className="bg-dark-800/80 sticky top-0 z-10">
                  <tr className="text-dark-400 text-xs">
                    <th className="text-left px-4 py-3 font-medium w-8">#</th>
                    <th className="text-left px-4 py-3 font-medium">{t("apps.appName")}</th>
                    <th className="text-left px-4 py-3 font-medium">{t("apps.packageName")}</th>
                    <th className="text-left px-4 py-3 font-medium">{t("install.version")}</th>
                    <th className="text-left px-4 py-3 font-medium">{t("apps.size")}</th>
                    <th className="text-left px-4 py-3 font-medium">{t("apps.installTime")}</th>
                    <th className="text-left px-4 py-3 font-medium">{t("apps.type")}</th>
                    {hasHarmonyFields && (
                      <>
                        <th className="text-left px-4 py-3 font-medium">{t("apps.vendor")}</th>
                        <th className="text-left px-4 py-3 font-medium">{t("apps.installSource")}</th>
                      </>
                    )}
                    <th className="text-right px-4 py-3 font-medium w-24">{t("apps.actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredApps.map((app, idx) => (
                    <tr
                      key={app.package_name}
                      onClick={() => {
                        setSelectedApp(selectedApp?.package_name === app.package_name ? null : app);
                        // 如果该应用还没有详情，优先加载
                        if (!app.version_name && currentPlatform === "harmonyos") {
                          prioritizeApp(app.package_name);
                        }
                      }}
                      className={`border-t border-dark-700/30 cursor-pointer transition-colors ${
                        selectedApp?.package_name === app.package_name
                          ? "bg-accent-500/10"
                          : "hover:bg-dark-800/40"
                      }`}
                    >
                      <td className="px-4 py-2.5 text-dark-500 text-xs">{idx + 1}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded bg-dark-700 flex items-center justify-center text-dark-400 text-xs font-medium flex-shrink-0">
                            {(app.app_name || app.package_name).split('.').pop()?.charAt(0).toUpperCase() || "?"}
                          </div>
                          <span className="text-dark-200 font-medium truncate max-w-[180px]">{app.app_name || app.package_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-dark-400 font-mono text-xs truncate max-w-[200px]" title={app.package_name}>
                        {app.package_name}
                      </td>
                      <td className="px-4 py-2.5 text-dark-300 text-xs whitespace-nowrap">
                        {app.version_name || "-"}
                        {app.version_code && (
                          <span className="text-dark-500 ml-1">({app.version_code})</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-dark-300 text-xs whitespace-nowrap">{app.app_size || "-"}</td>
                      <td className="px-4 py-2.5 text-dark-400 text-xs whitespace-nowrap">{app.install_time || "-"}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-xs ${
                          app.is_system
                            ? "bg-yellow-500/15 text-yellow-400"
                            : "bg-blue-500/15 text-blue-400"
                        }`}>
                          {app.is_system ? t("apps.systemApps") : t("apps.thirdPartyApps")}
                        </span>
                      </td>
                      {hasHarmonyFields && (
                        <>
                          <td className="px-4 py-2.5 text-dark-400 text-xs truncate max-w-[120px]" title={app.vendor}>
                            {app.vendor || "-"}
                          </td>
                          <td className="px-4 py-2.5 text-dark-400 text-xs truncate max-w-[140px]" title={app.install_source}>
                            {app.install_source || "-"}
                          </td>
                        </>
                      )}
                      <td className="px-4 py-2.5 text-right">
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
                {(selectedApp.app_name || selectedApp.package_name).split('.').pop()?.charAt(0).toUpperCase() || "?"}
              </div>
              <h3 className="text-sm font-semibold text-dark-100 mt-2">{selectedApp.app_name || selectedApp.package_name}</h3>
              <p className="text-xs text-dark-500 font-mono mt-0.5 break-all">{selectedApp.package_name}</p>
            </div>

            <div className="space-y-2.5 mb-4">
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
                onClick={() => currentDevice && clearData(currentDevice, selectedApp.package_name)}
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

export default AppsPage;
