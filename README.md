# Android Toolbox

一款跨平台桌面应用，通过 ADB 命令控制安卓手机。支持 macOS、Linux 和 Windows。

## 功能特性

- **APK 安装** - 双击 .apk/.apks 文件即可查看应用信息并安装
- **设备管理** - 自动检测 USB/WiFi 连接的安卓设备
- **应用管理** - 查看已安装应用列表，支持启动、停止、卸载、清除数据
- **工具箱** - 截屏、文件管理、Logcat 日志查看
- **性能监控** - CPU、内存、电池、存储实时监控
- **Shell 终端** - 内置 ADB Shell 终端
- **中英双语** - 支持中文和英文界面切换
- **连接引导** - 内置开发者选项和 USB 调试开启教程

## 环境要求

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install) >= 1.70
- [Android SDK Platform Tools](https://developer.android.com/tools/releases/platform-tools)（ADB 命令行工具）

### 各平台额外要求

**macOS:**
```bash
xcode-select --install
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
```

**Windows:**
- 安装 [Microsoft Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
- 安装 [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)（Windows 11 已内置）

## 快速开始

### 1. 克隆项目

```bash
git clone <repository-url>
cd android-toolbox
```

### 2. 安装前端依赖

```bash
npm install
```

### 3. 开发模式运行

```bash
npm run tauri dev
```

### 4. 构建生产版本

```bash
npm run tauri build
```

构建产物在 `src-tauri/target/release/bundle/` 目录下。

## 项目结构

```
android-toolbox/
├── src/                    # React 前端
│   ├── api/                # Tauri IPC 调用封装
│   ├── components/         # 通用组件
│   ├── i18n/               # 国际化（中/英）
│   ├── pages/              # 页面组件
│   ├── store/              # Zustand 状态管理
│   ├── types/              # TypeScript 类型定义
│   ├── App.tsx             # 路由配置
│   └── main.tsx            # 入口文件
├── src-tauri/              # Rust 后端
│   ├── src/
│   │   ├── main.rs         # 入口
│   │   ├── lib.rs          # 模块注册 & Tauri 配置
│   │   ├── adb.rs          # ADB 命令封装（核心）
│   │   ├── commands.rs     # Tauri Command 处理器
│   │   ├── state.rs        # 全局状态管理
│   │   ├── events.rs       # 事件定义
│   │   └── utils.rs        # 工具函数
│   ├── capabilities/       # Tauri v2 权限配置
│   ├── icons/              # 应用图标
│   └── tauri.conf.json     # Tauri 配置
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite 5 |
| 样式方案 | Tailwind CSS 3 |
| 状态管理 | Zustand |
| 国际化 | i18next + react-i18next |
| 路由 | React Router v6 |
| 桌面框架 | Tauri v2 (Rust) |
| 后端语言 | Rust (async/await + tokio) |

## ADB 配置

应用会自动在系统 PATH 中查找 `adb` 命令。如果未找到，可以在设置页面手动指定 ADB 路径。

常见 ADB 路径：
- **macOS (Homebrew):** `/opt/homebrew/bin/adb`
- **macOS (Android Studio):** `~/Library/Android/sdk/platform-tools/adb`
- **Linux:** `/usr/bin/adb` 或 `~/Android/Sdk/platform-tools/adb`
- **Windows:** `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`

## 文件关联

安装后，双击 `.apk` 或 `.apks` 文件会自动打开 Android Toolbox 并显示应用安装界面。

## License

MIT
