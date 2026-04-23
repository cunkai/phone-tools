import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface PanelRefreshButtonProps {
  onRefresh: () => void;
  /** 面板是否正在加载中 */
  loading?: boolean;
}

const AUTO_REFRESH_OPTIONS = [1000, 2000, 3000, 5000, 10000];

const PanelRefreshButton: React.FC<PanelRefreshButtonProps> = ({ onRefresh, loading }) => {
  const { t } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const [autoInterval, setAutoInterval] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // 自动刷新逻辑
  useEffect(() => {
    if (autoInterval !== null) {
      timerRef.current = setInterval(() => {
        onRefresh();
      }, autoInterval);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [autoInterval, onRefresh]);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!showMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // 如果是长按触发的，不处理单击
    if (longPressTimer.current) return;
    onRefresh();
  }, [onRefresh]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    longPressTimer.current = setTimeout(() => {
      longPressTimer.current = null;
      setShowMenu((prev) => !prev);
    }, 500);
  }, []);

  const handleMouseUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const selectInterval = useCallback((ms: number) => {
    setAutoInterval((prev) => (prev === ms ? null : ms));
    setShowMenu(false);
  }, []);

  const stopAutoRefresh = useCallback(() => {
    setAutoInterval(null);
    setShowMenu(false);
  }, []);

  const formatInterval = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${ms / 1000}s`;
  };

  return (
    <div className="relative z-10">
      {/* 刷新按钮 */}
      <button
        className="flex items-center justify-center
                   bg-dark-700 hover:bg-dark-600 border border-dark-600 rounded
                   text-dark-400 hover:text-dark-200 transition-colors px-1.5 py-0.5 text-[10px]"
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {t("common.refresh")}
      </button>

      {/* 自动刷新指示器 - 始终显示（当有自动刷新时） */}
      {autoInterval !== null && !showMenu && (
        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"
          title={`${t("monitor.autoRefresh")}: ${formatInterval(autoInterval)}`}
        />
      )}

      {/* 自动刷新菜单 */}
      {showMenu && (
        <div
          ref={menuRef}
          className="absolute -top-1 right-8 z-20 bg-dark-800 border border-dark-600 rounded-lg shadow-xl py-1 min-w-[140px]"
          onMouseLeave={() => setShowMenu(false)}
        >
          <div className="px-3 py-1.5 text-xs text-dark-400 border-b border-dark-700">
            {t("monitor.autoRefresh")}
          </div>
          {AUTO_REFRESH_OPTIONS.map((ms) => (
            <button
              key={ms}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-dark-700 transition-colors flex items-center justify-between ${
                autoInterval === ms ? "text-accent-400" : "text-dark-300"
              }`}
              onClick={() => selectInterval(ms)}
            >
              <span>{formatInterval(ms)}</span>
              {autoInterval === ms && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
          {autoInterval !== null && (
            <div className="border-t border-dark-700">
              <button
                className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-dark-700 transition-colors"
                onClick={stopAutoRefresh}
              >
                {t("monitor.stopAutoRefresh")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PanelRefreshButton;
