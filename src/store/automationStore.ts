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
      return { ...base, params: { tap: { x: "", y: "" } } };
    case "double_tap":
      return { ...base, params: { double_tap: { x: "", y: "" } } };
    case "long_press":
      return { ...base, params: { long_press: { x: "", y: "", duration: 1000 } } };
    case "swipe":
      return { ...base, params: { swipe: { from: { x: "", y: "" }, to: { x: "", y: "" }, duration: 300 } } };
    case "drag":
      return { ...base, params: { drag: { from: { x: "", y: "" }, to: { x: "", y: "" }, duration: 1000 } } };
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
      return { ...base, params: { condition: { target: { x: "", y: "" }, expected: { r: 255, g: 0, b: 0, a: 255 }, tolerance: 30, timeout: 5000, interval: 500 } } };
    case "code":
      return { ...base, params: { code: { content: "// 在这里编写 TypeScript 代码\n// 可以使用全局变量，例如：\n// console.log(globalVar);\n", variables: [] } } };
    default:
      return base;
  }
}

// ==================== 队列项接口 ====================
interface QueueItem {
  id: string;
  canvasId: string;
  canvasName: string;
  status: "pending" | "running" | "completed" | "error" | "stopped";
}

// ==================== Store 接口 ====================

// 块执行结果接口
interface BlockResult {
  params: any;
  result: ActionResult;
  timestamp: number;
}

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
  /** 块执行结果存储 */
  blockResults: Record<string, BlockResult>;
  /** 运行日志（每次执行一个块记录一条） */
  runLogs: Array<{ type: string; label: string; status: "ok" | "error"; message?: string | string[]; time: string }>;
  runAll: (platform: string, serial: string) => Promise<void>;
  runFrom: (startIndex: number, platform: string, serial: string) => Promise<void>;
  stop: () => void;

  // 运行队列
  queue: QueueItem[];
  addToQueue: (canvasId: string) => void;
  removeFromQueue: (itemId: string) => void;
  clearQueue: () => void;
  runQueue: (platform: string, serial: string) => Promise<void>;
  stopQueue: () => void;

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
let queueStopFlag = false;

async function runSingleCanvas(
  canvas: AutomationCanvas,
  platform: string,
  serial: string,
  set: (partial: Partial<AutomationStore> | ((s: AutomationStore) => Partial<AutomationStore>)) => void,
  get: () => AutomationStore,
): Promise<"completed" | "error" | "stopped"> {
  const enabledBlocks = canvas.blocks.filter((b) => !b.disabled);
  if (enabledBlocks.length === 0) return "completed";

  stopFlag = false;
  try { await resetAutomation(); } catch {}
  set({ runLogs: [] });
  // 执行开始时自动展开运行结果面板
  set({ canvasExpanded: true });

  const config = canvas.runConfig;

  // 执行前延迟
  if (config.startDelay > 0) {
    await new Promise((r) => setTimeout(r, config.startDelay));
    if (stopFlag || queueStopFlag) return "stopped";
  }

  const maxLoops = config.loop ? (config.loopCount > 0 ? config.loopCount : Infinity) : 1;

  for (let loop = 0; loop < maxLoops; loop++) {
    if (stopFlag || queueStopFlag) break;

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

    if (stopFlag || queueStopFlag) break;

    // 循环间隔
    if (config.loop && loop < maxLoops - 1 && config.loopInterval > 0) {
      await new Promise((r) => setTimeout(r, config.loopInterval));
    }
  }

  if (queueStopFlag) return "stopped";
  if (stopFlag) return "stopped";
  
  const state = get().execution;
  if (state.status === "error") return "error";
  return "completed";
}

// 辅助函数：生成随机坐标
function generateRandomCoord(point: any): any {
  if (!point) return point;
  
  // 确保基础坐标值为数字
  const baseX = typeof point.x === 'string' ? (point.x === '' ? 0 : Number(point.x)) : point.x;
  const baseY = typeof point.y === 'string' ? (point.y === '' ? 0 : Number(point.y)) : point.y;
  
  switch (point.type) {
    case 'random_rect':
      // 矩形随机：在 (baseX, baseY) 为左上角，width x height 的矩形内随机
      const width = typeof point.rectParams?.width === 'string' ? (point.rectParams.width === '' ? 100 : Number(point.rectParams.width)) : (point.rectParams?.width || 100);
      const height = typeof point.rectParams?.height === 'string' ? (point.rectParams.height === '' ? 100 : Number(point.rectParams.height)) : (point.rectParams?.height || 100);
      const randomX = Math.floor(baseX + Math.random() * width);
      const randomY = Math.floor(baseY + Math.random() * height);
      // 确保坐标非负
      const safeRandomX = Math.max(0, randomX);
      const safeRandomY = Math.max(0, randomY);
      console.log('生成矩形随机坐标:', { baseX, baseY, width, height, randomX, randomY, safeRandomX, safeRandomY });
      return {
        x: safeRandomX,
        y: safeRandomY,
      };
    case 'random_circle':
      // 圆形随机：在以 (baseX, baseY) 为圆心，radius 为半径的圆内随机
      const radius = typeof point.circleParams?.radius === 'string' ? (point.circleParams.radius === '' ? 50 : Number(point.circleParams.radius)) : (point.circleParams?.radius || 50);
      const angle = Math.random() * Math.PI * 2;
      const r = radius * Math.sqrt(Math.random());
      const circleX = Math.floor(baseX + r * Math.cos(angle));
      const circleY = Math.floor(baseY + r * Math.sin(angle));
      // 确保坐标非负
      const safeCircleX = Math.max(0, circleX);
      const safeCircleY = Math.max(0, circleY);
      console.log('生成圆形随机坐标:', { baseX, baseY, radius, angle, r, circleX, circleY, safeCircleX, safeCircleY });
      return {
        x: safeCircleX,
        y: safeCircleY,
      };
    case 'custom':
      // 自定义随机：执行用户提供的代码
      try {
        const func = new Function(point.customCode || 'return { x: 0, y: 0 };');
        const customResult = func();
        const customX = Number(customResult.x) || 0;
        const customY = Number(customResult.y) || 0;
        // 确保坐标非负
        const safeCustomX = Math.max(0, customX);
        const safeCustomY = Math.max(0, customY);
        console.log('生成自定义随机坐标:', { customX, customY, safeCustomX, safeCustomY });
        return {
          x: safeCustomX,
          y: safeCustomY,
        };
      } catch (e) {
        console.error('自定义随机代码执行失败:', e);
        return { x: baseX, y: baseY };
      }
    case 'fixed':
    default:
      // 固定坐标
      return {
        x: baseX,
        y: baseY,
      };
  }
}

// 辅助函数：确保坐标值为有效数字
function ensureValidNumbers(params: any): any {
  const result = JSON.parse(JSON.stringify(params));
  
  // 处理坐标点
  function processPoint(point: any): any {
    return generateRandomCoord(point);
  }
  
  // 递归处理 params
  for (const key in result) {
    const value = result[key];
    if (typeof value === 'object' && value !== null) {
      if ('x' in value && 'y' in value) {
        // 这是一个点对象
        result[key] = processPoint(value);
      } else if ('from' in value && 'to' in value) {
        // 这是一个滑动/拖拽对象
        result[key].from = processPoint(value.from);
        result[key].to = processPoint(value.to);
      } else if ('target' in value) {
        // 这是一个条件判断对象
        result[key].target = processPoint(value.target);
      }
    }
  }
  
  return result;
}

async function executeBlocks(
  blocks: ActionBlock[],
  startIndex: number,
  platform: string,
  serial: string,
  set: (partial: Partial<AutomationStore> | ((s: AutomationStore) => Partial<AutomationStore>)) => void,
  get: () => AutomationStore,
  continueOnError: boolean = false,
): Promise<void> {
  // 保存所有块的执行结果，用于变量替换
  const blockResults: Map<string, any> = new Map();

  for (let i = startIndex; i < blocks.length; i++) {
    if (stopFlag) return;

    const block = blocks[i];
    if (block.disabled) continue;

    set((s) => ({
      execution: { ...s.execution, currentIndex: i },
    }));

    try {
        let result: ActionResult;

        // 所有块类型都生成处理后的参数，用于日志显示
        const processedParams = ensureValidNumbers(block.params);

        // 代码块在前端执行
        if (block.type === "code") {
        const codeParams = block.params as { code: { content: string; variables?: any[] } };
        
        // 构建变量值映射
        const variableValues: Record<string, any> = {};
        if (codeParams.code.variables) {
          for (const variable of codeParams.code.variables) {
            const sourceType = variable.source.sourceType || "params";
            if (sourceType === "result") {
              // 从 blockResults 中获取块的执行结果
              const blockResult = get().blockResults[variable.source.blockId];
              if (blockResult) {
                let value: any;
                const pathParts = variable.source.property.split('.');
                
                if (pathParts.length === 1 && pathParts[0] === "result") {
                  // 直接获取整个 result 对象
                  value = blockResult.result;
                } else {
                  // 获取特定属性
                  let current: any = blockResult;
                  for (const part of pathParts) {
                    if (current && typeof current === 'object' && current !== null && part in current) {
                      current = current[part];
                    } else {
                      current = undefined;
                      break;
                    }
                  }
                  value = current;
                }
                variableValues[variable.name] = value;
              }
            } else {
              // 从 sourceBlock.params 中获取值（原有逻辑）
              const sourceBlock = blocks.find(b => b.id === variable.source.blockId);
              if (sourceBlock) {
                let value = sourceBlock.params;
                const pathParts = variable.source.property.split('.');
                let current: any = value;
                for (const part of pathParts) {
                  if (current && typeof current === 'object' && current !== null && part in current) {
                    current = current[part];
                  } else {
                    current = undefined;
                    break;
                  }
                }
                variableValues[variable.name] = current;
              }
            }
          }
        }

        // 清理用户代码中的旧变量声明（来自之前插入留下的）
        let cleanCode = codeParams.code.content;
        if (codeParams.code.variables) {
          for (const variable of codeParams.code.variables) {
            // 移除类似：const variableName = "..."; 的声明
            const regex = new RegExp(`const\\s+${variable.name}\\s*=\\s*".*?";?\\s*`, 'g');
            cleanCode = cleanCode.replace(regex, '');
            // 移除类似：// 全局变量 的注释
            cleanCode = cleanCode.replace(/\/\/\s*全局变量\s*\n?/g, '');
          }
        }
        // 清理多余的空行
        cleanCode = cleanCode.replace(/\n\s*\n\s*\n/g, '\n\n').trim();

        // 执行代码
        let originalLog = console.log;
        try {
          // 捕获 console.log 输出
          const logs: string[] = [];
          console.log = (...args: any[]) => {
            logs.push(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)).join(' '));
            originalLog(...args);
          };
          
          // 构建可访问之前块结果的上下文
            const context: Record<string, any> = {
              // 注入之前块的结果（优先使用当前执行的结果，其次使用持久化的结果）
              getBlockResult: (blockId: string) => {
                const currentResult = blockResults.get(blockId);
                if (currentResult) {
                  return currentResult;
                }
                return get().blockResults[blockId];
              },
              // 获取所有块的结果
              getAllBlockResults: () => {
                return get().blockResults;
              },
              // 注入 shell 命令的结果
              shellResult: get().lastShellResult,
              // 注入当前执行状态
              execution: get().execution,
              // 注入其他常用工具
              console: {
                log: (...args: any[]) => console.log(...args),
                error: (...args: any[]) => console.error(...args),
                warn: (...args: any[]) => console.warn(...args),
                info: (...args: any[]) => console.info(...args)
              },
              // 宏函数
              GOTO: (blockIndex: number) => {
                console.log(`[GOTO] 跳转到块索引 ${blockIndex}`);
                // 抛出特殊错误，由执行引擎捕获并处理跳转
                const gotoError = new Error(`GOTO:${blockIndex}`);
                (gotoError as any).isGoto = true;
                (gotoError as any).targetIndex = blockIndex;
                throw gotoError;
              },
              DELAY: (ms: number) => {
                console.log(`[DELAY] 延迟 ${ms}ms`);
                // 同步延迟
                const start = Date.now();
                while (Date.now() - start < ms) {
                  // 空循环
                }
              },
              LOG: (message: string) => {
                console.log(`[LOG] ${message}`);
                logs.push(message);
              },
              JSON,
              Math,
              Date
            };
          
          // 合并变量值和上下文
          const executionContext = {
            ...context,
            ...variableValues
          };
          
          // 构建变量名和值
          const variableNames = Object.keys(executionContext);
          const variableValuesArray = Object.values(executionContext);
          
          // 构建函数体，使用清理后的代码
          const func = new Function(
            ...variableNames,
            cleanCode
          );
          
          // 执行函数，传入变量值
          const returnValue = func(...variableValuesArray);
          
          // 构建执行结果消息
          if (logs.length > 0) {
            result = { 
              success: true, 
              message: logs,
              returnValue: returnValue !== undefined ? returnValue : null
            };
          } else {
            result = { 
              success: true, 
              message: "代码执行成功",
              returnValue: returnValue !== undefined ? returnValue : null
            };
          }
        } catch (codeErr) {
          // 检查是否是 GOTO 宏抛出的特殊错误
          if ((codeErr as any).isGoto) {
            const targetIndex = (codeErr as any).targetIndex;
            console.log(`[执行引擎] 捕获到 GOTO 指令，跳转到索引 ${targetIndex}`);
            // 直接修改循环变量 i，实现跳转
            i = targetIndex - 1; // 减1是因为循环会自动加1
            // 记录 GOTO 操作
            const now = new Date().toLocaleTimeString();
            set((s) => ({
              runLogs: [...s.runLogs, {
                type: block.type,
                label: block.label || block.type,
                status: "ok" as const,
                message: `执行 GOTO 跳转到块索引 ${targetIndex}`,
                time: now,
              }],
            }));
            continue; // 跳过当前块的后续处理，直接进入下一次循环
          }
          // 其他错误
          const errorMsg = codeErr instanceof Error ? codeErr.message : String(codeErr);
          result = {
            success: false,
            message: `错误: ${errorMsg}`
          };
        } finally {
          // 恢复原始 console.log
          console.log = originalLog;
        }
      } else {
        // 其他类型的块在后端执行
        const backendAction: BackendAction = {
          type: block.type,
          params: processedParams,
        };
        result = await executeAction(serial, platform, backendAction);
      }

      // 保存块执行结果
      blockResults.set(block.id, {
        params: block.params,
        result
      });

      // 保存到持久化结果存储
      set((s) => ({
        blockResults: {
          ...s.blockResults,
          [block.id]: {
            params: block.params,
            result,
            timestamp: Date.now()
          }
        }
      }));

      // 保存 shell 命令结果
      if (block.type === "shell" && result.message) {
        set({ lastShellResult: Array.isArray(result.message) ? result.message.join('\n') : result.message });
      }

      // 记录运行日志
      const now = new Date().toLocaleTimeString();
      let detailedMessage = result.message;
      
      // 为不同类型的块生成更详细的消息
      if (result.success) {
        switch (block.type) {
          case 'tap':
          case 'double_tap':
          case 'long_press':
            const tapCoord = processedParams ? processedParams[block.type] : block.params[block.type];
            const tapX = Number(tapCoord.x) || 0;
            const tapY = Number(tapCoord.y) || 0;
            detailedMessage = `点击坐标 (${tapX}, ${tapY}) 成功`;
            break;
          case 'swipe':
          case 'drag':
            const swipeParams = processedParams ? processedParams[block.type] : block.params[block.type];
            const fromX = Number(swipeParams.from.x) || 0;
            const fromY = Number(swipeParams.from.y) || 0;
            const toX = Number(swipeParams.to.x) || 0;
            const toY = Number(swipeParams.to.y) || 0;
            detailedMessage = `从 (${fromX}, ${fromY}) 滑动到 (${toX}, ${toY}) 成功`;
            break;
          case 'keyevent': {
            const keyParams = processedParams ? processedParams[block.type] : block.params[block.type];
            const keyCode = keyParams.code;
            const keyAction = keyParams.action || 'press';
            detailedMessage = `按下按键 ${keyCode} (${keyAction}) 成功`;
            break;
          }
          case 'media_key': {
            const mediaParams = processedParams ? processedParams[block.type] : block.params[block.type];
            const mediaCode = mediaParams.code;
            const mediaAction = mediaParams.action || 'press';
            detailedMessage = `按下媒体键 ${mediaCode} (${mediaAction}) 成功`;
            break;
          }
          case 'device_action': {
            const deviceActionParams = processedParams ? processedParams[block.type] : block.params[block.type];
            const deviceAction = deviceActionParams.action;
            detailedMessage = `执行设备操作 ${deviceAction} 成功`;
            break;
          }
          case 'text': {
            const textParams = processedParams ? processedParams[block.type] : block.params[block.type];
            const textContent = textParams.content || '';
            detailedMessage = `输入文本 "${textContent}" 成功`;
            break;
          }
          case 'open_url': {
            const urlParams = processedParams ? processedParams[block.type] : block.params[block.type];
            const url = urlParams.url || '';
            detailedMessage = `打开 URL "${url}" 成功`;
            break;
          }
          case 'shell':
            // 保持原有的shell命令输出
            break;
          case 'open_app': {
            const appParams = processedParams ? processedParams[block.type] : block.params[block.type];
            const packageName = appParams.package || '';
            detailedMessage = `打开应用 ${packageName} 成功`;
            break;
          }
          case 'delay': {
            const delayParams = processedParams ? processedParams[block.type] : block.params[block.type];
            const delayMs = delayParams.ms || 0;
            detailedMessage = `延迟 ${delayMs}ms 完成`;
            break;
          }
          case 'condition': {
            const condParams = processedParams ? processedParams[block.type] : block.params[block.type];
            const targetX = Number(condParams.target.x) || 0;
            const targetY = Number(condParams.target.y) || 0;
            detailedMessage = result.matched ? `颜色判断 (${targetX}, ${targetY}) 匹配成功` : `颜色判断 (${targetX}, ${targetY}) 未匹配`;
            break;
          }
          case 'code':
            // 保持原有的代码执行输出
            break;
        }
      }
      
      set((s) => ({
        runLogs: [...s.runLogs, {
          type: block.type,
          label: block.label || block.type,
          status: result.success ? "ok" : "error",
          message: detailedMessage || result.message || undefined,
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
  blockResults: {},
  runLogs: [],
  queue: [],

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
      blockResults: {},
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
    set((s) => {
      // 从 blockResults 中删除对应的结果
      const newBlockResults = { ...s.blockResults };
      delete newBlockResults[blockId];
      
      return {
        canvases: s.canvases.map((c) => {
          if (c.id !== get().activeCanvasId) return c;
          return {
            ...c,
            blocks: c.blocks.filter((b) => b.id !== blockId),
            updatedAt: Date.now(),
          };
        }),
        selectedBlockId: s.selectedBlockId === blockId ? null : s.selectedBlockId,
        blockResults: newBlockResults,
      };
    });
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
    // 执行开始时自动展开运行结果面板
    set({ canvasExpanded: true });

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
    // 执行开始时自动展开运行结果面板
    set({ canvasExpanded: true });

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

  // ==================== 队列管理 ====================

  addToQueue: (canvasId) => {
    const { queue } = get();
    const canvas = get().canvases.find((c) => c.id === canvasId);
    if (!canvas) return;
    const item: QueueItem = {
      id: genId("queue"),
      canvasId,
      canvasName: canvas.name,
      status: "pending",
    };
    set((s) => ({ queue: [...s.queue, item] }));
  },

  removeFromQueue: (itemId) => {
    set((s) => ({ queue: s.queue.filter((item) => item.id !== itemId) }));
  },

  clearQueue: () => {
    set({ queue: [] });
  },

  runQueue: async (platform, serial) => {
    const { queue, canvases } = get();
    if (queue.length === 0) return;

    queueStopFlag = false;
    
    // 重置所有项目状态
    set((s) => ({
      queue: s.queue.map((item) => ({ ...item, status: item.status === "pending" ? item.status : "pending" })),
    }));

    for (let i = 0; i < queue.length; i++) {
      if (queueStopFlag) break;
      
      const item = get().queue[i];
      const canvas = canvases.find((c) => c.id === item.canvasId);
      if (!canvas) continue;

      // 设置当前项目为运行中
      set((s) => ({
        queue: s.queue.map((it, idx) =>
          idx === i ? { ...it, status: "running" } : it
        ),
        activeCanvasId: canvas.id,
      }));

      // 运行这个画布
      const result = await runSingleCanvas(canvas, platform, serial, set, get);
      
      if (queueStopFlag) {
        // 队列被停止
        set((s) => ({
          queue: s.queue.map((it, idx) =>
            idx === i ? { ...it, status: "stopped" } : it
          ),
        }));
        break;
      }

      // 更新状态
      set((s) => ({
        queue: s.queue.map((it, idx) =>
          idx === i ? { ...it, status: result } : it
        ),
      }));
    }
  },

  stopQueue: () => {
    queueStopFlag = true;
    stopFlag = true;
    try { stopAutomation(); } catch {}
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
