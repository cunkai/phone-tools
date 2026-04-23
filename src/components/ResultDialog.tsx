import React, { useState } from "react";
import { useTranslation } from "react-i18next";

interface ResultDialogProps {
  isOpen: boolean;
  onClose: () => void;
  results: Array<{
    time: string;
    status: "ok" | "error";
    label: string;
    message?: string | string[];
  }>;
  canvasName: string;
}

const ResultDialog: React.FC<ResultDialogProps> = ({ isOpen, onClose, results, canvasName }) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  // 生成可复制的文本
  const generateCopyText = () => {
    let text = `画布: ${canvasName}\n`;
    text += `运行结果 (${results.length} 个步骤)\n`;
    text += "=" .repeat(50) + "\n";
    
    results.forEach((result, index) => {
      text += `[${result.time}] ${index + 1}. ${result.label} - ${result.status === "ok" ? "成功" : "失败"}\n`;
      if (result.message) {
        text += `   结果: ${Array.isArray(result.message) ? result.message.join('\n       ') : result.message}\n`;
      }
    });
    
    text += "=" .repeat(50) + "\n";
    const successCount = results.filter(r => r.status === "ok").length;
    text += `总计: ${successCount} 成功, ${results.length - successCount} 失败`;
    
    return text;
  };

  const handleCopy = () => {
    const text = generateCopyText();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    const text = generateCopyText();
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${canvasName}_运行结果_${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-dark-900 border border-dark-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-hidden">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-dark-700">
          <h3 className="font-semibold text-dark-100">{canvasName} - 运行结果</h3>
          <button
            onClick={onClose}
            className="p-1 hover:bg-dark-700 rounded transition-colors text-dark-400"
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="4" x2="16" y2="16" />
              <line x1="16" y1="4" x2="4" y2="16" />
            </svg>
          </button>
        </div>

        {/* 结果内容 */}
        <div className="px-4 py-3 max-h-[60vh] overflow-y-auto">
          {results.length === 0 ? (
            <p className="text-center text-dark-500 py-4">无运行结果</p>
          ) : (
            <div className="space-y-2">
              {results.map((result, index) => (
                <div key={index} className="border border-dark-700 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-dark-200">{index + 1}. {result.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-dark-500">{result.time}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${result.status === "ok" ? "bg-green-400/20 text-green-400" : "bg-red-400/20 text-red-400"}`}>
                        {result.status === "ok" ? "成功" : "失败"}
                      </span>
                    </div>
                  </div>
                  {result.message && (
                    <pre className="text-xs text-dark-400 bg-dark-800 rounded p-2 mt-1 overflow-x-auto">
                      {Array.isArray(result.message) ? result.message.join('\n') : result.message}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 统计信息 */}
        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-dark-700 bg-dark-800/50">
            <div className="flex justify-between text-sm">
              <span className="text-dark-400">
                总计: {results.length} 个步骤
              </span>
              <span className="text-dark-400">
                成功: {results.filter(r => r.status === "ok").length}, 
                失败: {results.filter(r => r.status === "error").length}
              </span>
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-2 px-4 py-3 border-t border-dark-700">
          <button
            onClick={handleCopy}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
            {copied ? "已复制" : "复制结果"}
          </button>
          <button
            onClick={handleSave}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-accent-500/20 text-accent-400 hover:bg-accent-500/30 transition-colors text-sm"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            保存结果
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResultDialog;