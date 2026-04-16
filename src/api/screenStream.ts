import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ScreenStreamCallbacks {
  onFrame: () => void;
  onError: (message: string) => void;
  onStopped: () => void;
}

/**
 * 管理实时屏幕流：后端 JPEG 截图循环 → 前端显示到 img 元素
 * 比 H264 方案兼容性更好，不依赖 WebCodecs
 */
export class ScreenStream {
  private img: HTMLImageElement | null = null;
  private unlisteners: UnlistenFn[] = [];
  private running = false;
  private frameCount = 0;
  private callbacks: ScreenStreamCallbacks;

  constructor(callbacks: ScreenStreamCallbacks) {
    this.callbacks = callbacks;
  }

  private serial: string = "";

  async start(serial: string, img: HTMLImageElement, intervalMs?: number) {
    this.img = img;
    this.serial = serial;
    this.running = true;
    this.frameCount = 0;

    // img.onload 用于获取实际尺寸（图片解码完成后才有 naturalWidth）
    if (this.img) {
      this.img.onload = () => {
        if (this.img && this.img.naturalWidth > 0 && this.img.naturalHeight > 0) {
          this.callbacks.onFrame();
        }
      };
    }

    // 监听帧事件
    const unlistenFrame = await listen<{ data: string; width: number; height: number }>(
      "screen-frame",
      (event) => {
        if (!this.running || !this.img) return;
        this.img.src = `data:image/png;base64,${event.payload.data}`;
        this.frameCount++;
      }
    );

    // 监听错误事件
    const unlistenError = await listen<{ message: string }>("screen-error", (event) => {
      console.error("[ScreenStream] Error:", event.payload.message);
      this.callbacks.onError(event.payload.message);
    });

    this.unlisteners = [unlistenFrame, unlistenError];

    // 启动后端截图循环
    try {
      await invoke("start_screen_stream", {
        serial,
        intervalMs: intervalMs ?? 200,
      });
    } catch (e) {
      this.callbacks.onError(`启动屏幕流失败: ${e}`);
      this.stop();
    }
  }

  async stop() {
    this.running = false;

    // 通知后端停止截图循环
    if (this.serial) {
      try {
        await invoke("stop_screen_stream", { serial: this.serial });
      } catch (e) {
        console.warn("[ScreenStream] stop_screen_stream error:", e);
      }
    }

    // 清理事件监听
    for (const unlisten of this.unlisteners) {
      unlisten();
    }
    this.unlisteners = [];

    this.callbacks.onStopped();
    console.log(`[ScreenStream] Stopped after ${this.frameCount} frames`);
  }

  get isRunning() {
    return this.running;
  }

  get frameCountValue() {
    return this.frameCount;
  }
}
