import React, { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDeviceStore } from "../store/deviceStore";
import { useAutomationStore } from "../store/automationStore";
import { hdcScreenshot, takeScreenshot, getInstalledApps, hdcGetInstalledApps } from "../api/adb";
import type { InstalledApp } from "../types";
import type { ActionBlock, ActionParams, AutomationCanvas, RunConfig, ExecutionState } from "../types/automation";
import * as dialog from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import InputDialog from "../components/InputDialog";
import QueuePanel from "../components/QueuePanel";
import InsertDataDialog from "../components/InsertDataDialog";
import { CoordInput } from "../components/CoordInput";

// ==================== 块类型定义 ====================

interface BlockTypeItem {
  type: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

const BLOCK_TYPES: BlockTypeItem[] = [
  { type: "tap", color: "text-blue-400", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/30" },
  { type: "double_tap", color: "text-indigo-400", bgColor: "bg-indigo-500/10", borderColor: "border-indigo-500/30" },
  { type: "long_press", color: "text-purple-400", bgColor: "bg-purple-500/10", borderColor: "border-purple-500/30" },
  { type: "swipe", color: "text-cyan-400", bgColor: "bg-cyan-500/10", borderColor: "border-cyan-500/30" },
  { type: "drag", color: "text-green-400", bgColor: "bg-green-500/10", borderColor: "border-green-500/30" },
  { type: "keyevent", color: "text-orange-400", bgColor: "bg-orange-500/10", borderColor: "border-orange-500/30" },
  { type: "media_key", color: "text-pink-400", bgColor: "bg-pink-500/10", borderColor: "border-pink-500/30" },
  { type: "device_action", color: "text-emerald-400", bgColor: "bg-emerald-500/10", borderColor: "border-emerald-500/30" },
  { type: "gamepad", color: "text-violet-400", bgColor: "bg-violet-500/10", borderColor: "border-violet-500/30" },
  { type: "text", color: "text-yellow-400", bgColor: "bg-yellow-500/10", borderColor: "border-yellow-500/30" },
  { type: "open_url", color: "text-sky-400", bgColor: "bg-sky-500/10", borderColor: "border-sky-500/30" },
  { type: "shell", color: "text-lime-400", bgColor: "bg-lime-500/10", borderColor: "border-lime-500/30" },
  { type: "open_app", color: "text-fuchsia-400", bgColor: "bg-fuchsia-500/10", borderColor: "border-fuchsia-500/30" },
  { type: "delay", color: "text-gray-400", bgColor: "bg-gray-500/10", borderColor: "border-gray-500/30" },
  { type: "condition", color: "text-red-400", bgColor: "bg-red-500/10", borderColor: "border-red-500/30" },
  { type: "code", color: "text-blue-400", bgColor: "bg-blue-500/10", borderColor: "border-blue-500/30" },
];

// ==================== 块图标 SVG ====================

const BlockIcon: React.FC<{ type: string; className?: string }> = ({ type, className = "w-4 h-4" }) => {
  switch (type) {
    case "tap":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="10" cy="10" r="3" />
          <circle cx="10" cy="10" r="7" strokeDasharray="2 2" />
        </svg>
      );
    case "double_tap":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7" cy="10" r="2.5" />
          <circle cx="13" cy="10" r="2.5" />
        </svg>
      );
    case "long_press":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="10" cy="10" r="3" />
          <circle cx="10" cy="10" r="7" />
        </svg>
      );
    case "swipe":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M4 14 L16 6" />
          <path d="M12 6 L16 6 L16 10" />
        </svg>
      );
    case "drag":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M4 4 L16 4 L16 16 L4 16 Z" />
          <path d="M10 4 L10 16" strokeDasharray="2 2" />
          <path d="M7 8 L10 11 L13 8" />
        </svg>
      );
    case "keyevent":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="6" width="14" height="8" rx="1.5" />
          <line x1="7" y1="10" x2="13" y2="10" />
        </svg>
      );
    case "text":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="3" y1="6" x2="17" y2="6" />
          <line x1="3" y1="10" x2="13" y2="10" />
          <line x1="3" y1="14" x2="10" y2="14" />
        </svg>
      );
    case "delay":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="10" cy="10" r="7" />
          <polyline points="10 5 10 10 14 12" />
        </svg>
      );
    case "condition":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10" cy="10" r="8" />
          <path d="M10 6v4l3 3" />
        </svg>
      );
    case "code":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    case "media_key":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="4" width="14" height="12" rx="2" />
          <circle cx="10" cy="10" r="2" />
          <line x1="10" y1="6" x2="10" y2="8" />
        </svg>
      );
    case "device_action":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="5" y="2" width="10" height="16" rx="2" />
          <line x1="10" y1="18" x2="10" y2="18.01" />
          <path d="M8 7h4M8 10h4" />
        </svg>
      );
    case "gamepad":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="7" cy="8" r="1" fill="currentColor" />
          <circle cx="5" cy="6" r="1" fill="currentColor" />
          <circle cx="9" cy="6" r="1" fill="currentColor" />
          <circle cx="7" cy="4" r="1" fill="currentColor" />
          <circle cx="14" cy="6" r="1.5" />
          <line x1="3" y1="12" x2="17" y2="12" />
          <path d="M3 12c-1 0-2 1-2 3s1 2 2 2h2l2-2h6l2 2h2c1 0 2-1 2-2s-1-3-2-3" />
        </svg>
      );
    case "open_url":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="10" cy="10" r="7" />
          <path d="M2 10h16M10 2a12 12 0 0 1 3.5 8.5A12 12 0 0 1 10 18" />
          <path d="M10 2a12 12 0 0 0-3.5 8.5A12 12 0 0 0 10 18" />
        </svg>
      );
    case "shell":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polyline points="4 7 7 10 4 13" />
          <line x1="9" y1="13" x2="16" y2="13" />
        </svg>
      );
    case "open_app":
      return (
        <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="3" width="14" height="14" rx="3" />
          <path d="M7 3V1M13 3V1" />
          <line x1="3" y1="8" x2="17" y2="8" />
        </svg>
      );
    default:
      return null;
  }
};

// ==================== 块描述生成 ====================

function getBlockDescription(block: ActionBlock, t: (key: string) => string): string {
  const p = block.params as any;
  switch (block.type) {
    case "tap":
      return `${t("automation.tap")} (${p.tap.x}, ${p.tap.y})`;
    case "double_tap":
      return `${t("automation.double_tap")} (${p.double_tap.x}, ${p.double_tap.y})`;
    case "long_press":
      return `${t("automation.long_press")} (${p.long_press.x}, ${p.long_press.y})`;
    case "swipe":
      return `${t("automation.swipe")} (${p.swipe.from.x},${p.swipe.from.y}) -> (${p.swipe.to.x},${p.swipe.to.y})`;
    case "drag":
      return `${t("automation.drag")} (${p.drag.from.x},${p.drag.from.y}) -> (${p.drag.to.x},${p.drag.to.y})`;
    case "keyevent":
      return `${t("automation.keyevent")} [${p.keyevent.code}] ${p.keyevent.action || "press"}`;
    case "media_key":
      return `${t("automation.media_key")} [${p.media_key.code}] ${p.media_key.action || "press"}`;
    case "device_action":
      return `${t("automation.device_action")} [${p.device_action.action}]`;
    case "gamepad":
      return `${t("automation.gamepad")} [${p.gamepad.code}] ${p.gamepad.action || "press"}`;
    case "text":
      return `${t("automation.text")} "${p.text.content || "..."}"`;
    case "open_url":
      return `${t("automation.open_url")} ${p.open_url.url || "..."}`;
    case "shell":
      return `${t("automation.shell")} ${p.shell.command || "..."}`;
    case "open_app":
      return `${t("automation.open_app")} ${p.open_app.package || "..."}`;
    case "delay":
      return `${t("automation.delay")} ${p.delay.ms}ms`;
    case "condition":
      return `${t("automation.condition")} (${p.condition.target.x}, ${p.condition.target.y})`;
    case "code":
      return `${t("automation.code")}`;
    default:
      return block.type;
  }
}

// ==================== 积木块面板 (BlockPalette) ====================

const BlockPalette: React.FC = () => {
  const { t } = useTranslation();
  const addBlock = useAutomationStore((s) => s.addBlock);

  return (
    <div className="flex flex-col gap-1.5">
      {BLOCK_TYPES.map((bt) => (
        <button
          key={bt.type}
          onClick={() => addBlock(bt.type as keyof ActionParams)}
          className={`flex items-center gap-2 px-2.5 py-2 rounded-lg ${bt.bgColor} border ${bt.borderColor} hover:brightness-125 transition-all text-left group`}
        >
          <span className={bt.color}>
            <BlockIcon type={bt.type} />
          </span>
          <span className="text-xs text-dark-200 group-hover:text-dark-100">
            {t(`automation.${bt.type}`)}
          </span>
        </button>
      ))}
    </div>
  );
};

// ==================== 画布列表 (CanvasList) ====================

const CanvasList: React.FC = () => {
  const { t } = useTranslation();
  const { canvases, activeCanvasId, createCanvas, switchCanvas, deleteCanvas, renameCanvas } =
    useAutomationStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [isInputDialogOpen, setIsInputDialogOpen] = useState(false);

  const handleNewCanvas = useCallback(() => {
    console.log("[CanvasList] handleNewCanvas 被调用");
    setIsInputDialogOpen(true);
  }, []);

  const handleConfirmNewCanvas = useCallback((name: string) => {
    console.log("[CanvasList] handleConfirmNewCanvas被调用, 名称:", name);
    setIsInputDialogOpen(false);
    createCanvas(name.trim());
  }, [createCanvas]);

  const handleCancelNewCanvas = useCallback(() => {
    console.log("[CanvasList] handleCancelNewCanvas被调用");
    setIsInputDialogOpen(false);
  }, []);

  const handleDoubleClick = useCallback(
    (canvasId: string, currentName: string) => {
      setEditingId(canvasId);
      setEditName(currentName);
    },
    []
  );

  const commitRename = useCallback(
    (canvasId: string) => {
      if (editName.trim()) {
        renameCanvas(canvasId, editName.trim());
      }
      setEditingId(null);
    },
    [editName, renameCanvas]
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-dark-500 font-medium block">{t("automation.canvasList")}</span>
        <button
          onClick={() => {
            handleNewCanvas();
          }}
          className="text-xs text-accent-400 hover:text-accent-300 transition-colors"
          title={t("automation.newCanvas")}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      {canvases.length === 0 ? (
        <p className="text-xs text-dark-600 py-2">{t("automation.noCanvas")}</p>
      ) : (
        <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
          {canvases.map((canvas) => (
            <div
              key={canvas.id}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors group ${
                canvas.id === activeCanvasId
                  ? "bg-accent-500/15 text-accent-300"
                  : "text-dark-400 hover:bg-dark-700 hover:text-dark-300"
              }`}
              onClick={() => switchCanvas(canvas.id)}
              onDoubleClick={() => handleDoubleClick(canvas.id, canvas.name)}
            >
              {editingId === canvas.id ? (
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => commitRename(canvas.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(canvas.id);
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  autoFocus
                  className="flex-1 bg-dark-700 border border-dark-600 rounded px-1.5 py-0.5 text-xs text-dark-200 focus:outline-none focus:border-accent-500/50"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <>
                  <span className="flex-1 truncate">{canvas.name}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteCanvas(canvas.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-dark-500 hover:text-red-400 transition-all"
                    title={t("automation.deleteCanvas")}
                  >
                    <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="5" y1="5" x2="15" y2="15" />
                      <line x1="15" y1="5" x2="5" y2="15" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 输入对话框 */}
      <InputDialog
        isOpen={isInputDialogOpen}
        title={t("automation.newCanvas")}
        message={t("automation.canvasName")}
        placeholder={t("automation.canvasName")}
        defaultValue={`画布 ${Date.now()}`}
        onConfirm={handleConfirmNewCanvas}
        onCancel={handleCancelNewCanvas}
      />
    </div>
  );
};

// ==================== 入口配置组件 ====================

const RunConfigEntry: React.FC<{
  runConfig: RunConfig;
  execution: ExecutionState;
}> = ({ runConfig, execution }) => {
  const { t } = useTranslation();
  const updateRunConfig = useAutomationStore((s) => s.updateRunConfig);
  const [expanded, setExpanded] = useState(false);

  const isRunning = execution.status === "running";

  // 循环状态摘要
  const loopSummary = runConfig.loop
    ? runConfig.loopCount > 0
      ? t("automation.loopCountTimes", { count: runConfig.loopCount })
      : t("automation.loopInfinite")
    : t("automation.noLoop");

  return (
    <div className="rounded-lg border border-dark-700 bg-dark-800/80 overflow-hidden">
      {/* 头部：点击展开/收起 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-dark-700/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent-400">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
          </svg>
          <span className="text-xs font-medium text-dark-200">{t("automation.runConfig")}</span>
        </div>
        <div className="flex items-center gap-2">
          {/* 运行中显示循环进度 */}
          {isRunning && execution.currentLoop && (
            <span className="text-[10px] text-orange-400">
              {execution.totalLoops && execution.totalLoops > 0
                ? `${execution.currentLoop}/${execution.totalLoops}`
                : `#${execution.currentLoop}`}
            </span>
          )}
          <span className="text-[10px] text-dark-500">{loopSummary}</span>
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            className={`text-dark-500 transition-transform ${expanded ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {/* 展开配置面板 */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-dark-700/50">
          {/* 循环开关 */}
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-dark-300">{t("automation.loop")}</span>
            <button
              onClick={() => updateRunConfig({ loop: !runConfig.loop })}
              disabled={isRunning}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                runConfig.loop ? "bg-accent-500" : "bg-dark-600"
              } ${isRunning ? "opacity-50" : ""}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                runConfig.loop ? "left-[18px]" : "left-0.5"
              }`} />
            </button>
          </div>

          {/* 循环次数 */}
          {runConfig.loop && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-dark-300">{t("automation.loopCount")}</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={runConfig.loopCount}
                  onChange={(e) => updateRunConfig({ loopCount: Math.max(0, parseInt(e.target.value) || 0) })}
                  disabled={isRunning}
                  className="w-16 px-2 py-1 rounded bg-dark-700 border border-dark-600 text-dark-200 text-xs text-center focus:outline-none focus:border-accent-500 disabled:opacity-50"
                  min={0}
                />
                <span className="text-[10px] text-dark-500">{runConfig.loopCount === 0 ? `(${t("automation.infinite")})` : t("automation.times")}</span>
              </div>
            </div>
          )}

          {/* 循环间隔 */}
          {runConfig.loop && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-dark-300">{t("automation.loopInterval")}</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={runConfig.loopInterval}
                  onChange={(e) => updateRunConfig({ loopInterval: Math.max(0, parseInt(e.target.value) || 0) })}
                  disabled={isRunning}
                  className="w-16 px-2 py-1 rounded bg-dark-700 border border-dark-600 text-dark-200 text-xs text-center focus:outline-none focus:border-accent-500 disabled:opacity-50"
                  min={0}
                  step={100}
                />
                <span className="text-[10px] text-dark-500">ms</span>
              </div>
            </div>
          )}

          {/* 执行前延迟 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-dark-300">{t("automation.startDelay")}</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={runConfig.startDelay}
                onChange={(e) => updateRunConfig({ startDelay: Math.max(0, parseInt(e.target.value) || 0) })}
                disabled={isRunning}
                className="w-16 px-2 py-1 rounded bg-dark-700 border border-dark-600 text-dark-200 text-xs text-center focus:outline-none focus:border-accent-500 disabled:opacity-50"
                min={0}
                step={100}
              />
              <span className="text-[10px] text-dark-500">ms</span>
            </div>
          </div>

          {/* 出错继续 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-dark-300">{t("automation.continueOnError")}</span>
            <button
              onClick={() => updateRunConfig({ continueOnError: !runConfig.continueOnError })}
              disabled={isRunning}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                runConfig.continueOnError ? "bg-accent-500" : "bg-dark-600"
              } ${isRunning ? "opacity-50" : ""}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                runConfig.continueOnError ? "left-[18px]" : "left-0.5"
              }`} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== 执行画布 (AutomationCanvas) ====================

const AutomationCanvas: React.FC = () => {
  const { t } = useTranslation();
  const canvas = useAutomationStore((s) => s.activeCanvas());
  const selectedBlockId = useAutomationStore((s) => s.selectedBlockId);
  const execution = useAutomationStore((s) => s.execution);
  const { selectBlock, removeBlock, moveBlock, duplicateBlock, updateBlock } = useAutomationStore();
  const [isInputDialogOpen, setIsInputDialogOpen] = useState(false);

  const handleNewCanvas = useCallback(() => {
    console.log("[AutomationCanvas] handleNewCanvas 被调用");
    setIsInputDialogOpen(true);
  }, []);

  const handleConfirmNewCanvas = useCallback((name: string) => {
    console.log("[AutomationCanvas] handleConfirmNewCanvas被调用, 名称:", name);
    setIsInputDialogOpen(false);
    useAutomationStore.getState().createCanvas(name.trim());
  }, []);

  const handleCancelNewCanvas = useCallback(() => {
    console.log("[AutomationCanvas] handleCancelNewCanvas被调用");
    setIsInputDialogOpen(false);
  }, []);

  if (!canvas) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <p className="text-dark-500 text-sm mb-3">{t("automation.noCanvas")}</p>
          <button
            onClick={() => {
              handleNewCanvas();
            }}
            className="px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors text-sm"
          >
            + {t("automation.newCanvas")}
          </button>
        </div>
      </div>
    );
  }

  const blocks = canvas.blocks;
  const runConfig = canvas.runConfig;

  if (blocks.length === 0 && !runConfig.loop) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-dark-500 text-sm">{t("automation.noBlocks")}</p>
      </div>
    );
  }

  // 找到当前执行块的实际 id（execution.currentIndex 是在 enabledBlocks 中的索引）
  const enabledBlocks = blocks.filter((b) => !b.disabled);
  const currentExecutingBlockId =
    execution.status === "running" && execution.currentIndex !== null
      ? enabledBlocks[execution.currentIndex]?.id ?? null
      : null;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
      {/* ====== 入口配置组件（不可删除） ====== */}
      <RunConfigEntry runConfig={runConfig} execution={execution} />

      {/* ====== 积木块列表 ====== */}
      {blocks.map((block, index) => {
        const bt = BLOCK_TYPES.find((b) => b.type === block.type)!;
        const isSelected = block.id === selectedBlockId;
        const isExecuting = block.id === currentExecutingBlockId;
        const isDisabled = block.disabled;

        return (
          <div
            key={block.id}
            onClick={() => selectBlock(block.id)}
            className={`relative flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all cursor-pointer group ${
              isDisabled
                ? "opacity-40"
                : ""
            } ${
              isExecuting
                ? "border-orange-500 bg-orange-500/10 shadow-[0_0_8px_rgba(249,115,22,0.2)]"
                : isSelected
                  ? "border-accent-500 bg-accent-500/10"
                  : "border-dark-700 bg-dark-800/50 hover:bg-dark-800 hover:border-dark-600"
            }`}
          >
            {/* 步骤编号 */}
            <span className="text-[10px] text-dark-600 w-5 text-center shrink-0">
              {index + 1}
            </span>

            {/* 图标 */}
            <span className={bt.color + " shrink-0"}>
              <BlockIcon type={block.type} />
            </span>

            {/* 描述 */}
            <span className={`text-xs flex-1 truncate ${isDisabled ? "text-dark-500" : "text-dark-200"}`}>
              {block.label || getBlockDescription(block, t)}
            </span>

            {/* 操作按钮（悬停显示） */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              {/* 禁用/启用 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateBlock(block.id, { disabled: !block.disabled });
                }}
                className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors"
                title={t("automation.disabled")}
              >
                {block.disabled ? t("automation.enable") : t("automation.disable")}
              </button>

              {/* 复制 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  duplicateBlock(block.id);
                }}
                className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors"
                title={t("automation.duplicate")}
              >
                {t("automation.duplicate")}
              </button>

              {/* 上移 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (index > 0) moveBlock(index, index - 1);
                }}
                className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors disabled:opacity-30"
                disabled={index === 0}
                title={t("automation.moveUp")}
              >
                {t("automation.moveUp")}
              </button>

              {/* 下移 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (index < blocks.length - 1) moveBlock(index, index + 1);
                }}
                className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-dark-300 transition-colors disabled:opacity-30"
                disabled={index === blocks.length - 1}
                title={t("automation.moveDown")}
              >
                {t("automation.moveDown")}
              </button>

              {/* 删除 */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  removeBlock(block.id);
                }}
                className="px-1.5 py-0.5 rounded text-[10px] text-dark-500 hover:text-red-400 transition-colors"
                title={t("automation.delete")}
              >
                {t("automation.delete")}
              </button>
            </div>
          </div>
        );
      })}

      {/* 输入对话框 */}
      <InputDialog
        isOpen={isInputDialogOpen}
        title={t("automation.newCanvas")}
        message={t("automation.canvasName")}
        placeholder={t("automation.canvasName")}
        defaultValue={`画布 ${Date.now()}`}
        onConfirm={handleConfirmNewCanvas}
        onCancel={handleCancelNewCanvas}
      />
    </div>
  );
};

// ==================== 包名选择器 ====================

const PackageSelector: React.FC<{ value: string; onChange: (pkg: string) => void }> = ({ value, onChange }) => {
  const { t } = useTranslation();
  const currentDevice = useDeviceStore((s) => s.currentDevice);
  const devices = useDeviceStore((s) => s.devices);
  const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const loadApps = useCallback(async () => {
    if (!currentDevice) return;
    setLoading(true);
    try {
      const list = currentPlatform === "harmonyos"
        ? await hdcGetInstalledApps(currentDevice)
        : await getInstalledApps(currentDevice, false);
      setApps(list);
    } catch {}
    setLoading(false);
  }, [currentDevice, currentPlatform]);

  // 首次打开下拉时加载
  useEffect(() => {
    if (showDropdown && apps.length === 0 && !loading) {
      loadApps();
    }
  }, [showDropdown, apps.length, loading, loadApps]);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showDropdown]);

  const filtered = search
    ? apps.filter((a) =>
        a.app_name.toLowerCase().includes(search.toLowerCase()) ||
        a.package_name.toLowerCase().includes(search.toLowerCase())
      )
    : apps;

  const selectedApp = apps.find((a) => a.package_name === value);

  return (
    <div ref={dropdownRef}>
      <label className="text-xs text-dark-400 mb-1 block">{t("automation.packageName")}</label>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className={`w-full px-2.5 py-1.5 rounded-md bg-dark-700 border text-xs text-left transition-colors ${
          showDropdown ? "border-accent-500/50" : "border-dark-600"
        }`}
      >
        {selectedApp ? (
          <span className="text-dark-200">{selectedApp.app_name} <span className="text-dark-500">({selectedApp.package_name})</span></span>
        ) : value ? (
          <span className="text-dark-200">{value}</span>
        ) : (
          <span className="text-dark-500">{t("automation.selectPackage")}</span>
        )}
      </button>
      {showDropdown && (
        <div className="absolute z-50 mt-1 w-60 max-h-64 bg-dark-800 border border-dark-600 rounded-lg shadow-xl overflow-hidden flex flex-col">
          <div className="p-1.5 border-b border-dark-700 shrink-0">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-2 py-1 bg-dark-700 border border-dark-600 rounded text-xs text-dark-200 placeholder-dark-500 focus:outline-none focus:border-accent-500"
              placeholder={t("automation.searchApp")}
              autoFocus
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="px-3 py-4 text-center text-xs text-dark-500">{t("common.loading")}</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-dark-500">{t("automation.noApps")}</div>
            ) : (
              filtered.map((app) => (
                <button
                  key={app.package_name}
                  onClick={() => { onChange(app.package_name); setShowDropdown(false); setSearch(""); }}
                  className={`w-full px-2.5 py-1.5 text-left text-xs hover:bg-dark-700 transition-colors flex items-center gap-2 ${
                    value === app.package_name ? "bg-accent-500/10 text-accent-400" : "text-dark-300"
                  }`}
                >
                  {app.icon_base64 && (
                    <img src={`data:image/png;base64,${app.icon_base64}`} alt="" className="w-4 h-4 rounded" />
                  )}
                  <span className="truncate">{app.app_name}</span>
                  <span className="text-dark-600 truncate ml-auto text-[10px]">{app.package_name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== Shell 结果展示 ====================

const ShellResult: React.FC<{ blockId: string }> = ({ blockId }) => {
  const { t } = useTranslation();
  const execution = useAutomationStore((s) => s.execution);
  const [result, setResult] = useState<string | null>(null);

  // 监听执行状态，当该块执行完毕后获取结果
  useEffect(() => {
    if (execution.status === "completed" || execution.status === "error") {
      // 从执行日志中查找该块的结果（通过 store 的 lastResult 获取）
      const lastResult = useAutomationStore.getState().lastShellResult;
      if (lastResult) {
        setResult(lastResult);
      }
    }
    if (execution.status === "running") {
      setResult(null);
    }
  }, [execution.status, blockId]);

  if (!result) return null;

  return (
    <div>
      <label className="text-xs text-dark-400 mb-1 block">{t("automation.shellResult")}</label>
      <pre className="text-[11px] text-dark-300 bg-dark-900 border border-dark-700 rounded-md p-2 max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono">
        {result}
      </pre>
    </div>
  );
};

// ==================== 属性编辑面板 (BlockInspector) ====================

const BlockInspector: React.FC<{ onCoordInput?: (coord: any) => void; platform?: string; onStartPickColor?: (target: string) => void }> = ({ onCoordInput, platform, onStartPickColor }) => {
  const { t } = useTranslation();
  const selectedBlockId = useAutomationStore((s) => s.selectedBlockId);
  const canvas = useAutomationStore((s) => s.activeCanvas());
  const updateBlock = useAutomationStore((s) => s.updateBlock);
  const homeCache = useDeviceStore((s) => s.homeCache);
  const currentDevice = useDeviceStore((s) => s.currentDevice);
  const [insertDataDialogOpen, setInsertDataDialogOpen] = useState(false);
  const [macroDialogOpen, setMacroDialogOpen] = useState(false);

  const block = canvas?.blocks.find((b) => b.id === selectedBlockId);
  const p = block?.params as any;
  const bt = block ? BLOCK_TYPES.find((b) => b.type === block.type)! : null;

  const updateParams = (keyPath: string, value: number | string) => {
    if (!block) return;
    const newParams = JSON.parse(JSON.stringify(block.params));
    const keys = keyPath.split(".");
    let target: any = newParams;
    for (let i = 0; i < keys.length - 1; i++) {
      target = target[keys[i]];
    }
    target[keys[keys.length - 1]] = typeof value === "string" && !isNaN(Number(value)) ? Number(value) : value;
    updateBlock(block.id, { params: newParams });
  };

  const inputCls =
    "w-full px-2.5 py-1.5 rounded-md bg-dark-700 border border-dark-600 text-dark-200 text-xs focus:outline-none focus:border-accent-500/50 transition-colors";
  const labelCls = "text-xs text-dark-400 mb-1 block";

  // 获取屏幕分辨率用于坐标归一化
  const getScreenSize = useCallback((): [number, number] => {
    const res = currentDevice ? (homeCache[currentDevice]?.screenRes || "") : "";
    const m = res.match(/(\d+)x(\d+)/);
    if (m) return [parseInt(m[1]), parseInt(m[2])];
    return [1080, 2400];
  }, [currentDevice, homeCache]);

  // 坐标输入时触发浮窗动画
  const handleCoordChange = useCallback((key: string, value: string) => {
    // 智能处理输入值：去除前导零，保持空字符串为空
    let processedValue = value;
    if (value !== "") {
      // 去除前导零，但保留单个0
      processedValue = value.replace(/^0+(?!$)/, '');
    }
    
    updateParams(key, processedValue);
    if (!onCoordInput) return;
    const parts = key.split(".");
    if (parts.length >= 2 && (parts[parts.length - 1] === "x" || parts[parts.length - 1] === "y")) {
      const numVal = Number(processedValue);
      if (isNaN(numVal)) return;
      // 用输入的值直接计算坐标，不依赖 block（避免闭包/更新时序问题）
      const isX = parts[parts.length - 1] === "x";
      // 从 store 读取最新的 block
      const latestBlock = useAutomationStore.getState().activeCanvas()?.blocks.find((b) => b.id === block?.id);
      if (!latestBlock) return;
      const latestParams = latestBlock.params as any;
      let target = latestParams;
      for (const k of parts.slice(0, -1)) target = target?.[k];
      if (!target) return;
      onCoordInput(target);
    }
  }, [onCoordInput, block?.id, updateParams]);

  if (!block || !bt) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-xs text-dark-600">{t("automation.noBlocks")}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {/* 块类型标题 */}
      <div className="flex items-center gap-2 pb-2 border-b border-dark-700/50">
        <span className={bt.color}>
          <BlockIcon type={block.type} className="w-5 h-5" />
        </span>
        <span className="text-sm font-medium text-dark-200">{t(`automation.${block.type}` as any)}</span>
      </div>

      {/* 标签 */}
      <div>
        <label className={labelCls}>{t("automation.label")}</label>
        <input
          type="text"
          value={block.label || ""}
          onChange={(e) => updateBlock(block.id, { label: e.target.value })}
          className={inputCls}
          placeholder={t("automation.label")}
        />
      </div>

      {/* 禁用 */}
      <div className="flex items-center justify-between">
        <label className={labelCls + " mb-0"}>{t("automation.disabled")}</label>
        <button
          onClick={() => updateBlock(block.id, { disabled: !block.disabled })}
          className={`relative w-8 h-4 rounded-full transition-colors ${block.disabled ? "bg-accent-500" : "bg-dark-600"}`}
        >
          <div
            className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${block.disabled ? "translate-x-4" : "translate-x-0.5"}`}
          />
        </button>
      </div>

      {/* 根据类型显示不同参数 */}
      {(block.type === "tap" || block.type === "double_tap") && (
        <CoordInput
          value={p[block.type]}
          onChange={(newValue) => updateParams(block.type, newValue)}
          onCoordInput={onCoordInput}
          label={block.type === "tap" ? t("automation.tap") : t("automation.double_tap")}
        />
      )}

      {block.type === "long_press" && (
        <>
          <CoordInput
            value={p.long_press}
            onChange={(newValue) => updateParams("long_press", newValue)}
            onCoordInput={onCoordInput}
            label={t("automation.long_press")}
          />
          <div>
            <label className={labelCls}>{t("automation.duration")}</label>
            <input
              type="number"
              value={p.long_press.duration || 1000}
              onChange={(e) => updateParams("long_press.duration", e.target.value)}
              className={inputCls}
            />
          </div>
        </>
      )}

      {(block.type === "swipe" || block.type === "drag") && (
        <>
          <CoordInput
            value={p[block.type].from}
            onChange={(newValue) => updateParams(`${block.type}.from`, newValue)}
            onCoordInput={onCoordInput}
            label={t("automation.from")}
          />
          <CoordInput
            value={p[block.type].to}
            onChange={(newValue) => updateParams(`${block.type}.to`, newValue)}
            onCoordInput={onCoordInput}
            label={t("automation.to")}
          />
          <div>
            <label className={labelCls}>{t("automation.duration")}</label>
            <input
              type="number"
              value={p[block.type].duration || (block.type === "swipe" ? 300 : 1000)}
              onChange={(e) => updateParams(`${block.type}.duration`, e.target.value)}
              className={inputCls}
            />
          </div>
        </>
      )}

      {block.type === "keyevent" && (() => {
        const data = p.keyevent;
        const mode = data.inputMode || "preset";
        return (
          <>
            {/* 按键动作 */}
            <div>
              <label className={labelCls}>{t("automation.keyAction")}</label>
              <div className="grid grid-cols-3 gap-1">
                {(["press", "release", "long_press"] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => updateParams("keyevent.action", a)}
                    className={`px-2 py-1.5 rounded-md text-xs transition-colors ${
                      data.action === a
                        ? "bg-accent-500/20 text-accent-400 border border-accent-500/30"
                        : "bg-dark-700 text-dark-300 hover:bg-dark-600 border border-dark-600"
                    }`}
                  >
                    {t(a === "long_press" ? "automation.keyLongPress" : `automation.${a}`)}
                  </button>
                ))}
              </div>
            </div>
            {/* 长按时间 */}
            {data.action === "long_press" && (
              <div>
                <label className={labelCls}>{t("automation.duration")}</label>
                <input
                  type="number"
                  value={data.duration || 3000}
                  onChange={(e) => updateParams("keyevent.duration", e.target.value)}
                  className={inputCls}
                  min={3000}
                  max={15000}
                />
              </div>
            )}
            {/* 输入模式 Tab 切换 */}
            <div>
              <label className={labelCls}>{t("automation.key")}</label>
              <div className="grid grid-cols-3 gap-1">
                {([
                  { value: "text", label: t("automation.textInput") },
                  { value: "keycode", label: t("automation.keycode") },
                  { value: "preset", label: t("automation.presetKeys") },
                ] as const).map((tab) => (
                  <button
                    key={tab.value}
                    onClick={() => updateParams("keyevent.inputMode", tab.value)}
                    className={`px-2 py-1.5 rounded-md text-xs transition-colors ${
                      mode === tab.value
                        ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                        : "bg-dark-700 text-dark-300 hover:bg-dark-600 border border-dark-600"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            {/* 字母数字模式 */}
            {mode === "text" && (
              <div>
                <label className={labelCls}>{t("automation.textInput")}</label>
                <input
                  type="text"
                  value={data.textInput || ""}
                  onChange={(e) => updateParams("keyevent.textInput", e.target.value)}
                  className={inputCls}
                  placeholder={t("automation.textInputPlaceholder")}
                />
              </div>
            )}
            {/* 按键码模式 */}
            {mode === "keycode" && (
              <div>
                <label className={labelCls}>{t("automation.keycode")}</label>
                <input
                  type="number"
                  value={data.code}
                  onChange={(e) => updateParams("keyevent.code", e.target.value)}
                  className={inputCls}
                />
              </div>
            )}
            {/* 常用按键模式 */}
            {mode === "preset" && (
              <div className="grid grid-cols-4 gap-1">
                {(platform === "harmonyos" ? [
                  { label: "返回", code: 2 }, { label: "主页", code: 1 },
                  { label: "最近任务", code: 2210 }, { label: "回车", code: 2054 },
                  { label: "删除", code: 2055 }, { label: "Esc", code: 2070 },
                  { label: "Tab", code: 2049 }, { label: "空格", code: 2050 },
                  { label: "↑", code: 2012 }, { label: "↓", code: 2013 },
                  { label: "←", code: 2014 }, { label: "→", code: 2015 },
                  { label: "上翻页", code: 2068 }, { label: "下翻页", code: 2069 },
                  { label: "Shift", code: 2047 }, { label: "Ctrl", code: 2072 },
                ] : [
                  { label: "返回", code: 4 }, { label: "主页", code: 3 },
                  { label: "最近任务", code: 187 }, { label: "回车", code: 66 },
                  { label: "删除", code: 67 }, { label: "Esc", code: 111 },
                  { label: "Tab", code: 61 }, { label: "空格", code: 62 },
                  { label: "↑", code: 19 }, { label: "↓", code: 20 },
                  { label: "←", code: 21 }, { label: "→", code: 22 },
                  { label: "上翻页", code: 92 }, { label: "下翻页", code: 93 },
                  { label: "Shift", code: 59 }, { label: "Ctrl", code: 113 },
                ]).map((key) => (
                  <button
                    key={key.code}
                    onClick={() => updateParams("keyevent.code", key.code)}
                    className={`px-1.5 py-1 rounded text-[11px] transition-colors ${
                      data.code === key.code
                        ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                        : "bg-dark-700 text-dark-300 hover:bg-dark-600 border border-dark-600"
                    }`}
                  >
                    {key.label}
                  </button>
                ))}
              </div>
            )}
          </>
        );
      })()}

      {(block.type === "media_key" || block.type === "gamepad") && (() => {
        const section = block.type as string;
        const data = p[section];
        return (
          <>
            <div>
              <label className={labelCls}>{t("automation.keyAction")}</label>
              <div className="grid grid-cols-3 gap-1">
                {(["press", "release", "long_press"] as const).map((a) => (
                  <button
                    key={a}
                    onClick={() => updateParams(`${section}.action`, a)}
                    className={`px-2 py-1.5 rounded-md text-xs transition-colors ${
                      data.action === a
                        ? "bg-accent-500/20 text-accent-400 border border-accent-500/30"
                        : "bg-dark-700 text-dark-300 hover:bg-dark-600 border border-dark-600"
                    }`}
                  >
                    {t(a === "long_press" ? "automation.keyLongPress" : `automation.${a}`)}
                  </button>
                ))}
              </div>
            </div>
            {data.action === "long_press" && (
              <div>
                <label className={labelCls}>{t("automation.duration")}</label>
                <input type="number" value={data.duration || 3000}
                  onChange={(e) => updateParams(`${section}.duration`, e.target.value)}
                  className={inputCls} min={3000} max={15000} />
              </div>
            )}
            <div>
              <label className={labelCls}>{t("automation.keycode")}</label>
              <input type="number" value={data.code}
                onChange={(e) => updateParams(`${section}.code`, e.target.value)}
                className={inputCls} />
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(section === "media_key" ? (platform === "harmonyos" ? [
                { label: "▶/❚❚", code: 10 }, { label: "⏹", code: 11 },
                { label: "⏭", code: 12 }, { label: "⏮", code: 13 },
                { label: "⏪", code: 14 }, { label: "⏩", code: 15 },
                { label: "⏺", code: 2089 }, { label: "静音", code: 22 },
              ] : [
                { label: "▶/❚❚", code: 85 }, { label: "⏹", code: 86 },
                { label: "⏭", code: 87 }, { label: "⏮", code: 88 },
                { label: "⏪", code: 89 }, { label: "⏩", code: 90 },
                { label: "⏺", code: 130 }, { label: "静音", code: 164 },
              ]) : (platform === "harmonyos" ? [
                { label: "A", code: 2301 }, { label: "B", code: 2302 },
                { label: "X", code: 2304 }, { label: "Y", code: 2305 },
                { label: "L1", code: 2307 }, { label: "R1", code: 2308 },
                { label: "L2", code: 2309 }, { label: "R2", code: 2310 },
                { label: "Select", code: 2311 }, { label: "Start", code: 2312 },
              ] : [
                { label: "A", code: 96 }, { label: "B", code: 97 },
                { label: "X", code: 98 }, { label: "Y", code: 99 },
                { label: "L1", code: 102 }, { label: "R1", code: 103 },
                { label: "L2", code: 104 }, { label: "R2", code: 105 },
                { label: "Select", code: 109 }, { label: "Start", code: 108 },
              ])).map((key) => (
                <button key={key.code}
                  onClick={() => updateParams(`${section}.code`, key.code)}
                  className={`px-1.5 py-1 rounded text-[11px] transition-colors ${
                    data.code === key.code
                      ? "bg-accent-500/20 text-accent-400 border border-accent-500/30"
                      : "bg-dark-700 text-dark-300 hover:bg-dark-600 border border-dark-600"
                  }`}>
                  {key.label}
                </button>
              ))}
            </div>
          </>
        );
      })()}

      {block.type === "device_action" && (
        <>
          <div>
            <label className={labelCls}>{t("automation.deviceAction")}</label>
            <div className="grid grid-cols-3 gap-1">
              {[
                { label: "音量+", action: "volume_up" },
                { label: "音量-", action: "volume_down" },
                { label: "静音", action: "mute" },
                { label: "电源", action: "power" },
                ...(platform === "harmonyos" ? [
                  { label: "亮屏" as const, action: "wakeup" as const },
                  { label: "熄屏" as const, action: "suspend" as const },
                  { label: "自动熄屏" as const, action: "auto_screen_off" as const },
                  { label: "恢复熄屏" as const, action: "restore_screen_off" as const },
                ] : []),
              ].map((item) => (
                <button
                  key={item.action}
                  onClick={() => updateParams("device_action.action", item.action)}
                  className={`px-1.5 py-1.5 rounded-md text-xs transition-colors ${
                    p.device_action.action === item.action
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-dark-700 text-dark-300 hover:bg-dark-600 border border-dark-600"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          {platform === "harmonyos" && (
          <div>
            <label className={labelCls}>{t("automation.powerMode")}</label>
            <div className="grid grid-cols-2 gap-1">
              {[
                { label: "正常模式", action: "mode_normal" },
                { label: "省电模式", action: "mode_power_save" },
                { label: "性能模式", action: "mode_performance" },
                { label: "超级省电", action: "mode_super_save" },
              ].map((item) => (
                <button
                  key={item.action}
                  onClick={() => updateParams("device_action.action", item.action)}
                  className={`px-1.5 py-1.5 rounded-md text-xs transition-colors ${
                    p.device_action.action === item.action
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-dark-700 text-dark-300 hover:bg-dark-600 border border-dark-600"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          )}
          {platform === "harmonyos" && p.device_action.action === "auto_screen_off" && (
            <div>
              <label className={labelCls}>{t("automation.autoScreenOffTime")}</label>
              <input
                type="number"
                value={p.device_action.timeout_ms || 15000}
                onChange={(e) => updateParams("device_action.timeout_ms", e.target.value)}
                className={inputCls}
                min={1000}
              />
            </div>
          )}
        </>
      )}

      {block.type === "text" && (
        <div>
          <label className={labelCls}>{t("automation.content")}</label>
          {platform === "harmonyos" && p.text.content && !/^[\x00-\x7F]*$/.test(p.text.content) && (
            <p className="text-[11px] text-amber-400 mb-1">{t("automation.asciiOnly")}</p>
          )}
          <textarea
            value={p.text.content}
            onChange={(e) => updateParams("text.content", e.target.value)}
            className={inputCls + " resize-none" + (platform === "harmonyos" && p.text.content && !/^[\x00-\x7F]*$/.test(p.text.content) ? " border-amber-500/50" : "")}
            rows={3}
            placeholder={t("automation.content")}
          />
        </div>
      )}

      {block.type === "open_url" && (
        <div>
          <label className={labelCls}>{t("automation.url")}</label>
          <input
            type="text"
            value={p.open_url.url}
            onChange={(e) => updateParams("open_url.url", e.target.value)}
            className={inputCls}
            placeholder="https://"
          />
        </div>
      )}

      {block.type === "shell" && (
        <>
          <div>
            <label className={labelCls}>{t("automation.shellCommand")}</label>
            <textarea
              value={p.shell.command}
              onChange={(e) => updateParams("shell.command", e.target.value)}
              className={`${inputCls} resize-none`}
              rows={3}
              placeholder="ls -la"
              spellCheck={false}
            />
          </div>
          <ShellResult blockId={block.id} />
        </>
      )}

      {block.type === "open_app" && (
        <PackageSelector
          value={p.open_app.package}
          onChange={(pkg) => updateParams("open_app.package", pkg)}
        />
      )}

      {block.type === "delay" && (
        <div>
          <label className={labelCls}>{t("automation.ms")}</label>
          <input
            type="number"
            value={p.delay.ms}
            onChange={(e) => updateParams("delay.ms", e.target.value)}
            className={inputCls}
          />
        </div>
      )}

      {block.type === "condition" && (
        <>
          <CoordInput
            value={p.condition.target}
            onChange={(newValue) => updateParams("condition.target", newValue)}
            onCoordInput={onCoordInput}
            label={t("automation.target")}
          />
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs text-dark-400">{t("automation.expectedColor")} (RGBA)</label>
              {onStartPickColor && (
                <button
                  onClick={() => onStartPickColor("condition.expected")}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-amber-400 hover:bg-amber-500/10 border border-amber-500/30 transition-colors"
                  title={t("automation.pickColor")}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z" />
                  </svg>
                  {t("automation.pickColor")}
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(["r", "g", "b"] as const).map((ch) => (
                <div key={ch}>
                  <label className="text-[10px] text-dark-500 mb-0.5 block uppercase">{ch}</label>
                  <input
                    type="number"
                    min={0}
                    max={255}
                    value={p.condition.expected[ch]}
                    onChange={(e) => updateParams(`condition.expected.${ch}`, e.target.value)}
                    className={inputCls}
                  />
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>{t("automation.tolerance")} (RGB)</label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-dark-500 mb-0.5 block uppercase">R</label>
                <input
                  type="number"
                  value={p.condition.toleranceR || 10}
                  onChange={(e) => updateParams("condition.toleranceR", e.target.value)}
                  className={inputCls}
                  min={0}
                  max={255}
                />
              </div>
              <div>
                <label className="text-[10px] text-dark-500 mb-0.5 block uppercase">G</label>
                <input
                  type="number"
                  value={p.condition.toleranceG || 10}
                  onChange={(e) => updateParams("condition.toleranceG", e.target.value)}
                  className={inputCls}
                  min={0}
                  max={255}
                />
              </div>
              <div>
                <label className="text-[10px] text-dark-500 mb-0.5 block uppercase">B</label>
                <input
                  type="number"
                  value={p.condition.toleranceB || 10}
                  onChange={(e) => updateParams("condition.toleranceB", e.target.value)}
                  className={inputCls}
                  min={0}
                  max={255}
                />
              </div>
            </div>
          </div>
          <div>
            <label className={labelCls}>{t("automation.timeout")}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={p.condition.timeout || 5000}
                onChange={(e) => updateParams("condition.timeout", e.target.value)}
                className={`${inputCls} flex-1`}
                disabled={p.condition.timeout === 0}
              />
              <label className="flex items-center gap-1 text-xs text-dark-400">
                <input
                  type="checkbox"
                  checked={p.condition.timeout === 0}
                  onChange={(e) => updateParams("condition.timeout", e.target.checked ? 0 : 5000)}
                  className="w-3 h-3 rounded border-dark-600 bg-dark-700 text-accent-500 focus:ring-accent-500"
                />
                不超时
              </label>
            </div>
          </div>
          <div>
            <label className={labelCls}>{t("automation.interval")}</label>
            <input
              type="number"
              value={p.condition.interval || 500}
              onChange={(e) => updateParams("condition.interval", e.target.value)}
              className={inputCls}
            />
          </div>
        </>
      )}

      {block.type === "code" && (
        <>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={labelCls}>{t("automation.codeContent")}</label>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setInsertDataDialogOpen(true)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-accent-400 hover:bg-accent-500/10 border border-accent-500/30 transition-colors"
                  title={t("automation.insertData")}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  {t("automation.insertData")}
                </button>
                <button
                  onClick={() => setMacroDialogOpen(true)}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-blue-400 hover:bg-blue-500/10 border border-blue-500/30 transition-colors"
                  title="插入宏"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                  插入宏
                </button>
              </div>
            </div>
            <textarea
              value={p.code.content}
              onChange={(e) => updateParams("code.content", e.target.value)}
              className={`${inputCls} resize-none h-40 font-mono`}
              placeholder={t("automation.codePlaceholder")}
              spellCheck={false}
            />
          </div>
          {p.code.variables && p.code.variables.length > 0 && (
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                {(() => {
                  // 变量去重，保留最后一个
                  const uniqueVariables = new Map();
                  p.code.variables.forEach((v: any) => {
                    uniqueVariables.set(v.name, v);
                  });
                  return Array.from(uniqueVariables.values());
                })().map((variable: any) => (
                  <div key={variable.name} className="flex items-center gap-1 bg-dark-700/50 border border-dark-600 rounded px-2 py-1">
                    <span className="text-xs text-dark-400">{variable.name}</span>
                    <button
                      onClick={() => {
                        const uniqueVariables = new Map();
                        p.code.variables.forEach((v: any) => {
                          uniqueVariables.set(v.name, v);
                        });
                        uniqueVariables.delete(variable.name);
                        const variables = Array.from(uniqueVariables.values());
                        updateBlock(block.id, {
                          params: {
                            code: {
                              ...p.code,
                              variables
                            }
                          }
                        });
                      }}
                      className="p-0.5 text-dark-500 hover:text-red-400 transition-colors"
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="4" y1="4" x2="20" y2="20" />
                        <line x1="20" y1="4" x2="4" y2="20" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* 执行代码预览 */}
          <div className="mt-3">
            <label className={labelCls}>执行预览</label>
            <pre className="text-[11px] text-dark-300 bg-dark-900 border border-dark-700 rounded-md p-2 max-h-24 overflow-y-auto whitespace-pre-wrap break-all font-mono">
              {(() => {
                let preview = '';
                if (p.code.variables && p.code.variables.length > 0) {
                  preview += '// 变量值:\n';
                  p.code.variables.forEach((v: any) => {
                    const sourceType = v.source.sourceType || 'params';
                    const typeLabel = sourceType === 'result' ? '执行结果' : '块参数';
                    preview += `// const ${v.name} = /* 从 ${typeLabel} 中获取 */;\n`;
                  });
                  preview += '\n';
                }
                preview += p.code.content || '';
                return preview;
              })()}
            </pre>
          </div>
        </>
      )}

      {/* 插入数据对话框 */}
      <InsertDataDialog
        isOpen={insertDataDialogOpen}
        onClose={() => setInsertDataDialogOpen(false)}
        onInsert={(blockId, property, variableName, sourceType) => {
          if (!block) return;

          // 检查变量名是否已存在
          const existingVariables = p.code.variables || [];
          const variableExists = existingVariables.some((v: any) => v.name === variableName);
          
          // 构建变量定义
          const variables = variableExists 
            ? existingVariables.map((v: any) => 
                v.name === variableName 
                  ? { ...v, source: { blockId, property, type: "string", sourceType } }
                  : v
              )
            : [...existingVariables, {
                name: variableName,
                source: {
                  blockId,
                  property,
                  type: "string",
                  sourceType
                }
              }];

          // 只更新 variables，不修改用户的代码内容
          updateBlock(block.id, {
            params: {
              code: {
                ...p.code,
                variables
              }
            }
          });
        }}
        blocks={canvas?.blocks || []}
        currentBlockIndex={canvas?.blocks.findIndex(b => b.id === block?.id) || 0}
      />

      {/* 宏选择对话框 */}
      {macroDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-dark-800 border border-dark-700 rounded-lg p-4 w-80">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-dark-200">选择宏</h3>
              <button
                onClick={() => setMacroDialogOpen(false)}
                className="text-dark-500 hover:text-dark-300 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="space-y-2">
              {/* GOTO 宏 */}
              <div className="p-3 bg-dark-700/50 border border-dark-600 rounded">
                <div className="text-xs font-medium text-dark-200 mb-2">GOTO(blockIndex)</div>
                <div className="text-xs text-dark-500 mb-3">跳转到指定编号的积木块执行</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max={canvas?.blocks.length || 10}
                    defaultValue="1"
                    id="gotoBlockIndex"
                    className="flex-1 px-2 py-1 rounded bg-dark-600 border border-dark-500 text-dark-200 text-xs focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={() => {
                      const blockIndex = parseInt((document.getElementById('gotoBlockIndex') as HTMLInputElement).value) || 1;
                      if (block) {
                        const newContent = p.code.content ? p.code.content + '\n' : '';
                        updateBlock(block.id, {
                          params: {
                            code: {
                              ...p.code,
                              content: newContent + `// 跳转到第 ${blockIndex} 个积木块\nGOTO(${blockIndex - 1});`
                            }
                          }
                        });
                      }
                      setMacroDialogOpen(false);
                    }}
                    className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-xs hover:bg-blue-500/30 transition-colors"
                  >
                    插入
                  </button>
                </div>
              </div>

              {/* 其他宏 */}
              <div className="p-3 bg-dark-700/50 border border-dark-600 rounded">
                <div className="text-xs font-medium text-dark-200 mb-2">DELAY(ms)</div>
                <div className="text-xs text-dark-500 mb-3">延迟指定毫秒数</div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    defaultValue="1000"
                    id="delayMs"
                    className="flex-1 px-2 py-1 rounded bg-dark-600 border border-dark-500 text-dark-200 text-xs focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={() => {
                      const delayMs = parseInt((document.getElementById('delayMs') as HTMLInputElement).value) || 1000;
                      if (block) {
                        const newContent = p.code.content ? p.code.content + '\n' : '';
                        updateBlock(block.id, {
                          params: {
                            code: {
                              ...p.code,
                              content: newContent + `// 延迟 ${delayMs}ms\nDELAY(${delayMs});`
                            }
                          }
                        });
                      }
                      setMacroDialogOpen(false);
                    }}
                    className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-xs hover:bg-blue-500/30 transition-colors"
                  >
                    插入
                  </button>
                </div>
              </div>

              <div className="p-3 bg-dark-700/50 border border-dark-600 rounded">
                <div className="text-xs font-medium text-dark-200 mb-2">LOG(message)</div>
                <div className="text-xs text-dark-500 mb-3">输出日志信息</div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    defaultValue="Hello World"
                    id="logMessage"
                    className="flex-1 px-2 py-1 rounded bg-dark-600 border border-dark-500 text-dark-200 text-xs focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={() => {
                      const message = (document.getElementById('logMessage') as HTMLInputElement).value || 'Hello World';
                      if (block) {
                        const newContent = p.code.content ? p.code.content + '\n' : '';
                        updateBlock(block.id, {
                          params: {
                            code: {
                              ...p.code,
                              content: newContent + `// 输出日志\nLOG(\"${message}\");`
                            }
                          }
                        });
                      }
                      setMacroDialogOpen(false);
                    }}
                    className="px-2 py-1 rounded bg-blue-500/20 text-blue-400 text-xs hover:bg-blue-500/30 transition-colors"
                  >
                    插入
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ==================== 运行结果面板 ====================

const RunResultPanel: React.FC = () => {
  const { t } = useTranslation();
  const execution = useAutomationStore((s) => s.execution);
  const runLogs = useAutomationStore((s) => s.runLogs);

  return (
    <div className="px-4 py-3 border-t border-dark-700/30 max-h-48 overflow-y-auto">
      {runLogs.length === 0 ? (
        <p className="text-xs text-dark-500 text-center py-2">{t("automation.noRunResult")}</p>
      ) : (
        <div className="space-y-1">
          {runLogs.map((log, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className="text-dark-600 shrink-0 w-12 text-right font-mono text-[10px] pt-0.5">{log.time}</span>
              <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${log.status === "ok" ? "bg-green-500" : "bg-red-500"}`} />
              <div className="flex-1 min-w-0">
                <span className={log.status === "ok" ? "text-dark-300" : "text-red-400"}>
                  {log.label}
                </span>
                {log.message && (
                  <pre className="text-[10px] text-dark-500 mt-0.5 whitespace-pre-wrap break-all font-mono max-h-16 overflow-y-auto">
                    {Array.isArray(log.message) ? log.message.join('\n') : log.message}
                  </pre>
                )}
              </div>
            </div>
          ))}
          {/* 最终状态 */}
          {execution.status !== "running" && (
            <div className="flex items-center gap-2 text-xs pt-1 border-t border-dark-700/30 mt-1">
              <span className="text-dark-600 font-mono text-[10px]">
                {new Date().toLocaleTimeString()}
              </span>
              <span className={
                execution.status === "completed" ? "text-green-400" :
                execution.status === "stopped" ? "text-yellow-400" :
                execution.status === "error" ? "text-red-400" : "text-dark-400"
              }>
                {execution.status === "completed" ? t("automation.completed") :
                 execution.status === "stopped" ? t("automation.stopped") :
                 execution.status === "error" ? `${t("automation.error")}: ${execution.errorMessage}` :
                 execution.status}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ==================== 执行控制面板 ====================

const ExecutionPanel: React.FC<{ onToggleScreen: () => void; screenVisible: boolean; onGoHome: () => void }> = ({ onToggleScreen, screenVisible, onGoHome }) => {
  const { t } = useTranslation();
  const currentDevice = useDeviceStore((s) => s.currentDevice);
  const devices = useDeviceStore((s) => s.devices);
  const execution = useAutomationStore((s) => s.execution);
  const { runAll, stop } = useAutomationStore();

  const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";
  const isRunning = execution.status === "running";

  const handleRun = useCallback(() => {
    if (!currentDevice) return;
    runAll(currentPlatform, currentDevice);
  }, [currentDevice, currentPlatform, runAll]);

  const handleStop = useCallback(() => {
    stop();
  }, [stop]);

  const statusText = (() => {
    switch (execution.status) {
      case "running":
        return t("automation.running");
      case "completed":
        return t("automation.completed");
      case "stopped":
        return t("automation.stopped");
      case "error":
        return `${t("automation.error")}: ${execution.errorMessage}`;
      default:
        return "";
    }
  })();

  return (
    <div className="p-3 border-t border-dark-700/50 space-y-3">
      {/* 控制按钮 */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleRun}
          disabled={isRunning || !currentDevice}
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={t("automation.run")}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <polygon points="5,3 17,10 5,17" />
          </svg>
        </button>
        <button
          onClick={handleStop}
          disabled={!isRunning}
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title={t("automation.stop")}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
            <rect x="4" y="4" width="12" height="12" rx="1" />
          </svg>
        </button>
        <button
          onClick={onToggleScreen}
          className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
            screenVisible
              ? "bg-accent-500/20 text-accent-400 hover:bg-accent-500/30"
              : "bg-dark-700/50 text-dark-400 hover:text-dark-200 hover:bg-dark-700"
          }`}
          title={t("automation.screen")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </button>
        <div className="flex-1" />
        <button
          onClick={onGoHome}
          className="flex items-center justify-center w-9 h-9 rounded-lg bg-dark-700/50 text-dark-400 hover:text-dark-200 hover:bg-dark-700 transition-colors"
          title={t("automation.home")}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        </button>
      </div>

      {/* 进度 */}
      {execution.totalCount > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-dark-500">
              {t("automation.step")} {execution.executedCount}/{execution.totalCount}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-dark-700 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                execution.status === "error"
                  ? "bg-red-500"
                  : execution.status === "completed"
                    ? "bg-green-500"
                    : "bg-accent-500"
              }`}
              style={{
                width: `${execution.totalCount > 0 ? (execution.executedCount / execution.totalCount) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* 状态文字 */}
      {statusText && (
        <p
          className={`text-xs ${
            execution.status === "error"
              ? "text-red-400"
              : execution.status === "completed"
                ? "text-green-400"
                : "text-dark-400"
          }`}
        >
          {statusText}
        </p>
      )}
    </div>
  );
};

// ==================== 浮窗屏幕组件 ====================

interface CoordinateMarker {
  x: number;
  y: number;
  type: 'point' | 'rect' | 'circle';
  width?: number;  // 矩形宽度（归一化 0-1）
  height?: number; // 矩形高度（归一化 0-1）
  radius?: number; // 圆形半径（归一化 0-1）
}

interface FloatingScreenProps {
  /** 外部触发展开（如坐标输入时） */
  expandTrigger: number;
  /** 坐标动画点 [{x, y}]（归一化 0-1） */
  coordinateMarkers: CoordinateMarker[];
  /** 取色回调，传入 RGBA 对象 */
  onPickColor?: (color: { r: number; g: number; b: number; a: number }) => void;
  /** 是否处于取色模式 */
  pickColorMode?: boolean;
  /** 退出取色模式 */
  onExitPickColor?: () => void;
  /** 外部控制是否显示 */
  visible: boolean;
  /** 外部关闭 */
  onClose: () => void;
}

const FloatingScreen: React.FC<FloatingScreenProps> = ({ expandTrigger, coordinateMarkers, onPickColor, pickColorMode, onExitPickColor, visible, onClose }) => {
  const { t } = useTranslation();
  const currentDevice = useDeviceStore((s) => s.currentDevice);
  const devices = useDeviceStore((s) => s.devices);
  const homeCache = useDeviceStore((s) => s.homeCache);
  const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";

  const [screenshot, setScreenshot] = useState<string>("");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(1000);
  const [markers, setMarkers] = useState<Array<CoordinateMarker & { id: number }>>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const markerIdRef = useRef(0);
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [deviceResolution, setDeviceResolution] = useState({ width: 1080, height: 2400 });

  // 截图函数
  const doScreenshot = useCallback(async () => {
    if (!currentDevice) return;
    try {
      const base64 = currentPlatform === "harmonyos"
        ? await hdcScreenshot(currentDevice)
        : await takeScreenshot(currentDevice);
      setScreenshot(base64);
    } catch {}
  }, [currentDevice, currentPlatform]);

  // 可见时截图和获取设备分辨率
  useEffect(() => {
    if (visible && currentDevice) {
      doScreenshot();
      // 获取设备实际分辨率
      const res = homeCache[currentDevice]?.screenRes || "";
      const m = res.match(/(\d+)x(\d+)/);
      if (m) {
        setDeviceResolution({
          width: parseInt(m[1]),
          height: parseInt(m[2])
        });
      }
    }
  }, [visible, doScreenshot, currentDevice, homeCache]);

  // 自动刷新
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (autoRefresh && currentDevice && visible) {
      timerRef.current = setInterval(doScreenshot, refreshInterval);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, refreshInterval, doScreenshot, currentDevice, visible]);

  // 外部触发展开
  useEffect(() => {
    if (expandTrigger > 0) {
      doScreenshot();
    }
  }, [expandTrigger, doScreenshot]);

  // 坐标标记动画
  useEffect(() => {
    console.log('[FloatingScreen] 接收到坐标标记:', coordinateMarkers);
    if (coordinateMarkers.length > 0) {
      const newMarkers = coordinateMarkers.map((m) => ({ ...m, id: markerIdRef.current++ }));
      console.log('[FloatingScreen] 处理后的标记:', newMarkers);
      setMarkers(newMarkers);
      // 矩形和圆形标记显示时间更长
      const displayTime = coordinateMarkers.some(m => m.type !== 'point') ? 5000 : 2000;
      console.log('[FloatingScreen] 标记显示时间:', displayTime);
      setTimeout(() => setMarkers([]), displayTime);
    }
  }, [coordinateMarkers]);

  // 取色模式：点击截图获取颜色
  const handleScreenClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (!pickColorMode || !onPickColor) return;
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * img.naturalWidth);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * img.naturalHeight);

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const pixel = ctx.getImageData(x, y, 1, 1).data;
    onPickColor({ r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] });
    onExitPickColor?.();
  }, [pickColorMode, onPickColor, onExitPickColor]);

  // 取色模式进入时自动刷新
  useEffect(() => {
    if (pickColorMode && visible) {
      doScreenshot();
    }
  }, [pickColorMode, doScreenshot, visible]);

  // 图片加载时更新尺寸
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
  }, []);

  // 监听容器尺寸变化
  useEffect(() => {
    if (!imgContainerRef.current || !visible) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });

    resizeObserver.observe(imgContainerRef.current);
    return () => resizeObserver.disconnect();
  }, [visible]);

  // 计算图片在容器中的实际位置和尺寸（考虑 object-contain）
  const getImageDisplayRect = useCallback(() => {
    if (imageSize.width === 0 || imageSize.height === 0 || containerSize.width === 0 || containerSize.height === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const imageRatio = imageSize.width / imageSize.height;
    const containerRatio = containerSize.width / containerSize.height;

    let displayWidth, displayHeight;
    if (imageRatio > containerRatio) {
      displayWidth = containerSize.width;
      displayHeight = containerSize.width / imageRatio;
    } else {
      displayHeight = containerSize.height;
      displayWidth = containerSize.height * imageRatio;
    }

    const x = (containerSize.width - displayWidth) / 2;
    const y = (containerSize.height - displayHeight) / 2;

    return { x, y, width: displayWidth, height: displayHeight };
  }, [imageSize, containerSize]);

  if (!currentDevice || !visible) return null;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-2 py-1 bg-dark-800/80 border-b border-dark-700/50 shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            onClick={doScreenshot}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-dark-400 hover:text-dark-200 hover:bg-dark-700 transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
            {t("common.refresh")}
          </button>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-colors ${
              autoRefresh ? "text-green-400 bg-green-500/10" : "text-dark-400 hover:text-dark-200 hover:bg-dark-700"
            }`}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            {t("automation.autoRefresh")}
          </button>
          {autoRefresh && (
            <div className="flex items-center gap-0.5">
              <input
                type="number" min={200} max={10000} step={100}
                value={refreshInterval}
                onChange={(e) => setRefreshInterval(Math.max(200, parseInt(e.target.value) || 1000))}
                className="w-14 px-1 py-0.5 text-[10px] bg-dark-700 border border-dark-600 rounded text-dark-200 text-center focus:outline-none focus:border-accent-500"
              />
              <span className="text-[9px] text-dark-500">ms</span>
            </div>
          )}
        </div>
        <button
          onClick={() => { onClose(); setAutoRefresh(false); onExitPickColor?.(); }}
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-dark-700 text-dark-400 hover:text-dark-200 transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      {/* 取色模式提示 */}
      {pickColorMode && (
        <div className="px-2 py-0.5 bg-amber-500/10 border-b border-amber-500/20 text-[10px] text-amber-400 flex items-center justify-between shrink-0">
          <span>🎯 {t("automation.pickColorHint")}</span>
          <button onClick={() => onExitPickColor?.()} className="text-dark-400 hover:text-dark-200 ml-1">✕</button>
        </div>
      )}
      {/* 屏幕内容 */}
      <div className="flex-1 flex items-center justify-center bg-black/50 overflow-hidden p-2">
        <div ref={imgContainerRef} className="relative w-full h-full">
          {screenshot ? (
            <img
              ref={imgRef}
              src={`data:image/jpeg;base64,${screenshot}`}
              alt="screen"
              className={`w-full h-full object-contain bg-black rounded ${pickColorMode ? "cursor-crosshair" : ""}`}
              draggable={false}
              onClick={handleScreenClick}
              onLoad={handleImageLoad}
            />
          ) : (
            <div className="w-full h-full bg-dark-800 flex items-center justify-center rounded">
              <span className="text-xs text-dark-500">{t("common.loading")}</span>
            </div>
          )}
          {markers.map((m) => {
            const rect = getImageDisplayRect();
            console.log('[FloatingScreen] 渲染标记:', m, 'rect:', rect, 'imageSize:', imageSize);
            if (rect.width === 0 || rect.height === 0 || imageSize.width === 0 || imageSize.height === 0) {
              console.log('[FloatingScreen] 跳过渲染：尺寸为0');
              return null;
            }
            
            // 计算设备坐标到截图坐标的映射
            // m.x 和 m.y 是相对于设备实际分辨率的归一化坐标 (0-1)
            
            // 获取设备实际分辨率和截图分辨率
            const deviceWidth = deviceResolution.width;
            const deviceHeight = deviceResolution.height;
            const screenshotWidth = imageSize.width;
            const screenshotHeight = imageSize.height;
            
            // 计算设备和截图的宽高比
            const deviceRatio = deviceWidth / deviceHeight;
            const screenshotRatio = screenshotWidth / screenshotHeight;
            
            let adjustedX = m.x;
            let adjustedY = m.y;
            let adjustedWidth = m.width || 0;
            let adjustedHeight = m.height || 0;
            let adjustedRadius = m.radius || 0;
            
            // 处理宽高比差异
            if (deviceRatio > screenshotRatio) {
              // 设备更宽，截图在宽度方向被裁剪或压缩
              // 调整X坐标和宽度
              const scale = screenshotRatio / deviceRatio;
              const offset = (1 - scale) / 2;
              adjustedX = m.x * scale + offset;
              adjustedWidth = (m.width || 0) * scale;
              adjustedRadius = (m.radius || 0) * scale;
            } else if (deviceRatio < screenshotRatio) {
              // 设备更高，截图在高度方向被裁剪或压缩
              // 调整Y坐标和高度
              const scale = deviceRatio / screenshotRatio;
              const offset = (1 - scale) / 2;
              adjustedY = m.y * scale + offset;
              adjustedHeight = (m.height || 0) * scale;
              adjustedRadius = (m.radius || 0) * scale;
            }
            
            // 确保坐标在0-1范围内
            adjustedX = Math.max(0, Math.min(1, adjustedX));
            adjustedY = Math.max(0, Math.min(1, adjustedY));
            
            // 转换为屏幕显示坐标
            const left = rect.x + adjustedX * rect.width;
            const top = rect.y + adjustedY * rect.height;
            const width = adjustedWidth * rect.width;
            const height = adjustedHeight * rect.height;
            const radius = adjustedRadius * Math.min(rect.width, rect.height);
            
            console.log('[FloatingScreen] 计算后的坐标:', { left, top, width, height, radius });
            
            // 渲染不同类型的标记
            if (m.type === 'point' || m.type === 'rect' || m.type === 'circle') {
              return (
                <div
                  key={m.id}
                  className="absolute pointer-events-none"
                  style={{ left: `${left}px`, top: `${top}px`, transform: "translate(-50%, -50%)", zIndex: 1000 }}
                >
                  <div className="w-6 h-6 rounded-full border-2 border-red-400 bg-red-400/30 animate-ping" />
                  <div className="absolute inset-0 w-6 h-6 rounded-full border-2 border-red-400" />
                </div>
              );
            } else if (m.type === 'rect') {
              return (
                <div
                  key={m.id}
                  className="absolute pointer-events-none"
                  style={{ 
                    left: `${left}px`, 
                    top: `${top}px`, 
                    width: `${width}px`, 
                    height: `${height}px`,
                    zIndex: 1000
                  }}
                >
                  <div className="w-full h-full border-2 border-blue-400 bg-blue-400/20" />
                  <div className="absolute inset-0 w-full h-full border-2 border-blue-400 animate-pulse" />
                </div>
              );
            } else if (m.type === 'circle') {
              return (
                <div
                  key={m.id}
                  className="absolute pointer-events-none"
                  style={{ 
                    left: `${left}px`, 
                    top: `${top}px`, 
                    width: `${radius * 2}px`, 
                    height: `${radius * 2}px`,
                    transform: "translate(-50%, -50%)",
                    zIndex: 1000
                  }}
                >
                  <div className="w-full h-full rounded-full border-2 border-green-400 bg-green-400/20" />
                  <div className="absolute inset-0 w-full h-full rounded-full border-2 border-green-400 animate-pulse" />
                </div>
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
};

// ==================== 自动化主页 (AutomationHome) ====================

const AutomationHome: React.FC<{ onEnterEditor: () => void }> = ({ onEnterEditor }) => {
  const { t } = useTranslation();
  const canvases = useAutomationStore((s) => s.canvases);
  const queue = useAutomationStore((s) => s.queue);
  const { createCanvas, switchCanvas, deleteCanvas, exportCanvas, importCanvas, addToQueue, runQueue } = useAutomationStore();
  const { currentDevice, devices } = useDeviceStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isInputDialogOpen, setIsInputDialogOpen] = useState(false);
  
  const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";

  const handleNewCanvas = useCallback(() => {
    console.log("[AutomationHome] handleNewCanvas 被调用");
    setIsInputDialogOpen(true);
  }, []);

  const handleConfirmNewCanvas = useCallback((name: string) => {
    console.log("[AutomationHome] handleConfirmNewCanvas被调用, 名称:", name);
    setIsInputDialogOpen(false);
    createCanvas(name.trim());
    onEnterEditor();
  }, [createCanvas, onEnterEditor]);

  const handleCancelNewCanvas = useCallback(() => {
    console.log("[AutomationHome] handleCancelNewCanvas被调用");
    setIsInputDialogOpen(false);
  }, []);

  const handleImportCanvas = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const success = importCanvas(reader.result as string);
      if (success) {
        onEnterEditor();
      } else {
        alert(t("automation.importFailed"));
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [importCanvas, onEnterEditor, t]);

  const handleExport = useCallback(async (canvasId: string, canvasName: string) => {
    const json = exportCanvas(canvasId);
    if (!json) return;
    
    // 使用 Tauri 的文件保存对话框
    const filePath = await dialog.save({
      defaultPath: `${canvasName}.auto`,
      filters: [{
        name: "Automation Files",
        extensions: ["auto"]
      }]
    });
    
    if (filePath) {
      // 写入文件 - 将字符串转换为 Uint8Array
      const encoder = new TextEncoder();
      const data = encoder.encode(json);
      await writeFile(filePath, data);
    }
  }, [exportCanvas]);

  const handleOpenCanvas = useCallback((canvasId: string) => {
    switchCanvas(canvasId);
    onEnterEditor();
  }, [switchCanvas, onEnterEditor]);

  const handleDelete = useCallback((e: React.MouseEvent, canvasId: string) => {
    e.stopPropagation();
    const confirmed = confirm(t("automation.deleteConfirm"));
    if (confirmed) {
      deleteCanvas(canvasId);
    }
  }, [deleteCanvas, t]);

  const handleAddToQueue = useCallback(async (e: React.MouseEvent, canvasId: string) => {
    e.stopPropagation();
    const isRunning = queue.some(item => item.status === "running");
    addToQueue(canvasId);
    
    // 如果队列没有正在运行的项目且有设备连接，自动开始运行
    if (!isRunning && currentDevice) {
      await runQueue(currentPlatform, currentDevice);
    }
  }, [addToQueue, queue, currentDevice, currentPlatform, runQueue]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 overflow-auto">
      <input
        ref={fileInputRef}
        type="file"
        accept=".auto"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 顶部按钮 */}
      <div className="flex gap-3 mb-8">
        <button
          onClick={() => {
            handleNewCanvas();
          }}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent-500 text-white hover:bg-accent-600 transition-colors text-sm font-medium"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          {t("automation.newCanvas")}
        </button>
        <button
          onClick={handleImportCanvas}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-dark-700 text-dark-200 hover:bg-dark-600 border border-dark-600 transition-colors text-sm font-medium"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {t("automation.importCanvas")}
        </button>
      </div>

      {/* 画布列表 */}
      <div className="w-full max-w-2xl">
        <h2 className="text-sm text-dark-400 font-medium mb-3">{t("automation.canvasList")}</h2>
        {canvases.length === 0 ? (
          <div className="text-center py-16">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="mx-auto text-dark-700 mb-4">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
            </svg>
            <p className="text-dark-500 text-sm">{t("automation.noCanvas")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {canvases.map((canvas) => (
              <div
                key={canvas.id}
                onClick={() => handleOpenCanvas(canvas.id)}
                className="flex items-center gap-3 px-4 py-3 rounded-lg bg-dark-800 hover:bg-dark-700 border border-dark-700 hover:border-dark-600 cursor-pointer transition-all group"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-dark-500 shrink-0">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <line x1="3" y1="9" x2="21" y2="9" />
                  <line x1="9" y1="9" x2="9" y2="21" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-dark-200 font-medium truncate">{canvas.name}</div>
                  <div className="text-xs text-dark-500">{canvas.blocks.length} {t("automation.blocks")}</div>
                </div>
                {/* hover 时显示的操作按钮 */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => handleAddToQueue(e, canvas.id)}
                    className="p-1.5 rounded-md text-dark-400 hover:text-green-400 hover:bg-dark-600 transition-colors"
                    title="添加到运行队列"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5,3 19,12 5,21" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleExport(canvas.id, canvas.name); }}
                    className="p-1.5 rounded-md text-dark-400 hover:text-accent-400 hover:bg-dark-600 transition-colors"
                    title={t("automation.exportCanvas")}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  </button>
                  <button
                    onClick={(e) => handleDelete(e, canvas.id)}
                    className="p-1.5 rounded-md text-dark-400 hover:text-red-400 hover:bg-dark-600 transition-colors"
                    title={t("common.delete")}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 输入对话框 */}
      <InputDialog
        isOpen={isInputDialogOpen}
        title={t("automation.newCanvas")}
        message={t("automation.canvasName")}
        placeholder={t("automation.canvasName")}
        defaultValue={`画布 ${Date.now()}`}
        onConfirm={handleConfirmNewCanvas}
        onCancel={handleCancelNewCanvas}
      />
    </div>
  );
};

// ==================== 主页面 (AutomationPage) ====================

const AutomationPage: React.FC = () => {
  const { t } = useTranslation();
  const currentDevice = useDeviceStore((s) => s.currentDevice);
  const devices = useDeviceStore((s) => s.devices);
  const { load, canvasExpanded, toggleCanvas } = useAutomationStore();

  const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";

  // 视图状态：home 或 editor
  const [view, setView] = useState<"home" | "editor">(
    () => useAutomationStore.getState().canvases.length > 0 && useAutomationStore.getState().activeCanvasId ? "editor" : "home"
  );

  // 浮窗控制
  const [expandTrigger, setExpandTrigger] = useState(0);
  const [coordMarkers, setCoordMarkers] = useState<CoordinateMarker[]>([]);
  const [showScreen, setShowScreen] = useState(false);

  // 坐标输入时触发浮窗展开+动画
  const onCoordInput = useCallback((coord: any) => {
    console.log('[onCoordInput] 坐标输入:', coord);
    setShowScreen(true);
    const res = currentDevice ? (useDeviceStore.getState().homeCache[currentDevice]?.screenRes || "") : "";
    const m = res.match(/(\d+)x(\d+)/);
    const w = m ? parseInt(m[1]) : 1080;
    const h = m ? parseInt(m[2]) : 2400;
    console.log('[onCoordInput] 设备分辨率:', { w, h });
    
    // 处理不同类型的坐标
    let marker: CoordinateMarker;
    
    if (coord.type === 'random_rect') {
      marker = {
        type: 'rect',
        x: Number(coord.x) / w,
        y: Number(coord.y) / h,
        width: Number(coord.rectParams?.width) / w,
        height: Number(coord.rectParams?.height) / h,
      };
    } else if (coord.type === 'random_circle') {
      marker = {
        type: 'circle',
        x: Number(coord.x) / w,
        y: Number(coord.y) / h,
        radius: Number(coord.circleParams?.radius) / Math.min(w, h),
      };
    } else {
      // 固定坐标或其他类型
      marker = {
        type: 'point',
        x: Number(coord.x) / w,
        y: Number(coord.y) / h,
      };
    }
    
    console.log('[onCoordInput] 生成的标记:', marker);
    setCoordMarkers([marker]);
  }, []);

  // 取色状态
  const [pickColorMode, setPickColorMode] = useState(false);
  const [pickColorTarget, setPickColorTarget] = useState<string>(""); // "condition.expected"
  const onPickColor = useCallback((color: { r: number; g: number; b: number; a: number }) => {
    setPickColorMode(false);
    if (!pickColorTarget) return;
    const updateBlock = useAutomationStore.getState().updateBlock;
    const selectedId = useAutomationStore.getState().selectedBlockId;
    if (!selectedId) return;
    updateBlock(selectedId, {
      params: {
        ...(useAutomationStore.getState().activeCanvas()?.blocks.find((b) => b.id === selectedId)?.params as any),
        [pickColorTarget.split(".")[0]]: {
          ...(useAutomationStore.getState().activeCanvas()?.blocks.find((b) => b.id === selectedId)?.params as any)?.[pickColorTarget.split(".")[0]],
          expected: color,
        },
      },
    } as Partial<ActionBlock>);
  }, [pickColorTarget]);
  const startPickColor = useCallback((target: string) => {
    setPickColorTarget(target);
    setPickColorMode(true);
    setShowScreen(true);
  }, []);

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="h-full flex flex-col animate-fade-in">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700/50 shrink-0">
        <h1
          className="text-lg font-semibold text-dark-100 cursor-pointer hover:text-accent-400 transition-colors"
          onClick={() => setView("home")}
        >
          {t("automation.title")}
        </h1>
        <div className="flex items-center gap-2">
          <span className="text-xs text-dark-500">
            {currentDevice
              ? `${currentPlatform.toUpperCase()} - ${currentDevice.slice(0, 12)}`
              : t("device.noDevice")}
          </span>
        </div>
      </div>

      {view === "home" ? (
        <AutomationHome onEnterEditor={() => setView("editor")} />
      ) : (
        <>
          {/* 主体三栏布局 */}
          <div className="flex-1 flex overflow-hidden">
        {/* 左侧面板：积木块 + 画布列表 */}
        <div className="w-48 border-r border-dark-700/50 flex flex-col shrink-0 bg-dark-900/30">
          <div className="flex-1 overflow-y-auto p-2 space-y-4">
            {/* 积木块面板 */}
            <div>
              <span className="text-xs text-dark-500 font-medium mb-2 block">
                {t("automation.title")}
              </span>
              <BlockPalette />
            </div>

            {/* 分隔线 */}
            <div className="border-t border-dark-700/50" />

            {/* 画布列表 */}
            <CanvasList />
          </div>
        </div>

        {/* 中间：执行画布 */}
        <div className="flex-1 flex flex-col overflow-hidden bg-dark-950/30 relative">
          <AutomationCanvas />
          {/* 屏幕浮层（居中，占中间区域 90%） */}
          {showScreen && (
            <div className="absolute inset-0 z-30 flex items-center justify-center p-4">
              <div className="relative w-[90%] h-[90%] bg-dark-800 border border-dark-700/50 rounded-xl shadow-2xl shadow-black/50 flex flex-col overflow-hidden">
                <FloatingScreen expandTrigger={expandTrigger} coordinateMarkers={coordMarkers}
                  onPickColor={onPickColor} pickColorMode={pickColorMode}
                  onExitPickColor={() => setPickColorMode(false)}
                  visible={showScreen} onClose={() => setShowScreen(false)} />
              </div>
            </div>
          )}
        </div>

        {/* 右侧面板：属性编辑 + 执行控制 */}
        <div className="w-64 border-l border-dark-700/50 flex flex-col shrink-0 bg-dark-900/30">
          <div className="flex-1 overflow-hidden flex flex-col">
            <BlockInspector onCoordInput={onCoordInput} platform={currentPlatform} onStartPickColor={startPickColor} />
          </div>
          <ExecutionPanel onToggleScreen={() => setShowScreen(!showScreen)} screenVisible={showScreen} onGoHome={() => setView("home")} />
        </div>
      </div>

      {/* 底部运行结果面板 */}
      <div className="border-t border-dark-700/50 shrink-0">
        <button
          onClick={toggleCanvas}
          className="w-full flex items-center justify-center gap-1.5 px-4 py-1.5 text-xs text-dark-500 hover:text-dark-300 hover:bg-dark-800 transition-colors"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className={`transition-transform ${canvasExpanded ? "rotate-180" : ""}`}
          >
            <polyline points="5 13 10 8 15 13" />
          </svg>
          {canvasExpanded ? t("common.close") : t("automation.runResult")}
        </button>
        {canvasExpanded && (
          <RunResultPanel />
        )}
      </div>
        </>
      )}
      <QueuePanel />
    </div>
  );
};

export default AutomationPage;
