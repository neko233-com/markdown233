import { Marked } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import { open, save } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

// Initialize marked with syntax highlighting
const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  })
);

// App State
interface AppState {
  currentFile: string | null;
  content: string;
  modified: boolean;
  viewMode: 'split' | 'editor' | 'preview';
  theme: 'light' | 'dark';
}

const state: AppState = {
  currentFile: null,
  content: '',
  modified: false,
  viewMode: 'split',
  theme: localStorage.getItem('theme') as 'light' | 'dark' || 'light'
};

// DOM Elements
const editor = document.getElementById('editor') as HTMLTextAreaElement;
const preview = document.getElementById('preview') as HTMLDivElement;
const editorContainer = document.querySelector('.editor-container') as HTMLElement;
const divider = document.getElementById('divider') as HTMLElement;
const editorPanel = document.getElementById('editor-panel') as HTMLElement;
const previewPanel = document.getElementById('preview-panel') as HTMLElement;
const statusFile = document.getElementById('status-file') as HTMLElement;
const statusModified = document.getElementById('status-modified') as HTMLElement;
const statusView = document.getElementById('status-view') as HTMLElement;
const statusWords = document.getElementById('status-words') as HTMLElement;
const statusLines = document.getElementById('status-lines') as HTMLElement;
const statusCursor = document.getElementById('status-cursor') as HTMLElement;

// Initialize theme
document.documentElement.setAttribute('data-theme', state.theme);

// Markdown rendering
function renderMarkdown(text: string): string {
  return marked.parse(text) as string;
}

// Update preview
function updatePreview() {
  const html = renderMarkdown(state.content);
  preview.innerHTML = html;
}

// Update status bar
function updateStatusBar() {
  const text = state.content;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const lines = text.split('\n').length;

  statusFile.textContent = state.currentFile
    ? state.currentFile.split(/[\\/]/).pop() || '未命名'
    : '未命名';
  statusModified.textContent = state.modified ? '● 已修改' : '';
  statusWords.textContent = `${words} 字`;
  statusLines.textContent = `${lines} 行`;
}

// Update cursor position
function updateCursorPosition() {
  const pos = editor.selectionStart;
  const textBefore = state.content.substring(0, pos);
  const lines = textBefore.split('\n');
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  statusCursor.textContent = `行 ${line}, 列 ${column}`;
}

// Handle content change
function handleContentChange() {
  state.content = editor.value;
  state.modified = true;
  updatePreview();
  updateStatusBar();
}

// File operations
async function newFile() {
  if (state.modified) {
    const confirmed = confirm('当前文件未保存，是否继续？');
    if (!confirmed) return;
  }
  state.currentFile = null;
  state.content = '';
  state.modified = false;
  editor.value = '';
  updatePreview();
  updateStatusBar();
  document.title = 'Markdown233 - 未命名';
}

async function openFile() {
  if (state.modified) {
    const confirmed = confirm('当前文件未保存，是否继续？');
    if (!confirmed) return;
  }

  const selected = await open({
    multiple: false,
    filters: [{
      name: 'Markdown',
      extensions: ['md', 'markdown', 'txt']
    }]
  });

  if (selected) {
    const filePath = selected as string;
    const content = await readTextFile(filePath);
    state.currentFile = filePath;
    state.content = content;
    state.modified = false;
    editor.value = content;
    updatePreview();
    updateStatusBar();
    document.title = `Markdown233 - ${filePath.split(/[\\/]/).pop()}`;
  }
}

async function saveFile() {
  if (!state.currentFile) {
    await saveFileAs();
    return;
  }

  await writeTextFile(state.currentFile, state.content);
  state.modified = false;
  updateStatusBar();
}

async function saveFileAs() {
  const filePath = await save({
    filters: [{
      name: 'Markdown',
      extensions: ['md']
    }],
    defaultPath: state.currentFile || 'untitled.md'
  });

  if (filePath) {
    await writeTextFile(filePath, state.content);
    state.currentFile = filePath;
    state.modified = false;
    updateStatusBar();
    document.title = `Markdown233 - ${filePath.split(/[\\/]/).pop()}`;
  }
}

// View mode
function setViewMode(mode: 'split' | 'editor' | 'preview') {
  state.viewMode = mode;
  editorContainer.className = 'editor-container';

  switch (mode) {
    case 'editor':
      editorContainer.classList.add('editor-only');
      statusView.textContent = '编辑视图';
      break;
    case 'preview':
      editorContainer.classList.add('preview-only');
      statusView.textContent = '预览视图';
      break;
    default:
      statusView.textContent = '分栏视图';
      break;
  }
}

function toggleViewMode() {
  const modes: Array<'split' | 'editor' | 'preview'> = ['split', 'editor', 'preview'];
  const currentIndex = modes.indexOf(state.viewMode);
  const nextIndex = (currentIndex + 1) % modes.length;
  setViewMode(modes[nextIndex]);
}

// Theme toggle
function toggleTheme() {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('theme', state.theme);
}

// Toolbar formatting
function insertText(before: string, after: string = '') {
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = state.content.substring(start, end);
  const replacement = before + selected + after;

  state.content = state.content.substring(0, start) + replacement + state.content.substring(end);
  editor.value = state.content;

  // Set cursor position
  const newPos = start + before.length + selected.length;
  editor.setSelectionRange(newPos, newPos);
  editor.focus();

  handleContentChange();
}

function insertLine(prefix: string) {
  const start = editor.selectionStart;
  const lineStart = state.content.lastIndexOf('\n', start - 1) + 1;
  const insertion = prefix;

  state.content = state.content.substring(0, lineStart) + insertion + state.content.substring(lineStart);
  editor.value = state.content;

  const newPos = lineStart + insertion.length;
  editor.setSelectionRange(newPos, newPos);
  editor.focus();

  handleContentChange();
}

// Divider drag
let isDragging = false;

divider.addEventListener('mousedown', () => {
  isDragging = true;
  divider.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});

document.addEventListener('mousemove', (e) => {
  if (!isDragging) return;

  const containerRect = editorContainer.getBoundingClientRect();
  const percentage = ((e.clientX - containerRect.left) / containerRect.width) * 100;

  if (percentage > 20 && percentage < 80) {
    editorPanel.style.flex = `0 0 ${percentage}%`;
    previewPanel.style.flex = `0 0 ${100 - percentage}%`;
  }
});

document.addEventListener('mouseup', () => {
  if (isDragging) {
    isDragging = false;
    divider.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

// Event listeners
editor.addEventListener('input', handleContentChange);
editor.addEventListener('keyup', updateCursorPosition);
editor.addEventListener('click', updateCursorPosition);

// Toolbar buttons
document.getElementById('btn-new')?.addEventListener('click', newFile);
document.getElementById('btn-open')?.addEventListener('click', openFile);
document.getElementById('btn-save')?.addEventListener('click', saveFile);
document.getElementById('btn-undo')?.addEventListener('click', () => {
  document.execCommand('undo');
  editor.focus();
});
document.getElementById('btn-redo')?.addEventListener('click', () => {
  document.execCommand('redo');
  editor.focus();
});
document.getElementById('btn-bold')?.addEventListener('click', () => insertText('**', '**'));
document.getElementById('btn-italic')?.addEventListener('click', () => insertText('*', '*'));
document.getElementById('btn-strikethrough')?.addEventListener('click', () => insertText('~~', '~~'));
document.getElementById('btn-heading')?.addEventListener('click', () => insertLine('## '));
document.getElementById('btn-quote')?.addEventListener('click', () => insertLine('> '));
document.getElementById('btn-code')?.addEventListener('click', () => insertText('`', '`'));
document.getElementById('btn-list')?.addEventListener('click', () => insertLine('- '));
document.getElementById('btn-link')?.addEventListener('click', () => insertText('[', '](url)'));
document.getElementById('btn-image')?.addEventListener('click', () => insertText('![alt](', ')'));
document.getElementById('btn-table')?.addEventListener('click', () => {
  const table = '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n';
  insertLine(table);
});
document.getElementById('btn-hr')?.addEventListener('click', () => insertLine('\n---\n'));
document.getElementById('btn-view-toggle')?.addEventListener('click', toggleViewMode);
document.getElementById('btn-theme')?.addEventListener('click', toggleTheme);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey) {
    switch (e.key.toLowerCase()) {
      case 'n':
        e.preventDefault();
        newFile();
        break;
      case 'o':
        e.preventDefault();
        openFile();
        break;
      case 's':
        e.preventDefault();
        if (e.shiftKey) {
          saveFileAs();
        } else {
          saveFile();
        }
        break;
      case 'b':
        e.preventDefault();
        insertText('**', '**');
        break;
      case 'i':
        e.preventDefault();
        insertText('*', '*');
        break;
    }
  }
});

// Tab key support in editor
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;

    state.content = state.content.substring(0, start) + '    ' + state.content.substring(end);
    editor.value = state.content;
    editor.setSelectionRange(start + 4, start + 4);
    handleContentChange();
  }
});

// Load default content
const defaultContent = `# 欢迎使用 Markdown233

这是一个类似 Typora 的跨平台 Markdown 编辑器。

## 功能特性

- **实时预览** - 左侧编辑，右侧实时渲染
- **语法高亮** - 代码块支持语法高亮
- **暗色主题** - 支持亮色/暗色主题切换
- **文件操作** - 新建、打开、保存文件
- **快捷键** - 支持常用快捷键操作

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| Ctrl+N | 新建文件 |
| Ctrl+O | 打开文件 |
| Ctrl+S | 保存文件 |
| Ctrl+Shift+S | 另存为 |
| Ctrl+B | 粗体 |
| Ctrl+I | 斜体 |
| Tab | 插入缩进 |

## 代码示例

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

console.log(greet('World'));
\`\`\`

## 引用

> Markdown233 - 让写作更简单

## 列表

- [x] 创建项目
- [x] 实现编辑器
- [ ] 添加更多功能
- [ ] 发布 v1.0

---

开始写作吧！
`;

// Initialize
editor.value = defaultContent;
state.content = defaultContent;
updatePreview();
updateStatusBar();
updateCursorPosition();
