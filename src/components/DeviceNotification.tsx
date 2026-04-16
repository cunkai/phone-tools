import { useDeviceStore } from "../store/deviceStore";
import { useTranslation } from "react-i18next";

export default function DeviceNotification() {
  const { t } = useTranslation();
  const notification = useDeviceStore((s) => s.notification);
  const setCurrentDevice = useDeviceStore((s) => s.setCurrentDevice);
  const dismissNotification = useDeviceStore((s) => s.dismissNotification);

  if (!notification) return null;

  const handleConnect = () => {
    setCurrentDevice(notification.serial);
  };

  const deviceName = `${notification.brand} ${notification.model}`.trim() || notification.serial;
  const platformLabel = notification.platform === "harmonyos" ? "HarmonyOS" : "Android";

  return (
    <div className="fixed top-4 right-4 z-50 animate-slide-in">
      <div className="bg-dark-800 border border-dark-600 rounded-lg shadow-2xl p-4 min-w-[280px] max-w-[360px]">
        <div className="flex items-start gap-3">
          {/* 设备图标 */}
          <div className="w-10 h-10 rounded-lg bg-accent-500/20 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-accent-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>

          {/* 内容 */}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-dark-100 truncate">{deviceName}</p>
            <p className="text-xs text-dark-400 mt-0.5">
              {platformLabel} {t("device.connected")}
            </p>
            <div className="flex gap-2 mt-2">
              <button
                onClick={handleConnect}
                className="px-3 py-1 bg-accent-500 hover:bg-accent-600 text-white text-xs rounded-md transition-colors"
              >
                {t("device.connectNow")}
              </button>
              <button
                onClick={dismissNotification}
                className="px-3 py-1 bg-dark-700 hover:bg-dark-600 text-dark-300 text-xs rounded-md transition-colors"
              >
                {t("common.dismiss")}
              </button>
            </div>
          </div>

          {/* 关闭按钮 */}
          <button
            onClick={dismissNotification}
            className="text-dark-500 hover:text-dark-300 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
