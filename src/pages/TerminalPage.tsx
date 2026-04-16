import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useDeviceStore } from "../store/deviceStore";
import { executeShell, hdcShell } from "../api/adb";
import { onShellOutput } from "../api/events";

interface HistoryEntry {
  command: string;
  output: string;
  isError: boolean;
}

const TerminalPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentDevice, devices } = useDeviceStore();
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isExecuting, setIsExecuting] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    onShellOutput((event) => {
      setHistory((prev) => {
        const last = prev[prev.length - 1];
        if (last && !last.isError) {
          return [
            ...prev.slice(0, -1),
            { ...last, output: last.output + event.output },
          ];
        }
        return prev;
      });
      setIsExecuting(false);
    }).then((unlisten) => {
      unlistenRef.current = unlisten;
    });

    return () => {
      unlistenRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  const executeCommand = useCallback(
    async (command: string) => {
      if (!currentDevice || !command.trim() || isExecuting) return;

      const trimmed = command.trim();
      setHistory((prev) => [
        ...prev,
        { command: trimmed, output: "", isError: false },
      ]);
      setCommandHistory((prev) => [...prev, trimmed]);
      setHistoryIndex(-1);
      setInput("");
      setIsExecuting(true);

      try {
        const platform = devices.find((d) => d.serial === currentDevice)?.platform || "android";
        const shellFn = platform === "harmonyos" ? hdcShell : executeShell;
        const output = await shellFn(currentDevice, trimmed);
        setHistory((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = { ...last, output };
          return updated;
        });
      } catch (err) {
        setHistory((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            output: err instanceof Error ? err.message : "Error",
            isError: true,
          };
          return updated;
        });
      } finally {
        setIsExecuting(false);
      }
    },
    [currentDevice, isExecuting, devices]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      executeCommand(input);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const newIndex =
        historyIndex === -1
          ? commandHistory.length - 1
          : Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setInput(commandHistory[newIndex]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === -1) return;
      const newIndex = historyIndex + 1;
      if (newIndex >= commandHistory.length) {
        setHistoryIndex(-1);
        setInput("");
      } else {
        setHistoryIndex(newIndex);
        setInput(commandHistory[newIndex]);
      }
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setHistory([]);
    }
  };

  const quickCommands = ["ls", "top -n 1", "df -h", "pm list packages -3", "getprop", "wm size"];

  return (
    <div className="p-6 h-full flex flex-col animate-fade-in">
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <h1 className="text-xl font-semibold text-dark-100">
          {t("terminal.shellTerminal")}
        </h1>
        <button
          onClick={() => setHistory([])}
          className="px-3 py-1.5 rounded-lg bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors text-sm"
        >
          {t("terminal.clear")}
        </button>
      </div>

      {/* Quick Commands */}
      <div className="flex gap-2 mb-3 flex-shrink-0 flex-wrap">
        {quickCommands.map((cmd) => (
          <button
            key={cmd}
            onClick={() => executeCommand(cmd)}
            disabled={!currentDevice || isExecuting}
            className="px-2.5 py-1 rounded bg-dark-800 border border-dark-700/50 text-xs text-dark-400 hover:text-dark-200 hover:border-dark-600 disabled:opacity-50 transition-colors font-mono"
          >
            {cmd}
          </button>
        ))}
      </div>

      {/* Terminal Output */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto bg-dark-900 border border-dark-700/30 rounded-xl p-4 font-mono text-sm"
        onClick={() => inputRef.current?.focus()}
      >
        {history.length === 0 && (
          <p className="text-dark-500">{t("terminal.noOutput")}</p>
        )}
        {history.map((entry, i) => (
          <div key={i} className="mb-3">
            <div className="flex items-center gap-2">
              <span className="text-accent-400">$</span>
              <span className="text-dark-200">{entry.command}</span>
            </div>
            {entry.output && (
              <pre
                className={`mt-1 whitespace-pre-wrap break-all text-xs ${
                  entry.isError ? "text-red-400" : "text-dark-400"
                }`}
              >
                {entry.output}
              </pre>
            )}
            {i === history.length - 1 && isExecuting && (
              <div className="flex items-center gap-2 mt-1">
                <div className="w-1.5 h-1.5 bg-accent-500 rounded-full animate-pulse" />
                <span className="text-xs text-dark-500">Executing...</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="mt-3 flex items-center gap-2 flex-shrink-0">
        <span className="text-accent-400 font-mono text-sm">$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("terminal.inputCommand")}
          disabled={!currentDevice}
          className="flex-1 px-3 py-2 bg-dark-800 border border-dark-700/50 rounded-lg font-mono text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent-500 disabled:opacity-50 transition-colors"
        />
        <button
          onClick={() => executeCommand(input)}
          disabled={!currentDevice || !input.trim() || isExecuting}
          className="px-4 py-2 rounded-lg bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
        >
          {t("terminal.execute")}
        </button>
      </div>
    </div>
  );
};

export default TerminalPage;
