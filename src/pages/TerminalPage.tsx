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

interface CustomCommand {
  id: string;
  name: string;
  command: string;
}

interface AvailableCommand {
  name: string;
  path: string;
  example?: string;
}

const STORAGE_KEY = "terminal_custom_commands";
const TERMINAL_STATE_KEY = "terminal_state";

function loadCustomCommands(): CustomCommand[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveCustomCommands(cmds: CustomCommand[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cmds));
}

function loadTerminalState() {
  try {
    const raw = localStorage.getItem(TERMINAL_STATE_KEY);
    if (raw) {
      const state = JSON.parse(raw);
      return {
        input: state.input || "",
        commandHistory: state.commandHistory || [],
        history: state.history || [],
      };
    }
  } catch (err) {
    console.error("Failed to load terminal state:", err);
  }
  return {
    input: "",
    commandHistory: [],
    history: [],
  };
}

function saveTerminalState(state: {
  input: string;
  commandHistory: string[];
  history: HistoryEntry[];
}) {
  try {
    localStorage.setItem(TERMINAL_STATE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error("Failed to save terminal state:", err);
  }
}

const TERMINAL_PAGE = "terminal";

const TerminalPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentDevice, devices } = useDeviceStore();
  const { input: savedInput, commandHistory: savedHistory, history: savedTerminalHistory } = loadTerminalState();
  const [input, setInput] = useState(savedInput);
  const [history, setHistory] = useState<HistoryEntry[]>(savedTerminalHistory);
  const [commandHistory, setCommandHistory] = useState<string[]>(savedHistory);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isExecuting, setIsExecuting] = useState(false);
  const [customCommands, setCustomCommands] = useState<CustomCommand[]>(loadCustomCommands);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [copyToast, setCopyToast] = useState(false);
  const copyToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newName, setNewName] = useState("");
  const [newCmd, setNewCmd] = useState("");
  const [availableCommands, setAvailableCommands] = useState<AvailableCommand[]>([]);
  const [showCommands, setShowCommands] = useState(false);
  const [loadingCommands, setLoadingCommands] = useState(false);
  const [commandSearch, setCommandSearch] = useState("");

  const handleOutputMouseUp = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (text && text.length > 0) {
      navigator.clipboard.writeText(text).then(() => {
        setCopyToast(true);
        if (copyToastTimer.current) clearTimeout(copyToastTimer.current);
        copyToastTimer.current = setTimeout(() => setCopyToast(false), 2000);
      });
    }
  }, []);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const currentPlatform = devices.find((d) => d.serial === currentDevice)?.platform || "android";

  // 预设命令（按平台区分）
  const presetCommands: Array<{ name: string; command: string }> = currentPlatform === "harmonyos" ? [
    { name: "top", command: "top -n 1" },
  ] : [
    { name: "top", command: "top -n 1" },
  ];

  // 常用命令示例
  const commandExamples: Record<string, string> = {
    "ls": "ls /data/local/tmp/",
    "cat": "cat /proc/version",
    "ps": "ps | grep com",
    "top": "top -n 1",
    "netstat": "netstat -tuln",
    "ifconfig": "ifconfig",
    "df": "df -h",
    "free": "free -m",
    "date": "date",
    "uname": "uname -a",
  };

  // 获取可用命令
  const fetchAvailableCommands = async () => {
    if (!currentDevice) return;
    
    // 如果已经显示命令列表，则关闭
    if (showCommands) {
      setShowCommands(false);
      return;
    }
    
    // 如果已有命令数据，直接显示
    if (availableCommands.length > 0) {
      setShowCommands(true);
      setCommandSearch(""); // 重置搜索框
      return;
    }
    
    setLoadingCommands(true);
    try {
      const platform = devices.find((d) => d.serial === currentDevice)?.platform || "android";
      const shellFn = platform === "harmonyos" ? hdcShell : executeShell;
      
      // 使用ls /system/bin获取可用命令
      const output = await shellFn(currentDevice, "ls /system/bin");
      
      // 解析命令
      const commands: AvailableCommand[] = [];
      const lines = output.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        commands.push({
          name: trimmed,
          path: `/system/bin/${trimmed}`,
          example: commandExamples[trimmed],
        });
      }
      
      setAvailableCommands(commands);
      setShowCommands(true);
      setCommandSearch(""); // 重置搜索框
    } catch (err) {
      console.error("Failed to fetch commands:", err);
    } finally {
      setLoadingCommands(false);
    }
  };

  // 填充命令到输入框
  const fillCommand = (cmd: AvailableCommand) => {
    setInput(cmd.example || cmd.name);
    inputRef.current?.focus();
    // 填充命令后关闭命令列表
    setShowCommands(false);
  };

  const addCustomCommand = () => {
    if (!newName.trim() || !newCmd.trim()) return;
    const cmd: CustomCommand = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: newName.trim(),
      command: newCmd.trim(),
    };
    const updated = [...customCommands, cmd];
    setCustomCommands(updated);
    saveCustomCommands(updated);
    setNewName("");
    setNewCmd("");
    setShowAddDialog(false);
  };

  const removeCustomCommand = (id: string) => {
    const updated = customCommands.filter((c) => c.id !== id);
    setCustomCommands(updated);
    saveCustomCommands(updated);
  };

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

  // 保存终端状态到localStorage
  useEffect(() => {
    saveTerminalState({ input, commandHistory, history });
  }, [input, commandHistory, history]);

  // 页面加载时获取可用命令
  useEffect(() => {
    if (currentDevice) {
      fetchAvailableCommandsSilent();
    }
  }, [currentDevice]);

  // 静默获取可用命令（不显示loading和弹窗）
  const fetchAvailableCommandsSilent = async () => {
    if (!currentDevice) return;
    
    try {
      const platform = devices.find((d) => d.serial === currentDevice)?.platform || "android";
      const shellFn = platform === "harmonyos" ? hdcShell : executeShell;
      
      // 使用ls /system/bin获取可用命令
      const output = await shellFn(currentDevice, "ls /system/bin");
      
      // 解析命令
      const commands: AvailableCommand[] = [];
      const lines = output.split('\n');
      
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        commands.push({
          name: trimmed,
          path: `/system/bin/${trimmed}`,
          example: commandExamples[trimmed],
        });
      }
      
      setAvailableCommands(commands);
    } catch (err) {
      console.error("Failed to fetch commands:", err);
    }
  };

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
        <div className="flex gap-2 mb-3 flex-shrink-0 flex-wrap items-center">
          {presetCommands.map((cmd) => (
            <button
              key={cmd.command}
              onClick={() => executeCommand(cmd.command)}
              disabled={!currentDevice || isExecuting}
              className="px-2.5 py-1 rounded bg-dark-800 border border-dark-700/50 text-xs text-dark-400 hover:text-dark-200 hover:border-dark-600 disabled:opacity-50 transition-colors"
            >
              {cmd.name}
            </button>
          ))}
          {customCommands.map((cmd) => (
            <div key={cmd.id} className="relative group/cmd">
              <button
                onClick={() => executeCommand(cmd.command)}
                disabled={!currentDevice || isExecuting}
                className="px-2.5 py-1 rounded bg-dark-800 border border-accent-500/30 text-xs text-accent-400 hover:bg-accent-500/10 hover:border-accent-500/50 disabled:opacity-50 transition-colors"
              >
                {cmd.name}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); removeCustomCommand(cmd.id); }}
                className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-red-500/80 text-white text-[9px] flex items-center justify-center opacity-0 group-hover/cmd:opacity-100 transition-opacity leading-none"
                title={t("terminal.removeCommand")}
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() => setShowAddDialog(true)}
            className="px-2.5 py-1 rounded bg-dark-800 border border-dark-700/50 text-xs text-dark-500 hover:text-accent-400 hover:border-accent-500/30 transition-colors"
            title={t("terminal.addCommand")}
          >
            +
          </button>
        </div>

        {/* 添加命令弹窗 */}
        {showAddDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-dark-800 border border-dark-700 rounded-xl p-5 w-80 shadow-xl">
              <h3 className="text-sm font-medium text-dark-200 mb-4">{t("terminal.addCommand")}</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-dark-400 mb-1 block">{t("terminal.commandName")}</label>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent-500"
                    placeholder={t("terminal.commandNamePlaceholder")}
                    autoFocus
                    onKeyDown={(e) => { if (e.key === "Enter") { const t2 = document.getElementById("new-cmd-input"); t2?.focus(); } }}
                  />
                </div>
                <div>
                  <label className="text-xs text-dark-400 mb-1 block">{t("terminal.commandContent")}</label>
                  <input
                    id="new-cmd-input"
                    type="text"
                    value={newCmd}
                    onChange={(e) => setNewCmd(e.target.value)}
                    className="w-full px-3 py-2 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent-500 font-mono"
                    placeholder="ls -la"
                    onKeyDown={(e) => { if (e.key === "Enter") addCustomCommand(); }}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => { setShowAddDialog(false); setNewName(""); setNewCmd(""); }}
                  className="px-3 py-1.5 rounded-lg text-xs text-dark-400 hover:text-dark-200 hover:bg-dark-700 transition-colors"
                >
                  {t("common.cancel")}
                </button>
                <button
                  onClick={addCustomCommand}
                  disabled={!newName.trim() || !newCmd.trim()}
                  className="px-3 py-1.5 rounded-lg text-xs bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 transition-colors"
                >
                  {t("common.confirm")}
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Terminal Output */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto bg-dark-900 border border-dark-700/30 rounded-xl p-4 font-mono text-sm relative"
        onClick={() => inputRef.current?.focus()}
      >
        {history.length === 0 && (
          <p className="text-dark-500">{t("terminal.noOutput")}</p>
        )}
        {history.map((entry, i) => (
          <div key={i} className="mb-3">
            <div className="flex items-center gap-2 select-text" onMouseUp={handleOutputMouseUp}>
              <span className="text-accent-400">$</span>
              <span className="text-dark-200">{entry.command}</span>
            </div>
            {entry.output && (
              <pre
                className={`mt-1 whitespace-pre-wrap break-all text-xs select-text ${
                  entry.isError ? "text-red-400" : "text-dark-400"
                }`}
                onMouseUp={handleOutputMouseUp}
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

      {/* 复制成功提示 */}
      {copyToast && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 bg-dark-700/90 border border-dark-600/50 rounded-lg text-xs text-dark-200 shadow-lg backdrop-blur-sm animate-fade-in">
          ✓ {t("terminal.copied")}
        </div>
      )}

      {/* 词云式命令提示 */}
      {input.trim().length > 0 && availableCommands.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {availableCommands
            .map(cmd => {
              const inputLower = input.toLowerCase();
              const nameLower = cmd.name.toLowerCase();
              
              // 计算匹配优先级
              let priority = 0;
              if (nameLower === inputLower) {
                priority = 3; // 完全匹配
              } else if (nameLower.startsWith(inputLower)) {
                priority = 2; // 前缀匹配
              } else if (nameLower.includes(inputLower)) {
                priority = 1; // 包含匹配
              }
              
              return { ...cmd, priority };
            })
            .filter(cmd => cmd.priority > 0)
            .sort((a, b) => b.priority - a.priority) // 按优先级排序
            .slice(0, 10)
            .map((cmd, index) => (
              <button
                key={index}
                onClick={() => fillCommand(cmd)}
                className={`px-2 py-1 rounded text-xs transition-colors text-left truncate ${
                  cmd.priority === 3
                    ? 'bg-accent-500/30 text-accent-300 hover:bg-accent-500/40'
                    : cmd.priority === 2
                    ? 'bg-dark-700/70 text-dark-200 hover:bg-accent-500/20 hover:text-accent-400'
                    : 'bg-dark-700/50 text-dark-300 hover:bg-accent-500/20 hover:text-accent-400'
                }`}
                title={`Path: ${cmd.path}${cmd.example ? `\nExample: ${cmd.example}` : ''}`}
              >
                {cmd.name}
              </button>
            ))}
        </div>
      )}

      {/* Input */}
      <div className="mt-3 flex items-center gap-2 flex-shrink-0">
        {/* 可用命令查询按钮 */}
        <button
          onClick={fetchAvailableCommands}
          disabled={!currentDevice || isExecuting}
          className="p-1.5 rounded-md text-dark-400 hover:text-dark-200 hover:bg-dark-700/50 disabled:opacity-50 transition-colors"
          title="Get available commands"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
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

      {/* 可用命令列表 */}
      {showCommands && (
        <div className="mt-3 bg-dark-800/50 border border-dark-700/50 rounded-xl p-3 max-h-60 overflow-y-auto">
          <div className="flex justify-end mb-3">
            <button
              onClick={() => setShowCommands(false)}
              className="text-xs text-dark-400 hover:text-dark-200"
            >
              ×
            </button>
          </div>
          
          {/* 搜索框 */}
          <div className="mb-3">
            <input
              type="text"
              value={commandSearch}
              onChange={(e) => setCommandSearch(e.target.value)}
              placeholder="Search commands..."
              className="w-full px-3 py-1.5 bg-dark-700 border border-dark-600 rounded-lg text-sm text-dark-100 placeholder-dark-500 focus:outline-none focus:border-accent-500"
            />
          </div>
          
          {loadingCommands ? (
            <div className="flex items-center justify-center py-4">
              <div className="w-2 h-2 bg-accent-500 rounded-full animate-pulse mr-2"></div>
              <span className="text-sm text-dark-400">Loading...</span>
            </div>
          ) : availableCommands.length === 0 ? (
            <p className="text-sm text-dark-400 text-center py-4">No commands found</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {availableCommands
                .filter(cmd => cmd.name.toLowerCase().includes(commandSearch.toLowerCase()))
                .map((cmd, index) => (
                <button
                  key={index}
                  onClick={() => fillCommand(cmd)}
                  className="px-2 py-1.5 rounded bg-dark-700/50 text-xs text-dark-300 hover:bg-accent-500/20 hover:text-accent-400 transition-colors text-left truncate"
                  title={`Path: ${cmd.path}${cmd.example ? `\nExample: ${cmd.example}` : ''}`}
                >
                  {cmd.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default TerminalPage;
