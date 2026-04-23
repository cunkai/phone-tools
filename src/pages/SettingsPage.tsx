import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { checkHdcAvailable, getHdcPath, setHdcPath, checkAdbAvailable, getAdbVersion, getHdcVersion } from "../api/adb";
import ConnectionGuide from "../components/ConnectionGuide";
import { useAppStore } from "../store/appStore";

const SettingsPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useAppStore();
  const [showGuide, setShowGuide] = useState(false);
  const [saved, setSaved] = useState(false);
  // ADB 路径
  const [adbPath, setAdbPathState] = useState("");
  const [adbAvailable, setAdbAvailable] = useState<boolean | null>(null);
  const [adbChecking, setAdbChecking] = useState(false);
  const [adbVersion, setAdbVersion] = useState("");
  // HDC 路径
  const [hdcPath, setHdcPathState] = useState("");
  const [hdcAvailable, setHdcAvailable] = useState<boolean | null>(null);
  const [hdcChecking, setHdcChecking] = useState(false);
  const [hdcVersion, setHdcVersion] = useState("");

  const changeLanguage = (lang: string) => {
    i18n.changeLanguage(lang);
    localStorage.setItem("language", lang);
    showSaved();
  };

  const showSaved = () => {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // 工具路径初始化
  useEffect(() => {
    const initTools = async () => {
      // 初始化 ADB 路径
      try {
        const adbPath = await invoke<string>("get_adb_path");
        setAdbPathState(adbPath);
        const adbAvailable = await checkAdbAvailable();
        setAdbAvailable(adbAvailable);
        if (adbAvailable) {
          const version = await getAdbVersion();
          setAdbVersion(version);
        }
      } catch {
        setAdbAvailable(false);
      }

      // 初始化 HDC 路径
      try {
        const hdcPath = await getHdcPath();
        setHdcPathState(hdcPath);
        const hdcAvailable = await checkHdcAvailable();
        setHdcAvailable(hdcAvailable);
        if (hdcAvailable) {
          const version = await getHdcVersion();
          setHdcVersion(version);
        }
      } catch {
        setHdcAvailable(false);
      }
    };
    initTools();
  }, []);

  const handleAdbPathChange = async (newPath: string) => {
    setAdbPathState(newPath);
    try {
      await invoke<void>("set_adb_path", { path: newPath });
      setAdbChecking(true);
      const available = await checkAdbAvailable();
      setAdbAvailable(available);
      if (available) {
        const version = await getAdbVersion();
        setAdbVersion(version);
      } else {
        setAdbVersion("");
      }
    } catch {
      setAdbAvailable(false);
      setAdbVersion("");
    } finally {
      setAdbChecking(false);
    }
  };

  const handleHdcPathChange = async (newPath: string) => {
    setHdcPathState(newPath);
    try {
      await setHdcPath(newPath);
      setHdcChecking(true);
      const available = await checkHdcAvailable();
      setHdcAvailable(available);
      if (available) {
        const version = await getHdcVersion();
        setHdcVersion(version);
      } else {
        setHdcVersion("");
      }
    } catch {
      setHdcAvailable(false);
      setHdcVersion("");
    } finally {
      setHdcChecking(false);
    }
  };

  const handleBrowseAdb = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "ADB Executable", extensions: ["exe", ""] }],
      });
      if (selected && typeof selected === "string") {
        await handleAdbPathChange(selected);
        showSaved();
      }
    } catch {
      // user cancelled
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

      {/* 个人链接 */}
      <div className="mb-6 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-dark-400 min-w-[100px]">我的个人主页：</span>
          <a 
            href="https://gitee.com/cunkai" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-sm text-accent-400 hover:underline transition-colors"
          >
            https://gitee.com/cunkai
          </a>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-dark-400 min-w-[100px]">本软件下载地址：</span>
          <a 
            href="https://pan.quark.cn/s/2d9e3ec93ba5" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-sm text-accent-400 hover:underline transition-colors"
          >
            https://pan.quark.cn/s/2d9e3ec93ba5
          </a>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-dark-400 min-w-[100px]">项目介绍：</span>
          <a 
            href="https://forum.trae.cn/t/topic/11969" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-sm text-accent-400 hover:underline transition-colors"
          >
            https://forum.trae.cn/t/topic/11969
          </a>
        </div>
      </div>

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
            <button 
              onClick={() => setTheme('dark')}
              className={`flex-1 px-4 py-3 rounded-lg border text-sm transition-colors ${
                theme === 'dark'
                  ? 'border-accent-500 bg-accent-500/10 text-accent-400'
                  : 'border-dark-600 bg-dark-700/50 text-dark-300 hover:border-dark-500'
              }`}
            >
              <span className="block font-medium">{t("settings.darkTheme")}</span>
              <span className="text-xs opacity-60 mt-0.5 block">Default</span>
            </button>
            <button 
              onClick={() => setTheme('light')}
              className={`flex-1 px-4 py-3 rounded-lg border text-sm transition-colors ${
                theme === 'light'
                  ? 'border-accent-500 bg-accent-500/10 text-accent-400'
                  : 'border-dark-600 bg-dark-700/50 text-dark-300 hover:border-dark-500'
              }`}
            >
              <span className="block font-medium">{t("settings.lightTheme")}</span>
              <span className="text-xs opacity-60 mt-0.5 block">White-Blue</span>
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

        {/* 调试工具目录 */}
        <div className="bg-dark-800/50 border border-dark-700/50 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-dark-300 mb-4">
            {t("settings.adbPath")}
          </h3>
          <div className="space-y-6">
            {/* ADB 路径 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-dark-400">ADB (Android Debug Bridge)</span>
                <div className="flex items-center gap-2">
                  {adbChecking && (
                    <div className="w-2 h-2 bg-accent-500 rounded-full animate-pulse" />
                  )}
                  {adbAvailable === true && (
                    <span className="flex items-center gap-1.5 text-sm text-green-400">
                      <div className="w-2 h-2 rounded-full bg-green-400" />
                      {t("common.success")}
                    </span>
                  )}
                  {adbAvailable === false && (
                    <span className="flex items-center gap-1.5 text-sm text-red-400">
                      <div className="w-2 h-2 rounded-full bg-red-400" />
                      {t("common.error")}
                    </span>
                  )}
                  {adbAvailable === null && !adbChecking && (
                    <span className="text-sm text-dark-500">{t("common.loading")}...</span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={adbPath}
                  onChange={(e) => handleAdbPathChange(e.target.value)}
                  placeholder="adb or /path/to/adb"
                  className="flex-1 px-3 py-2 bg-dark-900 border border-dark-700/50 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent-500 transition-colors font-mono"
                />
                <button
                  onClick={handleBrowseAdb}
                  className="px-4 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm whitespace-nowrap"
                >
                  {t("install.selectFile")}
                </button>
              </div>
            </div>

            {/* HDC 路径 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-dark-400">HDC (HarmonyOS Device Connector)</span>
                <div className="flex items-center gap-2">
                  {hdcChecking && (
                    <div className="w-2 h-2 bg-accent-500 rounded-full animate-pulse" />
                  )}
                  {hdcAvailable === true && (
                    <span className="flex items-center gap-1.5 text-sm text-green-400">
                      <div className="w-2 h-2 rounded-full bg-green-400" />
                      {t("common.success")}
                    </span>
                  )}
                  {hdcAvailable === false && (
                    <span className="flex items-center gap-1.5 text-sm text-red-400">
                      <div className="w-2 h-2 rounded-full bg-red-400" />
                      {t("common.error")}
                    </span>
                  )}
                  {hdcAvailable === null && !hdcChecking && (
                    <span className="text-sm text-dark-500">{t("common.loading")}...</span>
                  )}
                </div>
              </div>
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
                  {t("install.selectFile")}
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
              <span className="text-sm text-dark-400">ADB</span>
              <span className="text-sm text-dark-300">{adbVersion || "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm text-dark-400">HDC</span>
              <span className="text-sm text-dark-300">{hdcVersion || "-"}</span>
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
