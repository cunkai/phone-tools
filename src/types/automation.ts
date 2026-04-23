// ==================== 坐标与颜色基础类型 ====================

/** 屏幕坐标点 */
export interface Point {
  x: number | string;
  y: number | string;
  /** 坐标类型：fixed（固定坐标）、random_rect（矩形随机）、random_circle（圆形随机）、custom（自定义随机） */
  type?: 'fixed' | 'random_rect' | 'random_circle' | 'custom';
  /** 矩形随机参数 */
  rectParams?: {
    width: number;
    height: number;
  };
  /** 圆形随机参数 */
  circleParams?: {
    radius: number;
  };
  /** 自定义随机代码 */
  customCode?: string;
}

/** RGBA 颜色值 */
export interface Color {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
  a: number; // 0-255
}

// ==================== 所有操作类型的参数联合 ====================

/**
 * 核心设计：用 discriminated union 的 params 字段区分不同操作
 * type 字段决定操作类型，params 字段携带该操作所需的全部参数
 */
export type ActionParams =
  | { tap: Point }                              // 单击
  | { double_tap: Point }                       // 双击
  | { long_press: Point & { duration?: number }} // 长按（可选持续时间，默认1000ms）
  | { swipe: {                                  // 滑动
      from: Point;
      to: Point;
      duration?: number; // 滑动持续时间(ms)，默认300
    }}
  | { drag: {                                   // 拖拽（语义上与 swipe 相同，但持续时间更长）
      from: Point;
      to: Point;
      duration?: number; // 默认1000
    }}
  | { keyevent: {                                // 发送按键（Android keycode / HarmonyOS keyCode）
      code: number;
      action: "press" | "release" | "long_press"; // press=按下(-d), release=抬起(-u), long_press=长按(-l)
      duration?: number;                          // long_press 持续时间(ms)，默认3000
      inputMode?: "preset" | "keycode" | "text";  // preset=常用按键, keycode=按键码, text=字母数字
      textInput?: string;                         // inputMode=text 时，输入的字母数字字符串
    }}
  | { media_key: {                               // 媒体按键
      code: number;
      action: "press" | "release" | "long_press";
      duration?: number;                          // long_press 持续时间(ms)，默认3000
    }}
  | { device_action: { action: string; timeout_ms?: number } }  // 设备操作（电源、音量、亮屏等）
  | { gamepad: {                                 // 游戏手柄按键
      code: number;
      action: "press" | "release" | "long_press";
      duration?: number;                          // long_press 持续时间(ms)，默认3000
    }}
  | { text: { content: string } }               // 输入文本
  | { open_url: { url: string } }               // 打开网页
  | { shell: { command: string } }              // 执行Shell命令
  | { open_app: { package: string } }           // 打开软件
  | { delay: { ms: number } }                   // 延迟等待
  | { condition: {                              // 条件判断（像素颜色检测）
      target: Point;          // 检测的像素坐标
      expected: Color;        // 期望颜色
      tolerance?: number;     // 颜色容差(0-255)，默认30
      toleranceR?: number;    // 红色通道容差(0-255)，默认30
      toleranceG?: number;    // 绿色通道容差(0-255)，默认30
      toleranceB?: number;    // 蓝色通道容差(0-255)，默认30
      timeout?: number;       // 超时时间(ms)，默认5000
      interval?: number;      // 检测间隔(ms)，默认500
      on_match?: ActionBlock[];   // 匹配时执行（可选，不填则继续下一步）
      on_fail?: ActionBlock[];    // 不匹配时执行（可选，不填则跳过）
    }}
  | { code: {                                  // 代码组件（TypeScript）
      content: string;        // TypeScript 代码内容
      variables?: Array<{     // 全局变量定义
        name: string;         // 变量名
        source: {             // 变量来源
          blockId: string;     // 来源块ID
          property: string;    // 来源属性路径
          type: string;        // 变量类型
        };
      }>;
    }};

// ==================== ActionBlock 主类型 ====================

/**
 * 积木块（ActionBlock）
 *
 * 每个块在画布上有唯一 id，有类型和参数，有可选的标签和禁用状态
 */
export interface ActionBlock {
  /** 唯一标识，格式 "blk_" + nanoid(8) */
  id: string;

  /** 操作类型，与 ActionParams 的 discriminated key 一一对应 */
  type: keyof ActionParams;

  /** 操作参数，内容取决于 type */
  params: ActionParams;

  /** 用户自定义标签（可选，用于画布显示） */
  label?: string;

  /** 是否禁用（禁用的块在执行时跳过） */
  disabled?: boolean;
}

// ==================== 执行引擎状态 ====================

export type ExecutionStatus =
  | 'idle'       // 空闲
  | 'running'    // 执行中
  | 'paused'     // 暂停（预留，当前版本不实现）
  | 'stopped'    // 被用户手动停止
  | 'completed'  // 全部执行完成
  | 'error';     // 执行出错

export interface ExecutionState {
  /** 当前执行状态 */
  status: ExecutionStatus;

  /** 当前正在执行的块索引（null 表示未开始或已结束） */
  currentIndex: number | null;

  /** 错误信息（仅 status=error 时有值） */
  errorMessage: string | null;

  /** 已执行的步骤数 */
  executedCount: number;

  /** 总步骤数 */
  totalCount: number;

  /** 当前循环轮次 */
  currentLoop?: number;

  /** 总循环次数（0 = 无限） */
  totalLoops?: number;
}

// ==================== 画布（脚本）数据结构 ====================

/**
 * 一个画布 = 一组有序的 ActionBlock + 元信息
 */
export interface AutomationCanvas {
  /** 画布唯一标识 */
  id: string;

  /** 画布名称 */
  name: string;

  /** 创建时间戳 */
  createdAt: number;

  /** 最后修改时间戳 */
  updatedAt: number;

  /** 有序的积木块列表 */
  blocks: ActionBlock[];

  /** 运行配置 */
  runConfig: RunConfig;
}

/** 运行配置 */
export interface RunConfig {
  /** 是否循环执行 */
  loop: boolean;
  /** 循环次数，0 = 无限循环 */
  loopCount: number;
  /** 每次循环间隔(ms) */
  loopInterval: number;
  /** 出错时是否继续下一个块 */
  continueOnError: boolean;
  /** 执行前延迟(ms) */
  startDelay: number;
}

// ==================== 后端 Action JSON（与前端共享结构） ====================

/**
 * 传给 Rust 后端的 action 对象
 * 与 ActionBlock 结构一致，Rust 端用 serde 反序列化
 *
 * 注意：condition 的 on_match/on_fail 递归子块不会传给后端
 * 条件判断的子块在前端循环处理，每次只传一个原子操作给后端
 */
export type BackendAction = Omit<ActionBlock, 'id' | 'label' | 'disabled'>;

/** execute_action 的返回值 */
export interface ActionResult {
  success: boolean;
  message?: string | string[];
  /** 条件判断时返回实际检测到的颜色 */
  actualColor?: Color;
  /** 条件判断时返回是否匹配 */
  matched?: boolean;
  /** 代码块的返回值 */
  returnValue?: any;
}
