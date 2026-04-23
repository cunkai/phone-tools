import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAutomationStore } from "../store/automationStore";
import { useDeviceStore } from "../store/deviceStore";
import ResultDialog from "./ResultDialog";

const QueuePanel: React.FC = () => {
  const { t } = useTranslation();
  const { queue, removeFromQueue, clearQueue, runQueue, stopQueue, runLogs } = useAutomationStore();
  const { currentDevice, devices } = useDeviceStore();
  const [expanded, setExpanded] = useState(true);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);
  const [selectedCanvasName, setSelectedCanvasName] = useState("");

  const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";
  const isRunning = queue.some(item => item.status === "running");

  const handleToggleQueue = async () => {
    if (isRunning) {
      stopQueue();
    } else {
      if (!currentDevice) return;
      await runQueue(currentPlatform, currentDevice);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "running":
        return "text-green-400 bg-green-400/10 border-green-400/30";
      case "pending":
        return "text-yellow-400 bg-yellow-400/10 border-yellow-400/30";
      case "completed":
        return "text-blue-400 bg-blue-400/10 border-blue-400/30";
      case "error":
        return "text-red-400 bg-red-400/10 border-red-400/30";
      case "stopped":
        return "text-gray-400 bg-gray-400/10 border-gray-400/30";
      default:
        return "text-dark-400 bg-dark-800 border-dark-600";
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "running":
        return "运行中";
      case "pending":
        return "等待中";
      case "completed":
        return "已完成";
      case "error":
        return "出错";
      case "stopped":
        return "已停止";
      default:
        return "未知";
    }
  };

  if (queue.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 w-72">
      <div className="bg-dark-900/95 border border-dark-700 rounded-xl shadow-2xl backdrop-blur-sm">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700">
          <div className="flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent-400">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span className="font-semibold text-dark-100 text-sm">运行队列 ({queue.length})</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 hover:bg-dark-700 rounded transition-colors text-dark-400"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className={`transition-transform ${expanded ? "rotate-180" : ""}`}
              >
                <polyline points="6 8 10 12 14 8" />
              </svg>
            </button>
            <button
              onClick={clearQueue}
              className="p-1 hover:bg-dark-700 rounded transition-colors text-dark-400"
              title="清空队列"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="4" y1="7" x2="20" y2="7" />
                <path d="M9 7v-2a1 1 0 011-1h4a1 1 0 011 1v2" />
                <path d="M19 7v14a2 2 0 01-2 2H7a2 2 0 01-2-2V7" />
              </svg>
            </button>
          </div>
        </div>

        {/* 队列内容 */}
        {expanded && (
          <div className="max-h-64 overflow-y-auto">
            {queue.map((item, idx) => (
              <div
                key={item.id}
                className="flex items-center gap-3 px-4 py-2 border-b border-dark-700/50 last:border-0 hover:bg-dark-800/50 transition-colors"
              >
                <span className="text-xs text-dark-500 w-6">{idx + 1}</span>
                <span className="flex-1 text-sm text-dark-200 truncate">{item.canvasName}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${getStatusColor(item.status)}`}>
                  {getStatusText(item.status)}
                </span>
                {(item.status === "completed" || item.status === "error") && (
                  <button
                    onClick={() => {
                      setSelectedCanvasName(item.canvasName);
                      setResultDialogOpen(true);
                    }}
                    className="p-1 hover:bg-dark-700 rounded transition-colors text-dark-400 hover:text-accent-400"
                    title="查看结果"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </button>
                )}
                <button
                  onClick={() => removeFromQueue(item.id)}
                  className="p-1 hover:bg-dark-700 rounded transition-colors text-dark-400 hover:text-red-400"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="4" y1="4" x2="20" y2="20" />
                    <line x1="20" y1="4" x2="4" y2="20" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-2 px-4 py-3 border-t border-dark-700">
          <button
            onClick={handleToggleQueue}
            disabled={!currentDevice && !isRunning}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed ${
              isRunning 
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" 
                : "bg-green-500/20 text-green-400 hover:bg-green-500/30"
            }`}
          >
            {isRunning ? (
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <rect x="4" y="4" width="12" height="12" rx="1" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                <polygon points="5,3 17,10 5,17" />
              </svg>
            )}
            {isRunning ? "停止运行" : "开始运行"}
          </button>
        </div>
      </div>

      {/* 结果对话框 */}
      <ResultDialog
        isOpen={resultDialogOpen}
        onClose={() => setResultDialogOpen(false)}
        results={runLogs}
        canvasName={selectedCanvasName}
      />
    </div>
  );
};

export default QueuePanel;
