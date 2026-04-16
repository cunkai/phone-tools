/**
 * ADB 命令队列管理器
 * 
 * 功能：
 * 1. 排队执行：所有命令串行执行，防止并发导致设备崩溃
 * 2. 去重：同类型命令只保留最新的（如连续 tap 只执行最后一次）
 * 3. 有效期：命令有超时时间，过期丢弃
 * 4. 优先级：用户操作优先于截图流
 */

// 命令类型，用于去重
type CommandType = 
  | 'tap'
  | 'swipe'
  | 'keyevent'
  | 'text'
  | 'screenshot'
  | 'brightness'
  | 'volume'
  | 'wifi'
  | 'airplane'
  | 'other';

interface QueueItem {
  id: string;
  type: CommandType;
  priority: 'high' | 'normal' | 'low'; // high: 用户操作, low: 截图流
  execute: () => Promise<void>;
  createdAt: number;
  expiresAt: number; // 过期时间
  key: string; // 用于去重的 key
}

class AdbCommandQueue {
  private queue: QueueItem[] = [];
  private running = false;
  private currentCommand: QueueItem | null = null;
  
  // 默认有效期：5 秒
  private defaultTTL = 5000;
  
  // 命令类型到 key 的映射函数
  private getKey(type: CommandType, params?: any): string {
    switch (type) {
      case 'tap':
      case 'swipe':
        return type; // tap/swipe 只保留最后一个，不管坐标
      case 'keyevent':
        return `keyevent_${params?.keycode || ''}`; // 相同 keycode 去重
      case 'brightness':
        return 'brightness'; // 只保留最后一个亮度值
      case 'volume':
        return 'volume';
      case 'wifi':
        return 'wifi';
      case 'airplane':
        return 'airplane';
      case 'screenshot':
        return `screenshot_${params?.serial || ''}`;
      default:
        return `${type}_${Date.now()}`; // 不去重
    }
  }

  /**
   * 添加命令到队列
   */
  enqueue(
    type: CommandType,
    execute: () => Promise<void>,
    options?: {
      priority?: 'high' | 'normal' | 'low';
      ttl?: number;
      params?: any;
    }
  ): void {
    const now = Date.now();
    const ttl = options?.ttl || this.defaultTTL;
    const priority = options?.priority || 'normal';
    const key = this.getKey(type, options?.params);

    const item: QueueItem = {
      id: `${type}_${now}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      priority,
      execute,
      createdAt: now,
      expiresAt: now + ttl,
      key,
    };

    // 去重：移除同 key 的旧命令（未执行的）
    this.queue = this.queue.filter(q => q.key !== key);

    // 按优先级插入
    if (priority === 'high') {
      // 高优先级插到队首（但要在其他高优先级命令后面）
      const firstNormalIdx = this.queue.findIndex(q => q.priority !== 'high');
      if (firstNormalIdx === -1) {
        this.queue.push(item);
      } else {
        this.queue.splice(firstNormalIdx, 0, item);
      }
    } else if (priority === 'low') {
      // 低优先级插到队尾
      this.queue.push(item);
    } else {
      // 普通优先级插到低优先级前面
      const firstLowIdx = this.queue.findIndex(q => q.priority === 'low');
      if (firstLowIdx === -1) {
        this.queue.push(item);
      } else {
        this.queue.splice(firstLowIdx, 0, item);
      }
    }

    // 尝试执行
    this.process();
  }

  /**
   * 处理队列
   */
  private async process(): Promise<void> {
    if (this.running || this.queue.length === 0) return;

    this.running = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      
      // 检查是否过期
      if (Date.now() > item.expiresAt) {
        console.log(`[ADB Queue] Command ${item.id} expired, skipping`);
        continue;
      }

      this.currentCommand = item;
      
      try {
        await item.execute();
      } catch (err) {
        console.error(`[ADB Queue] Command ${item.id} failed:`, err);
      }

      this.currentCommand = null;
    }

    this.running = false;
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = [];
  }

  /**
   * 获取队列长度
   */
  get length(): number {
    return this.queue.length;
  }

  /**
   * 是否正在执行
   */
  get isRunning(): boolean {
    return this.running;
  }
}

// 全局单例
export const adbQueue = new AdbCommandQueue();

// 便捷方法
export const enqueueTap = (execute: () => Promise<void>) => {
  adbQueue.enqueue('tap', execute, { priority: 'high' });
};

export const enqueueSwipe = (execute: () => Promise<void>) => {
  adbQueue.enqueue('swipe', execute, { priority: 'high' });
};

export const enqueueKeyevent = (execute: () => Promise<void>, keycode: number) => {
  adbQueue.enqueue('keyevent', execute, { priority: 'high', params: { keycode } });
};

export const enqueueText = (execute: () => Promise<void>) => {
  adbQueue.enqueue('text', execute, { priority: 'high' });
};

export const enqueueScreenshot = (execute: () => Promise<void>, serial: string) => {
  adbQueue.enqueue('screenshot', execute, { priority: 'low', params: { serial } });
};

export const enqueueBrightness = (execute: () => Promise<void>) => {
  adbQueue.enqueue('brightness', execute, { priority: 'normal' });
};

export const enqueueVolume = (execute: () => Promise<void>) => {
  adbQueue.enqueue('volume', execute, { priority: 'normal' });
};
