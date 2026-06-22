# Markdown233

一个跨平台 Markdown 编辑器，类似 Typora 的体验。基于 Tauri 2.11 原生桌面壳，内置多策略云同步，默认 Git。

## ✨ 功能特性

### 📝 编辑器
- **WYSIWYG 编辑** - 所见即所得，类似 Typora 的体验
- **源码模式** - 支持切换到 Markdown 源码编辑
- **实时渲染** - 输入即渲染，无需预览
- **语法高亮** - 代码块支持多种语言
- **表格支持** - GitHub 风格表格
- **快捷键** - 丰富的快捷键支持

### 📁 文件管理
- **侧边栏文件树** - 直观的文件夹浏览
- **快速打开** - 支持打开单个文件或整个文件夹
- **文件搜索** - 快速查找 Markdown 文件

### 🔄 云同步
- **默认 Git** - 原生 Rust/git2 实现，自动提交、快进拉取、推送
- **本地镜像** - 可把 Markdown 文件同步到 OneDrive、iCloud、Dropbox 等本地云盘目录
- **多策略接口** - 前端通过统一 `sync_run` 命令调用，后续可扩展 S3/WebDAV/自建云
- **冲突保护** - 分叉历史默认提示冲突，不静默覆盖本地提交；强制远程覆盖仍需手动确认

### 🎨 界面
- **亮色/暗色主题** - 支持主题切换
- **响应式布局** - 可调整侧边栏宽度
- **状态栏** - 显示字数、行数等信息

## 🚀 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install) >= 1.70
- [Tauri CLI](https://tauri.app/start/prerequisites/)

### 一键安装

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Linux/macOS:

```bash
chmod +x ./install.sh
./install.sh
```

安装脚本会：

- 检查 Node.js、npm、Rust/Cargo
- 安装前端依赖
- 构建 Tauri 原生 release
- 只复制轻量可执行文件到安装目录

可选参数：

```powershell
.\install.ps1 -InstallDir "$env:LOCALAPPDATA\Markdown233" -TauriMajor 2
```

```bash
MARKDOWN233_INSTALL_DIR="$HOME/.local/bin" ./install.sh --tauri-major 2
```

`TauriMajor=3` 已预留。当前 npm/crates.io 可用稳定版为 Tauri 2.x；等 Tauri 3 稳定包发布后，可在同一安装入口切换。

### 开发运行

```bash
# 克隆仓库
git clone https://github.com/neko233-com/markdown233.git
cd markdown233

# 安装依赖
npm install

# 开发模式运行
npm run dev:native

# 构建应用
npm run build:native
```

## 📖 使用指南

### 基本操作

1. **打开文件夹** - 点击左上角文件夹图标或使用 `Ctrl+Shift+O`
2. **打开文件** - 点击文件图标或使用 `Ctrl+O`
3. **新建文件** - 点击新建图标或使用 `Ctrl+N`
4. **保存文件** - 点击保存图标或使用 `Ctrl+S`

### 编辑模式

- **WYSIWYG 模式** - 默认模式，所见即所得
- **源码模式** - 点击代码图标或使用快捷键切换

### 云同步操作

#### 场景 1: Git 同步

1. 打开文件夹
2. 选择同步策略「Git」
3. 点击「同步」
4. 输入提交消息
5. 自动保存、提交、快进拉取、推送

#### 场景 2: 本地云盘镜像

1. 选择同步策略「Local mirror」
2. 点击「目录」选择 OneDrive、iCloud、Dropbox 等本地目录
3. 点击「同步」
4. Markdown/TXT 文件会按目录结构复制到镜像目录

#### 场景 3: 拉取远程更新

1. 点击「拉取」按钮
2. 如果有冲突，会弹出提示
3. 选择「使用远程版本覆盖」或「取消」

#### 场景 4: 初始化 Git

1. 打开一个文件夹
2. 如果不是 Git 仓库，会显示「初始化 Git」按钮
3. 点击即可初始化

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 新建文件 |
| `Ctrl+O` | 打开文件 |
| `Ctrl+Shift+O` | 打开文件夹 |
| `Ctrl+S` | 保存文件 |
| `Ctrl+Shift+S` | 另存为 |
| `Ctrl+B` | 切换侧边栏 |
| `Ctrl+Z` | 撤销 |
| `Ctrl+Y` | 重做 |

## 🛠️ 技术栈

- [Tauri 2.11](https://tauri.app/) - 跨平台桌面框架，3.x 安装入口预留
- [Milkdown](https://milkdown.dev/) - 所见即所得 Markdown 编辑器
- [Vite](https://vitejs.dev/) - 前端构建工具
- [TypeScript](https://www.typescriptlang.org/) - 类型安全
- [git2-rs](https://github.com/rust-lang/git2-rs) - Rust Git 库
- [ProseMirror](https://prosemirror.net/) - 富文本编辑器框架

## 体积策略

- 关闭 `withGlobalTauri`
- 移除未使用的 shell 插件与权限
- Rust release 使用 `opt-level = "z"`、ThinLTO、`strip`、`panic = "abort"`
- 前端仅输出静态 Vite 产物，由 Tauri 原生壳内嵌

## 📁 项目结构

```
markdown233/
├── src/                        # 前端源码
│   ├── main.ts                # 主逻辑
│   └── styles.css             # 样式
├── src-tauri/                  # Tauri 后端
│   ├── src/
│   │   ├── lib.rs             # Git 操作实现
│   │   └── main.rs            # 入口
│   ├── Cargo.toml             # Rust 依赖
│   └── tauri.conf.json        # 配置
├── index.html                  # HTML 入口
├── package.json                # Node.js 依赖
└── vite.config.ts              # Vite 配置
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🙏 致谢

- [Milkdown](https://milkdown.dev/) - 优秀的 WYSIWYG Markdown 编辑器框架
- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [libgit2](https://libgit2.org/) - Git 实现库
