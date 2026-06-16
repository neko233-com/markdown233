# Markdown233

一个跨平台的 Markdown 编辑器，类似 Typora 的体验。

## 功能特性

- 🖊️ **实时预览** - 左侧编辑，右侧实时渲染
- 🎨 **语法高亮** - 代码块支持多种语言语法高亮
- 🌓 **主题切换** - 支持亮色/暗色主题
- 📁 **文件操作** - 新建、打开、保存 Markdown 文件
- ⌨️ **快捷键** - 支持常用快捷键操作
- 📊 **可调分栏** - 可拖动调整编辑器和预览区比例
- 📈 **状态栏** - 显示字数、行数、光标位置等信息

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl+N` | 新建文件 |
| `Ctrl+O` | 打开文件 |
| `Ctrl+S` | 保存文件 |
| `Ctrl+Shift+S` | 另存为 |
| `Ctrl+B` | 粗体 |
| `Ctrl+I` | 斜体 |
| `Tab` | 插入缩进 |

## 开发环境

### 前置要求

- [Node.js](https://nodejs.org/) >= 18
- [Rust](https://www.rust-lang.org/tools/install) >= 1.70
- [Tauri CLI](https://tauri.app/start/prerequisites/)

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run tauri dev
```

### 构建应用

```bash
npm run tauri build
```

## 技术栈

- [Tauri 2](https://tauri.app/) - 跨平台桌面应用框架
- [Vite](https://vitejs.dev/) - 前端构建工具
- [TypeScript](https://www.typescriptlang.org/) - 类型安全的 JavaScript
- [Marked](https://marked.js.org/) - Markdown 解析器
- [highlight.js](https://highlightjs.org/) - 语法高亮

## 项目结构

```
markdown233/
├── src/                  # 前端源码
│   ├── main.ts          # 主逻辑
│   └── styles.css       # 样式
├── src-tauri/            # Tauri 后端
│   ├── src/
│   │   └── lib.rs       # Rust 入口
│   ├── Cargo.toml       # Rust 依赖
│   └── tauri.conf.json  # Tauri 配置
├── index.html           # HTML 入口
├── package.json         # Node.js 依赖
└── vite.config.ts       # Vite 配置
```

## 许可证

MIT License
