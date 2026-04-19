import { create } from "zustand";
import type {
  ActionBlock, AutomationCanvas, ExecutionState,
  BackendAction, ActionResult, ActionParams, RunConfig,
} from "../types/automation";
import { executeAction, stopAutomation, resetAutomation } from "../api/automation";

// ==================== ID 生成 ====================
let idCounter = 0;
const genId = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

// ==================== 默认块工厂 ====================

export function createDefaultBlock(type: keyof ActionParams): Omit<ActionBlock, "id"> {
  const base = { type, params: {} as ActionParams, disabled: false };
  switch (type) {
    case "tap":
      return { ...base, params: { tap: { x: 0, y: 0 } } };
    case "double_tap":
      return { ...base, params: { double_tap: { x: 0, y: 0 } } };
    case "long_press":
      return { ...base, params: { long_press: { x: 0, y: 0, duration: 1000 } } };
    case "swipe":
      return { ...base, params: { swipe: { from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, duration: 300 } } };
    case "drag":
      return { ...base, params: { drag: { from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, duration: 1000 } } };
    case "keyevent":
      return { ...base, params: { keyevent: { code: 66, action: "press", inputMode: "preset" } } };
    case "media_key":
      return { ...base, params: { media_key: { code: 85, action: "press" } } };
    case "device_action":
      return { ...base, params: { device_action: { action: "volume_up" } } };
    case "gamepad":
      return { ...base, params: { gamepad: { code: 96, action: "press" } } };
    case "text":
      return { ...base, params: { text: { content: "" } } };
    case "open_url":
      return { ...base, params: { open_url: { url: "https://" } } };
    case "shell":
      return { ...base, params: { shell: { command: "top -n 1" } } };
    case "open_app":
      return { ...base, params: { open_app: { package: "" } } };
    case "delay":
      return { ...base, params: { delay: { ms: 1000 } } };
    case "condition":
      return { ...base, params: { condition: { target: { x: 0, y: 0 }, expected: { r: 255, g: 0, b: 0, a: 255 }, tolerance: 30, timeout: 5000, interval: 500 } } };
    default:
      return base;
  }
}

// ==================== Store 接口 ====================

interface AutomationStore {
  // 画布管理
  canvases: AutomationCanvas[];
  activeCanvasId: string | null;
  activeCanvas: () => AutomationCanvas | null;
  createCanvas: (name: string) => string;
  deleteCanvas: (canvasId: string) => void;
  switchCanvas: (canvasId: string) => void;
  renameCanvas: (canvasId: string, name: string) => void;

  // 块操作
  addBlock: (type: keyof ActionParams) => string;
  insertBlock: (index: number, type: keyof ActionParams) => string;
  updateBlock: (blockId: string, updates: Partial<ActionBlock>) => void;
  removeBlock: (blockId: string) => void;
  moveBlock: (fromIndex: number, toIndex: number) => void;
  duplicateBlock: (blockId: string) => string;

  // 选中的块（用于属性面板）
  selectedBlockId: string | null;
  selectBlock: (blockId: string | null) => void;

  // 执行引擎
  execution: ExecutionState;
  lastShellResult: string | null;
  /** 运行日志（每次执行一个块记录一条） */
  runLogs: Array<{ type: string; label: string; status: "ok" | "error"; message?: string; time: string }>;
  runAll: (platform: string, serial: string) => Promise<void>;
  runFrom: (startIndex: number, platform: string, serial: string) => Promise<void>;
  stop: () => void;

  // 持久化
  save: () => void;
  load: () => void;

  // 导入导出
  exportCanvas: (canvasId: string) => string | null;
  importCanvas: (jsonStr: string) => boolean;

  // 运行配置
  updateRunConfig: (updates: Partial<RunConfig>) => void;

  // 画布面板展开/收缩
  canvasExpanded: boolean;
  toggleCanvas: () => void;
}

// ==================== 内部执行函数 ====================

let stopFlag = false;

async function executeBlocks(
  blocks: ActionBlock[],
  startIndex: number,
  platform: string,
  serial: string,
  set: (partial: Partial<AutomationStore> | ((s: AutomationStore) => Partial<AutomationStore>)) => void,
  get: () => AutomationStore,
  continueOnError: boolean = false,
): Promise<void> {
  for (let i = startIndex; i < blocks.length; i++) {
    if (stopFlag) return;

    const block = blocks[i];
    if (block.disabled) continue;

    set((s) => ({
      execution: { ...s.execution, currentIndex: i },
    }));

    try {
      const backendAction: BackendAction = {
        type: block.type,
        params: block.params,
      };

      const result: ActionResult = await executeAction(serial, platform, backendAction);

      // 保存 shell 命令结果
      if (block.type === "shell" && result.message) {
        set({ lastShellResult: result.message });
      }

      // 记录运行日志
      const now = new Date().toLocaleTimeString();
      set((s) => ({
        runLogs: [...s.runLogs, {
          type: block.type,
          label: block.label || block.type,
          status: "ok",
          message: result.message || undefined,
          time: now,
        }],
      }));

      // 处理条件判断的子块
      if (block.type === "condition") {
        const condParams = (block.params as { condition: any }).condition;
        if (result.matched && condParams.on_match?.length) {
          await executeBlocks(condParams.on_match, 0, platform, serial, set, get);
        } else if (!result.matched && condParams.on_fail?.length) {
          await executeBlocks(condParams.on_fail, 0, platform, serial, set, get);
        }
      }

      if (stopFlag) return;

      set((s) => ({
        execution: { ...s.execution, executedCount: i + 1 },
      }));
    } catch (err) {
      if (stopFlag) return;
      if (continueOnError) {
        // 出错继续执行下一个块
        const errMsg = err instanceof Error ? err.message : String(err);
        const now = new Date().toLocaleTimeString();
        set((s) => ({
          execution: { ...s.execution, executedCount: i + 1 },
          runLogs: [...s.runLogs, { type: block.type, label: block.label || block.type, status: "error", message: errMsg, time: now }],
        }));
        continue;
      }
      set((s) => ({
        execution: {
          ...s.execution,
          status: "error",
          currentIndex: null,
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      }));
      return;
    }
  }

  if (!stopFlag) {
    set((s) => ({
      execution: { ...s.execution, status: "completed", currentIndex: null },
    }));
  }
}

// ==================== Store 实现 ====================

const STORAGE_KEY = "automation_canvases";

export const useAutomationStore = create<AutomationStore>((set, get) => ({
  canvases: [],
  activeCanvasId: null,
  selectedBlockId: null,
  canvasExpanded: false,
  lastShellResult: null,
  runLogs: [],

  activeCanvas: () => {
    const { canvases, activeCanvasId } = get();
    return canvases.find((c) => c.id === activeCanvasId) ?? null;
  },

  // ==================== 画布管理 ====================

  createCanvas: (name: string) => {
    const id = genId("canvas");
    const canvas: AutomationCanvas = {
      id,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      blocks: [],
      runConfig: {
        loop: false,
        loopCount: 0,
        loopInterval: 1000,
        continueOnError: false,
        startDelay: 0,
      },
    };
    set((s) => ({
      canvases: [...s.canvases, canvas],
      activeCanvasId: id,
      selectedBlockId: null,
      execution: { status: "idle", currentIndex: null, errorMessage: null, executedCount: 0, totalCount: 0 },
      lastShellResult: null,
    }));
    get().save();
    return id;
  },

  deleteCanvas: (canvasId: string) => {
    set((s) => {
      const newCanvases = s.canvases.filter((c) => c.id !== canvasId);
      const newActiveId = s.activeCanvasId === canvasId
        ? (newCanvases[0]?.id ?? null)
        : s.activeCanvasId;
      return { canvases: newCanvases, activeCanvasId: newActiveId, selectedBlockId: null };
    });
    get().save();
  },

  switchCanvas: (canvasId: string) => {
    set({ activeCanvasId: canvasId, selectedBlockId: null });
  },

  renameCanvas: (canvasId: string, name: string) => {
    set((s) => ({
      canvases: s.canvases.map((c) =>
        c.id === canvasId ? { ...c, name, updatedAt: Date.now() } : c
      ),
    }));
    get().save();
  },

  // ==================== 块操作 ====================

  addBlock: (type) => {
    const canvas = get().activeCanvas();
    if (!canvas) return "";
    const block: ActionBlock = {
      id: genId("blk"),
      ...createDefaultBlock(type),
    };
    set((s) => ({
      canvases: s.canvases.map((c) =>
        c.id === canvas.id
          ? { ...c, blocks: [...c.blocks, block], updatedAt: Date.now() }
          : c
      ),
      selectedBlockId: block.id,
    }));
    get().save();
    return block.id;
  },

  insertBlock: (index, type) => {
    const canvas = get().activeCanvas();
    if (!canvas) return "";
    const block: ActionBlock = {
      id: genId("blk"),
      ...createDefaultBlock(type),
    };
    set((s) => ({
      canvases: s.canvases.map((c) => {
        if (c.id !== canvas.id) return c;
        const blocks = [...c.blocks];
        blocks.splice(index, 0, block);
        return { ...c, blocks, updatedAt: Date.now() };
      }),
      selectedBlockId: block.id,
    }));
    get().save();
    return block.id;
  },

  updateBlock: (blockId, updates) => {
    set((s) => ({
      canvases: s.canvases.map((c) => {
        if (c.id !== get().activeCanvasId) return c;
        return {
          ...c,
          blocks: c.blocks.map((b) =>
            b.id === blockId ? { ...b, ...updates } : b
          ),
          updatedAt: Date.now(),
        };
      }),
    }));
    get().save();
  },

  removeBlock: (blockId) => {
    set((s) => ({
      canvases: s.canvases.map((c) => {
        if (c.id !== get().activeCanvasId) return c;
        return {
          ...c,
          blocks: c.blocks.filter((b) => b.id !== blockId),
          updatedAt: Date.now(),
        };
      }),
      selectedBlockId: s.selectedBlockId === blockId ? null : s.selectedBlockId,
    }));
    get().save();
  },

  moveBlock: (fromIndex, toIndex) => {
    set((s) => ({
      canvases: s.canvases.map((c) => {
        if (c.id !== get().activeCanvasId) return c;
        const blocks = [...c.blocks];
        const [moved] = blocks.splice(fromIndex, 1);
        blocks.splice(toIndex, 0, moved);
        return { ...c, blocks, updatedAt: Date.now() };
      }),
    }));
    get().save();
  },

  duplicateBlock: (blockId) => {
    const canvas = get().activeCanvas();
    if (!canvas) return "";
    const src = canvas.blocks.find((b) => b.id === blockId);
    if (!src) return "";
    const newBlock: ActionBlock = {
      ...JSON.parse(JSON.stringify(src)),
      id: genId("blk"),
    };
    set((s) => ({
      canvases: s.canvases.map((c) => {
        if (c.id !== canvas.id) return c;
        const idx = c.blocks.findIndex((b) => b.id === blockId);
        const blocks = [...c.blocks];
        blocks.splice(idx + 1, 0, newBlock);
        return { ...c, blocks, updatedAt: Date.now() };
      }),
      selectedBlockId: newBlock.id,
    }));
    get().save();
    return newBlock.id;
  },

  selectBlock: (blockId) => {
    set({ selectedBlockId: blockId });
  },

  // ==================== 执行引擎 ====================

  execution: {
    status: "idle",
    currentIndex: null,
    errorMessage: null,
    executedCount: 0,
    totalCount: 0,
  },

  runAll: async (platform, serial) => {
    const canvas = get().activeCanvas();
    if (!canvas || canvas.blocks.length === 0) return;

    const enabledBlocks = canvas.blocks.filter((b) => !b.disabled);
    if (enabledBlocks.length === 0) return;

    stopFlag = false;
    try { await resetAutomation(); } catch {}
    set({ runLogs: [] });

    const config = canvas.runConfig;

    // 执行前延迟
    if (config.startDelay > 0) {
      await new Promise((r) => setTimeout(r, config.startDelay));
      if (stopFlag) return;
    }

    const maxLoops = config.loop ? (config.loopCount > 0 ? config.loopCount : Infinity) : 1;

    for (let loop = 0; loop < maxLoops; loop++) {
      if (stopFlag) break;

      set({
        execution: {
          status: "running",
          currentIndex: 0,
          errorMessage: null,
          executedCount: 0,
          totalCount: enabledBlocks.length * (config.loop ? (config.loopCount > 0 ? config.loopCount : 0) : 1),
          currentLoop: loop + 1,
          totalLoops: config.loop ? (config.loopCount > 0 ? config.loopCount : 0) : 1,
        },
      });

      await executeBlocks(enabledBlocks, 0, platform, serial, set, get, config.continueOnError);

      if (stopFlag) break;

      // 循环间隔
      if (config.loop && loop < maxLoops - 1 && config.loopInterval > 0) {
        await new Promise((r) => setTimeout(r, config.loopInterval));
      }
    }
  },

  runFrom: async (startIndex, platform, serial) => {
    const canvas = get().activeCanvas();
    if (!canvas) return;

    const enabledBlocks = canvas.blocks.filter((b) => !b.disabled);
    if (startIndex >= enabledBlocks.length) return;

    stopFlag = false;
    try { await resetAutomation(); } catch {}

    set({
      execution: {
        status: "running",
        currentIndex: startIndex,
        errorMessage: null,
        executedCount: startIndex,
        totalCount: enabledBlocks.length,
      },
    });

    await executeBlocks(enabledBlocks, startIndex, platform, serial, set, get);
  },

  stop: async () => {
    stopFlag = true;
    try { await stopAutomation(); } catch {}
    set((s) => ({
      execution: { ...s.execution, status: "stopped", currentIndex: null },
    }));
  },

  // ==================== 持久化 ====================

  save: () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(get().canvases));
    } catch (e) {
      console.error("保存画布数据失败:", e);
    }
  },

  load: () => {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const canvases: AutomationCanvas[] = JSON.parse(data);
        // 兼容旧数据：补默认 runConfig
        const defaultRunConfig = { loop: false, loopCount: 0, loopInterval: 1000, continueOnError: false, startDelay: 0 };
        const migrated = canvases.map((c) => c.runConfig ? c : { ...c, runConfig: { ...defaultRunConfig } });
        set({
          canvases: migrated,
          activeCanvasId: migrated[0]?.id ?? null,
        });
      }
    } catch (e) {
      console.error("加载画布数据失败:", e);
    }
  },

  toggleCanvas: () => {
    set((s) => ({ canvasExpanded: !s.canvasExpanded }));
  },

  exportCanvas: (canvasId: string) => {
    const canvas = get().canvases.find((c) => c.id === canvasId);
    if (!canvas) return null;
    return JSON.stringify(canvas, null, 2);
  },

  importCanvas: (jsonStr: string) => {
    try {
      const canvas: AutomationCanvas = JSON.parse(jsonStr);
      if (!canvas.id || !canvas.name || !Array.isArray(canvas.blocks)) return false;
      // 检查是否重名，重命名避免冲突
      const existing = get().canvases.find((c) => c.name === canvas.name);
      if (existing) {
        canvas.name = `${canvas.name} (导入)`;
      }
      // 生成新 id 避免冲突
      canvas.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      set((s) => ({
        canvases: [...s.canvases, canvas],
        activeCanvasId: canvas.id,
      }));
      get().save();
      return true;
    } catch {
      return false;
    }
  },

  updateRunConfig: (updates) => {
    const canvas = get().activeCanvas();
    if (!canvas) return;
    set((s) => ({
      canvases: s.canvases.map((c) =>
        c.id === canvas.id
          ? { ...c, updatedAt: Date.now(), runConfig: { ...c.runConfig, ...updates } }
          : c
      ),
    }));
    get().save();
  },
}));
