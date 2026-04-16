import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { checkHdcAvailable, getHdcPath, setHdcPath } from "../api/adb";
import ConnectionGuide from "../components/ConnectionGuide";

const SettingsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [showGuide, setShowGuide] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hdcPath, setHdcPathState] = useState("");
  const [hdcAvailable, setHdcAvailable] = useState<boolean | null>(null);
  const [hdcChecking, setHdcChecking] = useState(false);

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem("language", lang);
    showSaved();
  };

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // HDC 初始化
  useEffect(() => {
    const initHdc = async () => {
      try {
        const path = await getHdcPath();
        setHdcPathState(path);
        const available = await checkHdcAvailable();
        setHdcAvailable(available);
      } catch {
        setHdcAvailable(false);
      }
    };
    initHdc();
  }, []);

  const handleHdcPathChange = async (newPath: string) => {
    setHdcPathState(newPath);
    try {
      await setHdcPath(newPath);
      setHdcChecking(true);
      const available = await checkHdcAvailable();
      setHdcAvailable(available);
    } catch {
      setHdcAvailable(false);
    } finally {
      setHdcChecking(false);
    }
  };

  const handleBrowseHdc = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "HDC Executable", extensions: ["exe", ""] }],
      });
      if (selected && typeof selected === "string") {
        await handleHdcPathChange(selected);
        showSaved();
      }
    } catch {
      // user cancelled
    }
  };

  return (
    <div className="p-6 max-w-2xl mx-auto animate-fade-in">
      <h1 className="text-xl font-semibold text-dark-100 mb-6">
        {t("nav.settings")}
      </h1>

      {/* Saved Toast */}
      {saved && (
        <div className="fixed top-16 right-4 z-50 px-4 py-2 bg-green-500/20 border border-green-500/30 rounded-lg text-sm text-green-400 animate-fade-in">
          {t("settings.saved")}
        </div>
      )}

      <div className="space-y-6">
        {/* Language */}
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">
            {t("settings.language")}
          </h3>
          <div className="flex gap-3">
            <button
              onClick={() => changeLanguage("zh")}
              className={`flex-1 px-4 py-3 rounded-lg border text-sm transition-colors ${
                i18n.language === "zh"
                  ? "border-accent-500 bg-accent-500/10 text-accent-400"
                  : "border-dark-600 bg-dark-700/50 text-dark-300 hover:border-dark-500"
              }`}
            >
              <span className="block font-medium">{t("settings.chinese")}</span>
              <span className="text-xs opacity-60 mt-0.5 block">简体中文</span>
            </button>
            <button
              onClick={() => changeLanguage("en")}
              className={`flex-1 px-4 py-3 rounded-lg border text-sm transition-colors ${
                i18n.language === "en"
                  ? "border-accent-500 bg-accent-500/10 text-accent-400"
                  : "border-dark-600 bg-dark-700/50 text-dark-300 hover:border-dark-500"
              }`}
            >
              <span className="block font-medium">{t("settings.english")}</span>
              <span className="text-xs opacity-60 mt-0.5 block">English</span>
            </button>
          </div>
        </div>

        {/* Theme */}
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">
            {t("settings.theme")}
          </h3>
          <div className="flex gap-3">
            <button className="flex-1 px-4 py-3 rounded-lg border border-accent-500 bg-accent-500/10 text-accent-400 text-sm transition-colors">
              <span className="block font-medium">{t("settings.darkTheme")}</span>
              <span className="text-xs opacity-60 mt-0.5 block">Default</span>
            </button>
            <button className="flex-1 px-4 py-3 rounded-lg border border-dark-600 bg-dark-700/50 text-dark-500 text-sm cursor-not-allowed">
              <span className="block font-medium">{t("settings.lightTheme")}</span>
              <span className="text-xs opacity-60 mt-0.5 block">Coming soon</span>
            </button>
          </div>
        </div>

        {/* Connection Guide */}
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">
            {t("settings.connectionGuide")}
          </h3>
          <p className="text-sm text-dark-400 mb-4">
            {t("settings.developerOptions")} / {t("settings.usbDebugging")} /{" "}
            {t("settings.wifiDebugging")}
          </p>
          <button
            onClick={() => setShowGuide(true)}
            className="px-4 py-2 rounded-lg bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 transition-colors text-sm"
          >
            {t("device.connectionGuide")}
          </button>
        </div>

        {/* HDC Path Configuration */}
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">
            HDC (HarmonyOS Device Connector)
          </h3>
          <div className="space-y-4">
            {/* HDC Status */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-dark-400">HDC Status</span>
              <div className="flex items-center gap-2">
                {hdcChecking && (
                  <div className="w-2 h-2 bg-accent-500 rounded-full animate-pulse" />
                )}
                {hdcAvailable === true && (
                  <span className="flex items-center gap-1.5 text-sm text-green-400">
                    <div className="w-2 h-2 rounded-full bg-green-400" />
                    Available
                  </span>
                )}
                {hdcAvailable === false && (
                  <span className="flex items-center gap-1.5 text-sm text-red-400">
                    <div className="w-2 h-2 rounded-full bg-red-400" />
                    Not Available
                  </span>
                )}
                {hdcAvailable === null && !hdcChecking && (
                  <span className="text-sm text-dark-500">Checking...</span>
                )}
              </div>
            </div>
            {/* HDC Path Input */}
            <div>
              <label className="block text-xs text-dark-500 mb-1.5">HDC Path</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={hdcPath}
                  onChange={(e) => handleHdcPathChange(e.target.value)}
                  placeholder="hdc or /path/to/hdc"
                  className="flex-1 px-3 py-2 bg-dark-900 border border-dark-700/50 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent-500 transition-colors font-mono"
                />
                <button
                  onClick={handleBrowseHdc}
                  className="px-4 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm whitespace-nowrap"
                >
                  Browse
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* About */}
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">
            {t("settings.about")}
          </h3>
          <div className="space-y-3">
            <div className="flex justify-between">
              <span className="text-sm text-dark-400">{t("app.title")}</span>
              <span className="text-sm text-dark-300">v1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-dark-400">{t("settings.version")}</span>
              <span className="text-sm text-dark-300">1.0.0</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-dark-400">Tauri</span>
              <span className="text-sm text-dark-300">v2.x</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-dark-400">React</span>
              <span className="text-sm text-dark-300">18.x</span>
            </div>
          </div>
        </div>
      </div>

      <ConnectionGuide isOpen={showGuide} onClose={() => setShowGuide(false)} />
    </div>
  );
};

export default SettingsPage;
