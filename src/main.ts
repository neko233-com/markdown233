import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { gfm } from '@milkdown/preset-gfm';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { history } from '@milkdown/plugin-history';
import { clipboard } from '@milkdown/plugin-clipboard';
import { indent } from '@milkdown/plugin-indent';
import { nord } from '@milkdown/theme-nord';
import { invoke } from '@tauri-apps/api/core';
import { open, save, ask } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile, readDir, mkdir, writeFile } from '@tauri-apps/plugin-fs';
import { relaunch } from '@tauri-apps/plugin-process';
import { check } from '@tauri-apps/plugin-updater';
import { join } from '@tauri-apps/api/path';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  applyStaticI18n,
  currentLanguageSetting,
  exportBuiltinLocale,
  loadUserLocaleOverrides,
  localeOptions,
  resetUserLocaleOverrides,
  saveUserLocaleOverrides,
  setLocale,
  t,
  type Locale,
} from './i18n';

// Types
interface FileNode {
  path: string;
  name: string;
  isDirectory: boolean;
  children?: FileNode[];
  expanded?: boolean;
}

interface GitStatus {
  file: string;
  status: string;
  is_staged: boolean;
}

interface ConflictInfo {
  has_conflict: boolean;
  message: string;
  conflicted_files: string[];
}

interface SyncStrategy {
  id: string;
  name: string;
  description: string;
  is_default: boolean;
  needs_target: boolean;
}

interface SyncResult {
  strategy: string;
  ok: boolean;
  message: string;
  changed_files: number;
}

interface HeadingInfo {
  level: number;
  text: string;
  line: number;
  slug: string;
}

interface LinkInfo {
  raw: string;
  target: string;
  heading?: string;
  block?: string;
  label?: string;
}

interface BlockInfo {
  id: string;
  line: number;
  preview: string;
}

interface VaultNote {
  path: string;
  title: string;
  links: string[];
  linkInfos: LinkInfo[];
  tags: string[];
  aliases: string[];
  frontmatter: Record<string, string | string[]>;
  headings: HeadingInfo[];
  blocks: BlockInfo[];
  preview: string;
  body: string;
}

interface CustomTheme {
  accent: string;
  surface: string;
  text: string;
  editorWidth: number;
}

interface ThemePackage {
  name: string;
  version: string;
  variables: CustomTheme;
  localeOverrides?: Record<string, string>;
}

interface GraphNode {
  id: string;
  title: string;
  x: number;
  y: number;
  radius: number;
  tags: string[];
}

interface GraphLink {
  source: string;
  target: string;
}

interface GraphState {
  nodes: GraphNode[];
  links: GraphLink[];
  zoom: number;
  panX: number;
  panY: number;
  dragNodeId: string | null;
  isPanning: boolean;
  lastX: number;
  lastY: number;
  pointerMoved: boolean;
  filter: string;
}

interface AppCommand {
  id: string;
  title: () => string;
  group: () => string;
  shortcut?: string;
  run: () => void | Promise<void>;
}

interface FindState {
  query: string;
  matches: number[];
  index: number;
}

interface PluginPanel {
  id: string;
  title: string;
  render: (container: HTMLElement) => void;
}

interface Markdown233Plugin {
  id: string;
  name: string;
  activate: (api: PluginApi) => void | Promise<void>;
}

interface PluginApi {
  registerCommand: (command: AppCommand) => void;
  registerPanel: (panel: PluginPanel) => void;
  getVaultNotes: () => VaultNote[];
  getCurrentFile: () => string | null;
  switchPanel: (panel: string) => void;
  toast: (message: string, type?: 'success' | 'error' | 'warning') => void;
}

interface VaultConfig {
  version: number;
  theme: CustomTheme;
  syncStrategy: string;
  mirrorPath: string | null;
  graph: {
    panX: number;
    panY: number;
    zoom: number;
    nodes: Record<string, { x: number; y: number }>;
  };
  enabledPlugins: string[];
  shortcuts: Record<string, string>;
}

interface PluginManifest {
  id: string;
  name: string;
  version?: string;
  description?: string;
  main?: string;
  permissions?: string[];
  commands?: Array<{ id: string; title: string; group?: string }>;
  panels?: Array<{ id: string; title: string }>;
}

interface PluginInstall {
  manifest: PluginManifest;
  enabled: boolean;
}

// App State
interface AppState {
  currentFile: string | null;
  currentFolder: string | null;
  content: string;
  modified: boolean;
  fileTree: FileNode[];
  fileTreeSearch: string;
  fileTreeSearchResults: FileNode[];
  fileTreeSearching: boolean;
  expandedDirs: Set<string>;
  activeFilePath: string | null;
  isSourceMode: boolean;
  theme: 'light' | 'dark';
  gitBranch: string | null;
  gitStatuses: GitStatus[];
  syncStrategies: SyncStrategy[];
  syncStrategy: string;
  mirrorPath: string | null;
  vaultNotes: VaultNote[];
  activeHeadings: HeadingInfo[];
  activeBacklinks: VaultNote[];
  customTheme: CustomTheme;
  graph: GraphState;
  shortcuts: Record<string, string>;
  vaultConfig: VaultConfig | null;
  pluginManifests: PluginInstall[];
  unresolvedLinks: string[];
  find: FindState;
  editor: Editor | null;
}

const DEFAULT_SHORTCUTS: Record<string, string> = {
  'app.commandPalette': 'Mod+K',
  'search.global': 'Mod+P',
  'search.find': 'Mod+F',
  'search.replace': 'Mod+Alt+F',
  'file.new': 'Mod+N',
  'file.open': 'Mod+O',
  'folder.open': 'Mod+Shift+O',
  'file.save': 'Mod+S',
  'file.saveAs': 'Mod+Shift+S',
  'view.sidebar': 'Mod+Shift+B',
  'settings.open': 'Mod+,',
  'edit.bold': 'Mod+B',
  'edit.italic': 'Mod+I',
  'edit.inlineCode': 'Mod+E',
  'edit.strike': 'Mod+Shift+X',
  'edit.bulletList': 'Mod+Shift+8',
  'edit.orderedList': 'Mod+Shift+7',
  'edit.taskList': 'Mod+Shift+9',
  'edit.heading1': 'Alt+1',
  'edit.heading2': 'Alt+2',
  'edit.heading3': 'Alt+3',
  'edit.heading4': 'Alt+4',
  'edit.heading5': 'Alt+5',
  'edit.heading6': 'Alt+6',
  'edit.quote': 'Alt+Q',
  'edit.link': 'Mod+L',
  'edit.image': 'Mod+Alt+I',
  'edit.table': 'Mod+Alt+T',
  'edit.codeBlock': 'Mod+Alt+C',
  'edit.mathBlock': 'Mod+Alt+M',
};

const state: AppState = {
  currentFile: null,
  currentFolder: null,
  content: '',
  modified: false,
  fileTree: [],
  fileTreeSearch: '',
  fileTreeSearchResults: [],
  fileTreeSearching: false,
  expandedDirs: new Set(),
  activeFilePath: null,
  isSourceMode: false,
  theme: (localStorage.getItem('theme') as 'light' | 'dark') || 'light',
  gitBranch: null,
  gitStatuses: [],
  syncStrategies: [],
  syncStrategy: localStorage.getItem('syncStrategy') || 'git',
  mirrorPath: localStorage.getItem('mirrorPath'),
  vaultNotes: [],
  activeHeadings: [],
  activeBacklinks: [],
  customTheme: loadThemeFromStorage(),
  graph: {
    nodes: [],
    links: [],
    zoom: 1,
    panX: 0,
    panY: 0,
    dragNodeId: null,
    isPanning: false,
    lastX: 0,
    lastY: 0,
    pointerMoved: false,
    filter: '',
  },
  shortcuts: loadShortcuts(),
  vaultConfig: null,
  pluginManifests: [],
  unresolvedLinks: [],
  find: {
    query: '',
    matches: [],
    index: -1,
  },
  editor: null,
};

// DOM Elements
const editorEl = document.getElementById('editor')!;
const sourceEditorEl = document.getElementById('sourceEditor') as HTMLTextAreaElement;
const editorWrapper = document.getElementById('editorWrapper')!;
const editorContextMenuEl = document.getElementById('editorContextMenu')!;
const sidebarEl = document.getElementById('sidebar')!;
const fileTreeEl = document.getElementById('fileTree')!;
const fileTreeSearchEl = document.getElementById('fileTreeSearch') as HTMLInputElement;
const fileTitleEl = document.getElementById('fileTitle')!;
const gitBranchEl = document.getElementById('gitBranch')!;
const gitChangesEl = document.getElementById('gitChanges')!;
const gitFilesEl = document.getElementById('gitFiles')!;
const syncStrategySelectEl = document.getElementById('syncStrategySelect') as HTMLSelectElement;
const btnSyncTargetEl = document.getElementById('btnSyncTarget') as HTMLButtonElement;
const outlineListEl = document.getElementById('outlineList')!;
const backlinksListEl = document.getElementById('backlinksList')!;
const unresolvedLinksListEl = document.getElementById('unresolvedLinksList')!;
const tagsListEl = document.getElementById('tagsList')!;
const graphListEl = document.getElementById('graphList')!;
const metricNotesEl = document.getElementById('metricNotes')!;
const metricLinksEl = document.getElementById('metricLinks')!;
const metricTagsEl = document.getElementById('metricTags')!;
const themeAccentEl = document.getElementById('themeAccent') as HTMLInputElement;
const themeSurfaceEl = document.getElementById('themeSurface') as HTMLInputElement;
const themeTextEl = document.getElementById('themeText') as HTMLInputElement;
const themeEditorWidthEl = document.getElementById('themeEditorWidth') as HTMLInputElement;
const languageSelectEl = document.getElementById('languageSelect') as HTMLSelectElement;
const localeOverridesEl = document.getElementById('localeOverrides') as HTMLTextAreaElement;
const commandPaletteEl = document.getElementById('commandPalette')!;
const commandSearchEl = document.getElementById('commandSearch') as HTMLInputElement;
const commandListEl = document.getElementById('commandList')!;
const graphCanvasEl = document.getElementById('graphCanvas') as HTMLCanvasElement;
const graphFilterEl = document.getElementById('graphFilter') as HTMLInputElement;
const searchPaletteEl = document.getElementById('searchPalette')!;
const globalSearchInputEl = document.getElementById('globalSearchInput') as HTMLInputElement;
const globalSearchResultsEl = document.getElementById('globalSearchResults')!;
const findPanelEl = document.getElementById('findPanel')!;
const findInputEl = document.getElementById('findInput') as HTMLInputElement;
const replaceInputEl = document.getElementById('replaceInput') as HTMLInputElement;
const findCountEl = document.getElementById('findCount')!;
const btnReplaceOneEl = document.getElementById('btnReplaceOne')!;
const btnReplaceAllEl = document.getElementById('btnReplaceAll')!;
const welcomeScreenEl = document.getElementById('welcomeScreen')!;
const modalSettingsEl = document.getElementById('modalSettings') as HTMLDialogElement;
const settingsLanguageSelectEl = document.getElementById('settingsLanguageSelect') as HTMLSelectElement;
const settingsSyncStrategyEl = document.getElementById('settingsSyncStrategy') as HTMLSelectElement;
const shortcutListEl = document.getElementById('shortcutList')!;
const vaultConfigReadoutEl = document.getElementById('vaultConfigReadout')!;
const pluginListEl = document.getElementById('pluginList')!;
const diagnosticsPreviewEl = document.getElementById('diagnosticsPreview')!;
const themeLibraryEl = document.getElementById('themeLibrary')!;
const statusWordsEl = document.getElementById('statusWords')!;
const statusLinesEl = document.getElementById('statusLines')!;
const statusMessageEl = document.getElementById('statusMessage')!;
const statusModeEl = document.getElementById('statusMode')!;
const commands: AppCommand[] = [];
const pluginPanels: PluginPanel[] = [];
let fileTreeSearchTimer: number | undefined;
let fileTreeSearchToken = 0;

// Initialize Theme
document.documentElement.setAttribute('data-theme', state.theme);
applyStaticI18n();

function isNativeRuntime() {
  return typeof (window as any).__TAURI_INTERNALS__ !== 'undefined';
}

function loadShortcuts() {
  try {
    const saved = localStorage.getItem('shortcuts');
    return { ...DEFAULT_SHORTCUTS, ...(saved ? JSON.parse(saved) as Record<string, string> : {}) };
  } catch (error) {
    console.warn('Invalid shortcuts:', error);
    return { ...DEFAULT_SHORTCUTS };
  }
}

function saveShortcuts() {
  localStorage.setItem('shortcuts', JSON.stringify(state.shortcuts));
  void saveVaultConfig();
}

function eventToShortcut(event: KeyboardEvent) {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push('Mod');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (!['Control', 'Meta', 'Shift', 'Alt'].includes(key)) parts.push(key);
  return parts.join('+');
}

function shortcutMatches(event: KeyboardEvent, commandId: string) {
  return eventToShortcut(event) === state.shortcuts[commandId];
}

function defaultVaultConfig(): VaultConfig {
  return {
    version: 1,
    theme: { ...state.customTheme },
    syncStrategy: state.syncStrategy,
    mirrorPath: state.mirrorPath,
    graph: {
      panX: state.graph.panX,
      panY: state.graph.panY,
      zoom: state.graph.zoom,
      nodes: {},
    },
    enabledPlugins: [],
    shortcuts: { ...state.shortcuts },
  };
}

async function vaultConfigPath() {
  if (!state.currentFolder) return null;
  const configDir = await join(state.currentFolder, '.markdown233');
  return {
    dir: configDir,
    file: await join(configDir, 'config.json'),
  };
}

async function loadVaultConfig() {
  const paths = await vaultConfigPath();
  if (!paths) return;

  try {
    const parsed = JSON.parse(await readTextFile(paths.file)) as VaultConfig;
    state.vaultConfig = { ...defaultVaultConfig(), ...parsed };
    state.customTheme = state.vaultConfig.theme || state.customTheme;
    state.syncStrategy = state.vaultConfig.syncStrategy || state.syncStrategy;
    state.mirrorPath = state.vaultConfig.mirrorPath ?? state.mirrorPath;
    state.shortcuts = { ...DEFAULT_SHORTCUTS, ...(state.vaultConfig.shortcuts || {}) };
    state.graph.panX = state.vaultConfig.graph?.panX ?? 0;
    state.graph.panY = state.vaultConfig.graph?.panY ?? 0;
    state.graph.zoom = state.vaultConfig.graph?.zoom ?? 1;
    applyCustomTheme();
  } catch {
    state.vaultConfig = defaultVaultConfig();
    await saveVaultConfig();
  }

  renderSettings();
}

async function saveVaultConfig() {
  if (!state.currentFolder) return;
  const paths = await vaultConfigPath();
  if (!paths) return;

  const nodePositions = Object.fromEntries(state.graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  state.vaultConfig = {
    ...(state.vaultConfig || defaultVaultConfig()),
    theme: { ...state.customTheme },
    syncStrategy: state.syncStrategy,
    mirrorPath: state.mirrorPath,
    shortcuts: { ...state.shortcuts },
    graph: {
      panX: state.graph.panX,
      panY: state.graph.panY,
      zoom: state.graph.zoom,
      nodes: nodePositions,
    },
    enabledPlugins: state.pluginManifests.filter((plugin) => plugin.enabled).map((plugin) => plugin.manifest.id),
  };

  await mkdir(paths.dir, { recursive: true });
  await writeTextFile(paths.file, JSON.stringify(state.vaultConfig, null, 2));
  renderSettings();
}

function registerCommand(command: AppCommand) {
  const existing = commands.findIndex((item) => item.id === command.id);
  if (existing >= 0) {
    commands[existing] = command;
  } else {
    commands.push(command);
  }
}

function registerPanel(panel: PluginPanel) {
  const existing = pluginPanels.findIndex((item) => item.id === panel.id);
  if (existing >= 0) {
    pluginPanels[existing] = panel;
  } else {
    pluginPanels.push(panel);
  }
}

async function activatePlugin(plugin: Markdown233Plugin) {
  const api: PluginApi = {
    registerCommand,
    registerPanel,
    getVaultNotes: () => [...state.vaultNotes],
    getCurrentFile: () => state.currentFile,
    switchPanel: switchInspectorTab,
    toast: showToast,
  };

  await plugin.activate(api);
}

async function activateCorePlugins() {
  await activatePlugin({
    id: 'markdown233.core',
    name: 'Markdown233 Core',
    activate(api) {
      api.registerCommand({
        id: 'plugin.graph.open',
        title: () => t('openGraphView'),
        group: () => t('pluginGroupKnowledge'),
        run: () => api.switchPanel('graph'),
      });
      api.registerCommand({
        id: 'plugin.theme.open',
        title: () => t('openThemeStudio'),
        group: () => t('pluginGroupTheme'),
        run: () => api.switchPanel('theme'),
      });
      api.registerPanel({
        id: 'vault.stats',
        title: 'Vault Stats',
        render(container) {
          container.textContent = String(api.getVaultNotes().length);
        },
      });
    },
  });
}

async function loadPluginManifests() {
  state.pluginManifests = [];
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    if (commands[index].id.startsWith('plugin.manifest.')) {
      commands.splice(index, 1);
    }
  }
  if (!state.currentFolder) {
    renderSettings();
    return;
  }

  try {
    const pluginsDir = await join(state.currentFolder, '.markdown233', 'plugins');
    const entries = await readDir(pluginsDir);
    const enabled = new Set(state.vaultConfig?.enabledPlugins || []);
    const installs: PluginInstall[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory) continue;
      try {
        const manifestPath = await join(pluginsDir, entry.name, 'plugin.json');
        const manifest = JSON.parse(await readTextFile(manifestPath)) as PluginManifest;
        if (!manifest.id || !manifest.name) continue;
        installs.push({
          manifest,
          enabled: enabled.size ? enabled.has(manifest.id) : true,
        });
      } catch (error) {
        console.warn('Skip invalid plugin manifest:', entry.name, error);
      }
    }

    state.pluginManifests = installs;
    for (const install of installs.filter((plugin) => plugin.enabled)) {
      const manifest = install.manifest;
      for (const command of manifest.commands || []) {
        registerCommand({
          id: `plugin.manifest.${manifest.id}.${command.id}`,
          title: () => command.title,
          group: () => command.group || manifest.name,
          run: () => runManifestCommand(manifest, command.id),
        });
      }
    }
  } catch {
    state.pluginManifests = [];
  }

  renderSettings();
}

function runManifestCommand(manifest: PluginManifest, commandId: string) {
  const permissions = new Set(manifest.permissions || []);
  if (!permissions.has('commands:run') && !permissions.has('commands:*')) {
    showToast(t('pluginPermissionDenied', { name: manifest.name }), 'warning');
    return;
  }

  showToast(t('pluginCommandRegistered', { name: `${manifest.name}:${commandId}` }), 'success');
}

function initCommandRegistry() {
  registerCommand({ id: 'app.commandPalette', title: () => t('commandPalette'), group: () => t('commandGroupApp'), run: openCommandPalette });
  registerCommand({ id: 'settings.open', title: () => t('settings'), group: () => t('commandGroupApp'), run: openSettings });
  registerCommand({ id: 'diagnostics.export', title: () => t('exportDiagnostics'), group: () => t('commandGroupApp'), run: exportDiagnostics });
  registerCommand({ id: 'search.global', title: () => t('globalSearch'), group: () => t('commandGroupSearch'), run: openGlobalSearch });
  registerCommand({ id: 'search.find', title: () => t('find'), group: () => t('commandGroupSearch'), run: () => openFindPanel(false) });
  registerCommand({ id: 'search.replace', title: () => t('replace'), group: () => t('commandGroupSearch'), run: () => openFindPanel(true) });
  registerCommand({ id: 'file.new', title: () => t('newFile'), group: () => t('commandGroupFile'), run: newFile });
  registerCommand({ id: 'file.open', title: () => t('openFile'), group: () => t('commandGroupFile'), run: () => document.getElementById('btnOpenFile')?.click() });
  registerCommand({ id: 'folder.open', title: () => t('openFolder'), group: () => t('commandGroupFile'), run: openFolder });
  registerCommand({ id: 'file.save', title: () => t('save'), group: () => t('commandGroupFile'), run: saveFile });
  registerCommand({ id: 'file.saveAs', title: () => t('saveAs'), group: () => t('commandGroupFile'), run: saveFileAs });
  registerCommand({ id: 'file.attach', title: () => t('insertAttachment'), group: () => t('commandGroupFile'), run: chooseAttachment });
  registerCommand({ id: 'file.exportHtml', title: () => t('exportHtml'), group: () => t('commandGroupExport'), run: exportHtml });
  registerCommand({ id: 'file.printPdf', title: () => t('printPdf'), group: () => t('commandGroupExport'), run: printPdf });
  registerCommand({ id: 'edit.bold', title: () => t('formatBold'), group: () => t('commandGroupEdit'), run: () => runEditorAction('bold') });
  registerCommand({ id: 'edit.italic', title: () => t('formatItalic'), group: () => t('commandGroupEdit'), run: () => runEditorAction('italic') });
  registerCommand({ id: 'edit.strike', title: () => t('formatStrike'), group: () => t('commandGroupEdit'), run: () => runEditorAction('strike') });
  registerCommand({ id: 'edit.inlineCode', title: () => t('formatInlineCode'), group: () => t('commandGroupEdit'), run: () => runEditorAction('inlineCode') });
  registerCommand({ id: 'edit.heading1', title: () => t('insertHeading1'), group: () => t('commandGroupEdit'), run: () => runEditorAction('heading1') });
  registerCommand({ id: 'edit.heading2', title: () => t('insertHeading'), group: () => t('commandGroupEdit'), run: () => runEditorAction('heading2') });
  registerCommand({ id: 'edit.heading3', title: () => t('insertHeading3'), group: () => t('commandGroupEdit'), run: () => runEditorAction('heading3') });
  registerCommand({ id: 'edit.heading4', title: () => t('insertHeading4'), group: () => t('commandGroupEdit'), run: () => runEditorAction('heading4') });
  registerCommand({ id: 'edit.heading5', title: () => t('insertHeading5'), group: () => t('commandGroupEdit'), run: () => runEditorAction('heading5') });
  registerCommand({ id: 'edit.heading6', title: () => t('insertHeading6'), group: () => t('commandGroupEdit'), run: () => runEditorAction('heading6') });
  registerCommand({ id: 'edit.quote', title: () => t('insertQuote'), group: () => t('commandGroupEdit'), run: () => runEditorAction('quote') });
  registerCommand({ id: 'edit.bulletList', title: () => t('insertBulletList'), group: () => t('commandGroupEdit'), run: () => runEditorAction('bulletList') });
  registerCommand({ id: 'edit.orderedList', title: () => t('insertOrderedList'), group: () => t('commandGroupEdit'), run: () => runEditorAction('orderedList') });
  registerCommand({ id: 'edit.taskList', title: () => t('insertTaskList'), group: () => t('commandGroupEdit'), run: () => runEditorAction('taskList') });
  registerCommand({ id: 'edit.link', title: () => t('insertLink'), group: () => t('commandGroupEdit'), run: () => runEditorAction('link') });
  registerCommand({ id: 'edit.image', title: () => t('insertImage'), group: () => t('commandGroupEdit'), run: () => runEditorAction('image') });
  registerCommand({ id: 'edit.table', title: () => t('insertTable'), group: () => t('commandGroupEdit'), run: () => runEditorAction('table') });
  registerCommand({ id: 'edit.tableRow', title: () => t('tableAddRow'), group: () => t('commandGroupEdit'), run: () => runEditorAction('tableRow') });
  registerCommand({ id: 'edit.tableColumn', title: () => t('tableAddColumn'), group: () => t('commandGroupEdit'), run: () => runEditorAction('tableColumn') });
  registerCommand({ id: 'edit.codeBlock', title: () => t('insertCodeBlock'), group: () => t('commandGroupEdit'), run: () => runEditorAction('codeBlock') });
  registerCommand({ id: 'edit.mathBlock', title: () => t('insertMathBlock'), group: () => t('commandGroupEdit'), run: () => runEditorAction('mathBlock') });
  registerCommand({ id: 'edit.footnote', title: () => t('insertFootnote'), group: () => t('commandGroupEdit'), run: () => runEditorAction('footnote') });
  registerCommand({ id: 'edit.horizontalRule', title: () => t('insertHorizontalRule'), group: () => t('commandGroupEdit'), run: () => runEditorAction('horizontalRule') });
  registerCommand({ id: 'edit.toc', title: () => t('insertToc'), group: () => t('commandGroupEdit'), run: () => runEditorAction('toc') });
  registerCommand({ id: 'edit.frontmatter', title: () => t('insertFrontmatter'), group: () => t('commandGroupEdit'), run: () => runEditorAction('frontmatter') });
  registerCommand({ id: 'view.source', title: () => t('sourceMode'), group: () => t('commandGroupView'), run: toggleSourceMode });
  registerCommand({ id: 'view.sidebar', title: () => t('toggleSidebar'), group: () => t('commandGroupView'), run: () => { sidebarEl.classList.toggle('collapsed'); } });
  registerCommand({ id: 'view.inspector', title: () => t('toggleInspector'), group: () => t('commandGroupView'), run: () => { document.getElementById('inspector')?.classList.toggle('collapsed'); } });
  registerCommand({ id: 'view.overview', title: () => t('overview'), group: () => t('commandGroupView'), run: () => switchInspectorTab('insight') });
  registerCommand({ id: 'view.outline', title: () => t('outline'), group: () => t('commandGroupView'), run: () => switchInspectorTab('outline') });
  registerCommand({ id: 'view.links', title: () => t('backlinks'), group: () => t('commandGroupView'), run: () => switchInspectorTab('backlinks') });
  registerCommand({ id: 'view.graph', title: () => t('graphView'), group: () => t('commandGroupView'), run: () => switchInspectorTab('graph') });
  registerCommand({ id: 'theme.toggle', title: () => t('toggleTheme'), group: () => t('commandGroupTheme'), run: toggleTheme });
  registerCommand({ id: 'theme.studio', title: () => t('themeStudio'), group: () => t('commandGroupTheme'), run: () => switchInspectorTab('theme') });
  registerCommand({ id: 'theme.import', title: () => t('importThemePackage'), group: () => t('commandGroupTheme'), run: importThemePackage });
  registerCommand({ id: 'theme.export', title: () => t('exportThemePackage'), group: () => t('commandGroupTheme'), run: exportThemePackage });
  registerCommand({ id: 'sync.run', title: () => t('sync'), group: () => t('commandGroupSync'), run: () => runCloudSync() });
  registerCommand({ id: 'sync.pull', title: () => t('pull'), group: () => t('commandGroupSync'), run: handleGitPull });
  registerCommand({ id: 'sync.push', title: () => t('push'), group: () => t('commandGroupSync'), run: handleGitPush });
  registerCommand({ id: 'app.update', title: () => t('checkUpdates'), group: () => t('commandGroupApp'), run: checkForUpdates });
}

function openCommandPalette() {
  commandPaletteEl.classList.remove('hidden');
  commandSearchEl.value = '';
  renderCommandPalette();
  requestAnimationFrame(() => commandSearchEl.focus());
}

function closeCommandPalette() {
  commandPaletteEl.classList.add('hidden');
}

function renderCommandPalette(query = '') {
  const normalized = query.trim().toLowerCase();
  const filtered = commands
    .filter((command) => {
      const haystack = `${command.title()} ${command.group()} ${command.id}`.toLowerCase();
      return !normalized || haystack.includes(normalized);
    })
    .sort((a, b) => a.group().localeCompare(b.group()) || a.title().localeCompare(b.title()));

  commandListEl.innerHTML = '';

  if (!filtered.length) {
    commandListEl.innerHTML = `<div class="command-empty">${t('noCommand')}</div>`;
    return;
  }

  filtered.slice(0, 24).forEach((command, index) => {
    const shortcut = state.shortcuts[command.id] || command.shortcut;
    const item = document.createElement('button');
    item.className = `command-item ${index === 0 ? 'active' : ''}`;
    item.type = 'button';
    item.innerHTML = `
      <span><strong>${escapeHtml(command.title())}</strong><small>${escapeHtml(command.group())}</small></span>
      ${shortcut ? `<kbd>${escapeHtml(shortcut)}</kbd>` : ''}
    `;
    item.addEventListener('click', () => runCommand(command));
    commandListEl.appendChild(item);
  });
}

async function runCommand(command: AppCommand) {
  closeCommandPalette();
  await command.run();
}

function openSettings() {
  renderSettings();
  modalSettingsEl.showModal();
}

function renderSettings() {
  settingsLanguageSelectEl.innerHTML = languageSelectEl.innerHTML;
  settingsLanguageSelectEl.value = currentLanguageSetting();
  settingsSyncStrategyEl.innerHTML = syncStrategySelectEl.innerHTML;
  settingsSyncStrategyEl.value = state.syncStrategy;

  shortcutListEl.innerHTML = commands
    .filter((command) => !command.id.startsWith('plugin.manifest.'))
    .map((command) => {
      const shortcut = state.shortcuts[command.id] || '';
      const conflict = shortcut && commands.some((other) => other.id !== command.id && state.shortcuts[other.id] === shortcut);
      return `
      <label class="shortcut-row">
        <span><strong>${escapeHtml(command.title())}</strong><small>${escapeHtml(conflict ? t('shortcutConflict') : command.id)}</small></span>
        <input class="${conflict ? 'shortcut-conflict' : ''}" data-shortcut-command="${escapeHtml(command.id)}" value="${escapeHtml(shortcut)}" placeholder="Mod+K">
      </label>
    `;
    })
    .join('');

  vaultConfigReadoutEl.innerHTML = state.currentFolder
    ? `<pre>${escapeHtml(JSON.stringify(state.vaultConfig || defaultVaultConfig(), null, 2))}</pre>`
    : `<p>${t('openFolderFirst')}</p>`;

  pluginListEl.innerHTML = state.pluginManifests.length
    ? state.pluginManifests.map((install) => {
      const plugin = install.manifest;
      return `
      <div class="plugin-card">
        <label class="plugin-toggle"><input type="checkbox" data-plugin-toggle="${escapeHtml(plugin.id)}" ${install.enabled ? 'checked' : ''}> <strong>${escapeHtml(plugin.name)}</strong></label>
        <small>${escapeHtml(plugin.id)} ${escapeHtml(plugin.version || '')}</small>
        <small>${escapeHtml((plugin.permissions || []).join(', ') || t('noPermissions'))}</small>
        <p>${escapeHtml(plugin.description || '')}</p>
      </div>
    `;
    }).join('')
    : `<div class="plugin-card"><strong>${t('noPlugins')}</strong><small>.markdown233/plugins/*/plugin.json</small></div>`;

  pluginListEl.querySelectorAll<HTMLInputElement>('[data-plugin-toggle]').forEach((input) => {
    input.addEventListener('change', async () => {
      const id = input.dataset.pluginToggle || '';
      const install = state.pluginManifests.find((plugin) => plugin.manifest.id === id);
      if (!install) return;
      install.enabled = input.checked;
      await saveVaultConfig();
      await loadPluginManifests();
    });
  });

  diagnosticsPreviewEl.innerHTML = `<pre>${escapeHtml(JSON.stringify(createDiagnostics(), null, 2))}</pre>`;
  renderThemeLibrary();
}

function renderThemeLibrary() {
  const presets: ThemePackage[] = [
    { name: 'Apple Glass', version: '1.0.0', variables: { accent: '#5b6cff', surface: '#fbfcff', text: '#1d1d26', editorWidth: 860 } },
    { name: 'Graphite', version: '1.0.0', variables: { accent: '#25c8a8', surface: '#f6f7f9', text: '#20232a', editorWidth: 920 } },
    { name: 'Ink Dark', version: '1.0.0', variables: { accent: '#7c91ff', surface: '#11131a', text: '#f2f4ff', editorWidth: 880 } },
  ];

  themeLibraryEl.innerHTML = presets.map((preset, index) =>
    `<button class="theme-preset" data-theme-preset="${index}">${escapeHtml(preset.name)}</button>`
  ).join('');

  themeLibraryEl.querySelectorAll<HTMLButtonElement>('.theme-preset').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = presets[Number(button.dataset.themePreset || 0)];
      state.customTheme = { ...preset.variables };
      applyCustomTheme();
      void saveVaultConfig();
      showToast(t('themePackageImported', { name: preset.name }), 'success');
    });
  });
}

function openGlobalSearch() {
  searchPaletteEl.classList.remove('hidden');
  globalSearchInputEl.value = '';
  renderGlobalSearch();
  requestAnimationFrame(() => globalSearchInputEl.focus());
}

function closeGlobalSearch() {
  searchPaletteEl.classList.add('hidden');
}

function openFindPanel(showReplace = false) {
  findPanelEl.classList.remove('hidden');
  replaceInputEl.classList.toggle('hidden', !showReplace);
  btnReplaceOneEl.classList.toggle('hidden', !showReplace);
  btnReplaceAllEl.classList.toggle('hidden', !showReplace);
  requestAnimationFrame(() => {
    findInputEl.focus();
    findInputEl.select();
    updateFindMatches();
  });
}

function closeFindPanel() {
  findPanelEl.classList.add('hidden');
  clearEditorFindSelection();
}

function updateFindMatches(resetIndex = true) {
  const query = findInputEl.value;
  state.find.query = query;
  state.find.matches = [];

  if (query) {
    const lowerContent = state.content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    let index = lowerContent.indexOf(lowerQuery);
    while (index >= 0) {
      state.find.matches.push(index);
      index = lowerContent.indexOf(lowerQuery, index + Math.max(lowerQuery.length, 1));
    }
  }

  if (resetIndex) {
    state.find.index = state.find.matches.length ? 0 : -1;
  } else if (state.find.index >= state.find.matches.length) {
    state.find.index = state.find.matches.length - 1;
  }

  updateFindCount();
  revealFindMatch();
}

function updateFindCount() {
  const total = state.find.matches.length;
  findCountEl.textContent = total ? `${state.find.index + 1} / ${total}` : '0 / 0';
}

function moveFind(delta: number) {
  if (!state.find.matches.length) return;
  state.find.index = (state.find.index + delta + state.find.matches.length) % state.find.matches.length;
  updateFindCount();
  revealFindMatch();
}

function revealFindMatch() {
  const query = state.find.query;
  const index = state.find.matches[state.find.index];
  if (!query || index === undefined) return;

  if (state.isSourceMode) {
    sourceEditorEl.focus();
    sourceEditorEl.selectionStart = index;
    sourceEditorEl.selectionEnd = index + query.length;
    const line = state.content.slice(0, index).split(/\r?\n/).length;
    const lineHeight = parseFloat(getComputedStyle(sourceEditorEl).lineHeight) || 24;
    sourceEditorEl.scrollTop = Math.max(0, (line - 3) * lineHeight);
    return;
  }

  selectTextInRenderedEditor(query, state.find.index);
}

function selectTextInRenderedEditor(query: string, occurrence: number) {
  const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
  let seen = 0;
  let node = walker.nextNode() as Text | null;
  while (node) {
    const text = node.textContent || '';
    let offset = text.toLowerCase().indexOf(query.toLowerCase());
    while (offset >= 0) {
      if (seen === occurrence) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + query.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        (range.startContainer.parentElement || editorEl).scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      seen += 1;
      offset = text.toLowerCase().indexOf(query.toLowerCase(), offset + query.length);
    }
    node = walker.nextNode() as Text | null;
  }
}

function clearEditorFindSelection() {
  if (!state.isSourceMode) {
    window.getSelection()?.removeAllRanges();
  }
}

async function replaceCurrentMatch() {
  if (!state.find.matches.length || state.find.index < 0) return;
  const index = state.find.matches[state.find.index];
  const query = state.find.query;
  const replacement = replaceInputEl.value;
  state.content = `${state.content.slice(0, index)}${replacement}${state.content.slice(index + query.length)}`;
  await syncEditorContentAfterReplace();
  updateFindMatches(false);
}

async function replaceAllMatches() {
  if (!findInputEl.value) return;
  const escaped = findInputEl.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  state.content = state.content.replace(new RegExp(escaped, 'gi'), replaceInputEl.value);
  await syncEditorContentAfterReplace();
  updateFindMatches();
}

async function syncEditorContentAfterReplace() {
  state.modified = true;
  if (state.isSourceMode) {
    sourceEditorEl.value = state.content;
  } else {
    await reloadEditor(state.content);
  }
  updateStatusBar();
  updateKnowledgeState();
}

function renderGlobalSearch() {
  const query = globalSearchInputEl.value.trim().toLowerCase();
  const notes = [...state.vaultNotes];
  if (state.currentFile && state.content) {
    notes.push(parseNote(state.currentFile, state.content));
  }

  const results = notes
    .filter((note) => {
      if (!query) return true;
      const haystack = `${note.title} ${note.tags.join(' ')} ${note.aliases.join(' ')} ${note.links.join(' ')} ${note.body}`.toLowerCase();
      return haystack.includes(query);
    })
    .slice(0, 40);

  globalSearchResultsEl.innerHTML = results.length
    ? results.map((note) => `
      <button class="search-result" data-search-path="${escapeHtml(note.path)}">
        <strong>${escapeHtml(note.title)}</strong>
        <small>${escapeHtml(note.tags.map((tag) => `#${tag}`).join(' ') || note.path)}</small>
        <p>${escapeHtml(searchSnippet(note, query))}</p>
      </button>
    `).join('')
    : `<div class="command-empty">${t('noSearchResult')}</div>`;

  globalSearchResultsEl.querySelectorAll<HTMLButtonElement>('.search-result').forEach((button) => {
    button.addEventListener('click', async () => {
      closeGlobalSearch();
      await openFile(button.dataset.searchPath || '');
    });
  });
}

function searchSnippet(note: VaultNote, query: string) {
  if (!query) return note.preview || note.headings.slice(0, 3).map((heading) => heading.text).join(' / ');
  const body = note.body.replace(/\s+/g, ' ');
  const index = body.toLowerCase().indexOf(query);
  if (index < 0) return note.preview;
  return body.slice(Math.max(0, index - 48), Math.min(body.length, index + query.length + 96));
}

function createDiagnostics() {
  return {
    app: 'Markdown233',
    version: '0.2.0',
    platform: navigator.platform,
    language: currentLanguageSetting(),
    native: isNativeRuntime(),
    folder: state.currentFolder,
    file: state.currentFile,
    notes: state.vaultNotes.length,
    plugins: state.pluginManifests.map((plugin) => ({ id: plugin.manifest.id, enabled: plugin.enabled })),
    syncStrategy: state.syncStrategy,
    theme: state.customTheme,
    shortcuts: state.shortcuts,
  };
}

async function exportDiagnostics() {
  const filePath = await save({
    filters: [{ name: 'Markdown233 Diagnostics', extensions: ['json'] }],
    defaultPath: 'markdown233-diagnostics.json',
  });
  if (!filePath) return;
  await writeTextFile(filePath as string, JSON.stringify(createDiagnostics(), null, 2));
  showToast(t('diagnosticsExported'), 'success');
}

async function saveAttachment(file: File) {
  if (!state.currentFolder) {
    showToast(t('openFolderFirst'), 'warning');
    return;
  }

  const assetsDir = await join(state.currentFolder, 'assets');
  await mkdir(assetsDir, { recursive: true });
  const safeName = `${Date.now()}-${file.name.replace(/[^\w.-]+/g, '-')}`;
  const targetPath = await join(assetsDir, safeName);
  await writeFile(targetPath, new Uint8Array(await file.arrayBuffer()));
  insertMarkdown(`![${file.name}](assets/${safeName})`);
  await saveVaultConfig();
  showToast(t('attachmentSaved'), 'success');
}

async function chooseAttachment() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file) await saveAttachment(file);
  };
  input.click();
}

function insertMarkdown(markdown: string) {
  if (state.isSourceMode) {
    const start = sourceEditorEl.selectionStart;
    const end = sourceEditorEl.selectionEnd;
    sourceEditorEl.value = `${sourceEditorEl.value.slice(0, start)}${markdown}${sourceEditorEl.value.slice(end)}`;
    sourceEditorEl.selectionStart = sourceEditorEl.selectionEnd = start + markdown.length;
    state.content = sourceEditorEl.value;
  } else {
    state.content = `${state.content}\n\n${markdown}\n`;
    void reloadEditor(state.content);
  }
  state.modified = true;
  updateStatusBar();
  updateKnowledgeState();
}

type EditorAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'inlineCode'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'quote'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'link'
  | 'image'
  | 'table'
  | 'tableRow'
  | 'tableColumn'
  | 'mathBlock'
  | 'footnote'
  | 'horizontalRule'
  | 'toc'
  | 'frontmatter'
  | 'codeBlock';

function selectedEditorText() {
  if (state.isSourceMode) {
    return sourceEditorEl.value.slice(sourceEditorEl.selectionStart, sourceEditorEl.selectionEnd);
  }

  const selection = window.getSelection();
  const text = selection?.toString() || '';
  return editorEl.contains(selection?.anchorNode || null) ? text : '';
}

function replaceSourceSelection(value: string, cursorOffset = value.length) {
  const start = sourceEditorEl.selectionStart;
  const end = sourceEditorEl.selectionEnd;
  sourceEditorEl.value = `${sourceEditorEl.value.slice(0, start)}${value}${sourceEditorEl.value.slice(end)}`;
  sourceEditorEl.selectionStart = sourceEditorEl.selectionEnd = start + cursorOffset;
  state.content = sourceEditorEl.value;
}

async function applyEditorInsertion(value: string, selectedText = '') {
  if (state.isSourceMode) {
    replaceSourceSelection(value);
  } else if (selectedText && state.content.includes(selectedText)) {
    state.content = state.content.replace(selectedText, value);
    await reloadEditor(state.content);
  } else {
    state.content = `${state.content.trimEnd()}\n\n${value}\n`;
    await reloadEditor(state.content);
  }

  state.modified = true;
  updateStatusBar();
  updateKnowledgeState();
}

async function runEditorAction(action: EditorAction) {
  hideEditorContextMenu();
  welcomeScreenEl.classList.add('hidden');

  if (action === 'tableRow' || action === 'tableColumn') {
    await mutateFirstMarkdownTable(action);
    return;
  }

  const selection = selectedEditorText();
  const fallback = t('selectedTextPlaceholder');
  const text = selection || fallback;

  const snippets: Record<EditorAction, string> = {
    bold: `**${text}**`,
    italic: `*${text}*`,
    strike: `~~${text}~~`,
    inlineCode: `\`${selection || 'code'}\``,
    heading1: `# ${selection || t('headingPlaceholder')}`,
    heading2: `## ${selection || t('headingPlaceholder')}`,
    heading3: `### ${selection || t('headingPlaceholder')}`,
    heading4: `#### ${selection || t('headingPlaceholder')}`,
    heading5: `##### ${selection || t('headingPlaceholder')}`,
    heading6: `###### ${selection || t('headingPlaceholder')}`,
    quote: `> ${selection || t('quotePlaceholder')}`,
    bulletList: `- ${selection || t('listItemPlaceholder')}`,
    orderedList: `1. ${selection || t('listItemPlaceholder')}`,
    taskList: `- [ ] ${selection || t('listItemPlaceholder')}`,
    link: `[${selection || t('linkTextPlaceholder')}](https://)`,
    image: `![${selection || t('imageAltPlaceholder')}](./image.png)`,
    table: `| ${t('tableColumn')} 1 | ${t('tableColumn')} 2 | ${t('tableColumn')} 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |`,
    tableRow: '',
    tableColumn: '',
    codeBlock: `\`\`\`\n${selection || ''}\n\`\`\``,
    mathBlock: `$$\n${selection || 'E = mc^2'}\n$$`,
    footnote: `${selection || t('footnoteTextPlaceholder')}[^1]\n\n[^1]: ${t('footnotePlaceholder')}`,
    horizontalRule: '---',
    toc: '[TOC]',
    frontmatter: `---\ntitle: "${selection || noteTitleFromPath(state.currentFile || t('untitled'))}"\ntags: []\n---`,
  };

  await applyEditorInsertion(snippets[action], selection);
}

async function mutateFirstMarkdownTable(action: 'tableRow' | 'tableColumn') {
  const table = findFirstMarkdownTable(state.content);
  if (!table) {
    await runEditorAction('table');
    return;
  }

  const lines = state.content.split(/\r?\n/);
  const tableLines = lines.slice(table.start, table.end + 1);
  const columnCount = splitTableRow(tableLines[0]).length;

  if (action === 'tableRow') {
    tableLines.push(tableRow(Array(columnCount).fill('')));
  } else {
    for (let i = 0; i < tableLines.length; i += 1) {
      const cells = splitTableRow(tableLines[i]);
      cells.push(i === 1 ? '---' : '');
      tableLines[i] = tableRow(cells);
    }
  }

  lines.splice(table.start, table.end - table.start + 1, ...tableLines);
  state.content = lines.join('\n');
  if (state.isSourceMode) {
    sourceEditorEl.value = state.content;
  } else {
    await reloadEditor(state.content);
  }
  state.modified = true;
  updateStatusBar();
  updateKnowledgeState();
}

function findFirstMarkdownTable(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (isTableRow(lines[i]) && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      let end = i + 1;
      while (end + 1 < lines.length && isTableRow(lines[end + 1])) end += 1;
      return { start: i, end };
    }
  }
  return null;
}

function isTableRow(line: string) {
  return line.includes('|') && !/^\s*$/.test(line);
}

function splitTableRow(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function tableRow(cells: string[]) {
  return `| ${cells.join(' | ')} |`;
}

function showEditorContextMenu(x: number, y: number) {
  editorContextMenuEl.classList.remove('hidden');
  const rect = editorContextMenuEl.getBoundingClientRect();
  const left = Math.min(x, window.innerWidth - rect.width - 10);
  const top = Math.min(y, window.innerHeight - rect.height - 10);
  editorContextMenuEl.style.left = `${Math.max(10, left)}px`;
  editorContextMenuEl.style.top = `${Math.max(10, top)}px`;
}

function hideEditorContextMenu() {
  editorContextMenuEl.classList.add('hidden');
}

// Initialize Milkdown Editor
async function initEditor() {
  state.editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, editorEl);
      ctx.set(defaultValueCtx, t('welcomeDoc'));
      ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
        if (!state.isSourceMode) {
          state.content = markdown;
          state.modified = true;
          updateStatusBar();
          updateKnowledgeState();
        }
      });
    })
    .config(nord)
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use(indent)
    .use(listener)
    .create();

  // Set up source editor sync
  sourceEditorEl.addEventListener('input', () => {
    if (state.isSourceMode) {
      state.content = sourceEditorEl.value;
      state.modified = true;
      updateStatusBar();
      updateKnowledgeState();
    }
  });

  sourceEditorEl.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = sourceEditorEl.selectionStart;
      const end = sourceEditorEl.selectionEnd;
      sourceEditorEl.value = sourceEditorEl.value.substring(0, start) + '    ' + sourceEditorEl.value.substring(end);
      sourceEditorEl.selectionStart = sourceEditorEl.selectionEnd = start + 4;
      state.content = sourceEditorEl.value;
      updateKnowledgeState();
    }
  });
}

// Toggle Source Mode
function toggleSourceMode() {
  state.isSourceMode = !state.isSourceMode;

    if (state.isSourceMode) {
      editorWrapper.classList.add('hidden');
    sourceEditorEl.classList.remove('hidden');
    sourceEditorEl.value = state.content;
    statusModeEl.textContent = t('sourceMode');
  } else {
    editorWrapper.classList.remove('hidden');
    sourceEditorEl.classList.add('hidden');
    // Update Milkdown editor with source content
    if (state.editor) {
      state.editor.action(() => {
        // The editor will update via listener
      });
    }
    statusModeEl.textContent = t('editMode');
  }
}

// File Tree Operations
async function buildFileTree(dirPath: string): Promise<FileNode[]> {
  try {
    const entries = await readDir(dirPath);
    const nodes: FileNode[] = [];

    for (const entry of entries) {
      if (shouldSkipFileTreeEntry(entry.name)) {
        continue;
      }

      const fullPath = await join(dirPath, entry.name);
      const isDir = entry.isDirectory;

      if (!isDir && !isSupportedTreeFile(entry.name)) {
        continue;
      }

      const node: FileNode = {
        path: fullPath,
        name: entry.name,
        isDirectory: isDir,
        expanded: state.expandedDirs.has(fullPath),
      };

      if (isDir && node.expanded) {
        node.children = await buildFileTree(fullPath);
      }

      nodes.push(node);
    }

    return sortFileNodes(nodes);
  } catch (error) {
    console.error('Error building file tree:', error);
    return [];
  }
}

async function searchFileTree(dirPath: string, query: string, token: number): Promise<FileNode[]> {
  if (token !== fileTreeSearchToken) return [];

  try {
    const entries = await readDir(dirPath);
    const nodes: FileNode[] = [];
    let scanned = 0;

    for (const entry of entries) {
      if (token !== fileTreeSearchToken) return [];
      if (shouldSkipFileTreeEntry(entry.name)) continue;

      scanned += 1;
      if (scanned % 24 === 0) {
        await yieldToUi();
      }

      const fullPath = await join(dirPath, entry.name);
      const isDir = entry.isDirectory;
      if (!isDir && !isSupportedTreeFile(entry.name)) continue;

      const childMatches = isDir ? await searchFileTree(fullPath, query, token) : [];
      const selfMatches = entry.name.toLowerCase().includes(query);

      if (!selfMatches && childMatches.length === 0) continue;

      nodes.push({
        path: fullPath,
        name: entry.name,
        isDirectory: isDir,
        expanded: isDir,
        children: isDir ? childMatches : undefined,
      });
    }

    return sortFileNodes(nodes);
  } catch (error) {
    console.warn('File tree search skipped:', error);
    return [];
  }
}

function shouldSkipFileTreeEntry(name: string) {
  return name.startsWith('.') || name === 'node_modules' || name === 'target' || name === 'dist';
}

function isSupportedTreeFile(name: string) {
  return /\.(md|markdown|txt)$/i.test(name);
}

function sortFileNodes(nodes: FileNode[]) {
  return nodes.sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });
}

function yieldToUi() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function renderFileTree(nodes: FileNode[], container: HTMLElement, level: number = 0) {
  container.innerHTML = '';

  for (const node of nodes) {
    const item = document.createElement('div');
    item.className = `tree-item ${node.isDirectory ? 'directory' : 'file-node'} ${state.activeFilePath === node.path ? 'active' : ''}`;
    item.style.paddingLeft = `${12 + level * 16}px`;

    if (node.isDirectory) {
      const toggle = document.createElement('span');
      toggle.className = `tree-toggle ${node.expanded ? 'expanded' : ''}`;
      toggle.innerHTML = '▶';
      item.appendChild(toggle);

      const icon = document.createElement('span');
      icon.className = `icon ${node.expanded ? 'folder-open' : 'folder'}`;
      item.appendChild(icon);

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = node.name;
      item.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'file-ext folder-ext';
      meta.textContent = t('folderType');
      item.appendChild(meta);

      item.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (state.expandedDirs.has(node.path)) {
          state.expandedDirs.delete(node.path);
          node.expanded = false;
        } else {
          state.expandedDirs.add(node.path);
          node.expanded = true;
        }
        state.fileTree = await buildFileTree(state.currentFolder!);
        if (state.fileTreeSearch.trim()) {
          scheduleFileTreeSearch();
        } else {
          renderCurrentFileTree();
        }
      });

      container.appendChild(item);

      if (node.expanded && node.children) {
        const childContainer = document.createElement('div');
        childContainer.className = 'tree-children';
        renderFileTree(node.children, childContainer, level + 1);
        container.appendChild(childContainer);
      }
    } else {
      const icon = document.createElement('span');
      icon.className = `icon file ${fileIconClass(node.name)}`;
      item.appendChild(icon);

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = node.name;
      item.appendChild(name);

      const meta = document.createElement('span');
      meta.className = 'file-ext';
      meta.textContent = fileTypeLabel(node.name);
      item.appendChild(meta);

      item.addEventListener('click', async () => {
        await openFile(node.path);
      });

      container.appendChild(item);
    }
  }
}

function renderCurrentFileTree() {
  const hasSearch = Boolean(state.fileTreeSearch.trim());
  const nodes = hasSearch ? state.fileTreeSearchResults : state.fileTree;

  if (hasSearch && state.fileTreeSearching && nodes.length === 0) {
    fileTreeEl.innerHTML = `<div class="empty-state compact"><p>${t('searchInProgress')}</p></div>`;
    return;
  }

  if (hasSearch && nodes.length === 0) {
    fileTreeEl.innerHTML = `<div class="empty-state compact"><p>${t('noFileMatch')}</p></div>`;
    return;
  }

  renderFileTree(nodes, fileTreeEl);
}

function scheduleFileTreeSearch() {
  window.clearTimeout(fileTreeSearchTimer);
  const query = state.fileTreeSearch.trim().toLowerCase();
  fileTreeSearchToken += 1;

  if (!query || !state.currentFolder) {
    state.fileTreeSearching = false;
    state.fileTreeSearchResults = [];
    renderCurrentFileTree();
    return;
  }

  const token = fileTreeSearchToken;
  state.fileTreeSearching = true;
  state.fileTreeSearchResults = [];
  renderCurrentFileTree();

  fileTreeSearchTimer = window.setTimeout(async () => {
    const results = await searchFileTree(state.currentFolder!, query, token);
    if (token !== fileTreeSearchToken) return;

    state.fileTreeSearchResults = results;
    state.fileTreeSearching = false;
    renderCurrentFileTree();
  }, 120);
}

function fileIconClass(name: string) {
  if (/\.(md|markdown)$/i.test(name)) return 'markdown';
  if (/\.txt$/i.test(name)) return 'text';
  return 'plain';
}

function fileTypeLabel(name: string) {
  if (/\.(md|markdown)$/i.test(name)) return t('markdownType');
  if (/\.txt$/i.test(name)) return t('textType');
  return t('fileType');
}

// File Operations
async function openFile(filePath: string) {
  try {
    const content = await readTextFile(filePath);
    state.currentFile = filePath;
    state.activeFilePath = filePath;
    state.content = content;
    state.modified = false;
    updateKnowledgeState();

    // Update UI
    fileTitleEl.textContent = filePath.split(/[\\/]/).pop() || t('untitled');

    // Update editor
    if (state.isSourceMode) {
      sourceEditorEl.value = content;
    } else if (state.editor) {
      // Reload editor with new content
      state.editor.destroy();
      state.editor = await Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, editorEl);
          ctx.set(defaultValueCtx, content);
          ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
            if (!state.isSourceMode) {
              state.content = markdown;
              state.modified = true;
              updateStatusBar();
              updateKnowledgeState();
            }
          });
        })
        .config(nord)
        .use(commonmark)
        .use(gfm)
        .use(history)
        .use(clipboard)
        .use(indent)
        .use(listener)
        .create();
    }

    // Update file tree active state
    renderCurrentFileTree();
    updateStatusBar();
    updateKnowledgeState();
    updateGitStatus();

    document.title = `Markdown233 - ${filePath.split(/[\\/]/).pop()}`;
  } catch (error) {
    console.error('Error opening file:', error);
    showToast(t('openFileFailed'), 'error');
  }
}

async function saveFile() {
  if (!state.currentFile) {
    await saveFileAs();
    return;
  }

  try {
    await writeTextFile(state.currentFile, state.content);
    state.modified = false;
    updateStatusBar();
    updateKnowledgeState();
    showToast(t('saveSuccess'), 'success');
    updateGitStatus();
  } catch (error) {
    console.error('Error saving file:', error);
    showToast(t('saveFailed'), 'error');
  }
}

async function saveFileAs() {
  const filePath = await save({
    filters: [{
      name: 'Markdown',
      extensions: ['md', 'markdown']
    }],
    defaultPath: state.currentFile || 'untitled.md'
  });

  if (filePath) {
    try {
      await writeTextFile(filePath, state.content);
      state.currentFile = filePath;
      state.activeFilePath = filePath;
      state.modified = false;

      fileTitleEl.textContent = filePath.split(/[\\/]/).pop() || t('untitled');
      updateStatusBar();
      updateKnowledgeState();
      showToast(t('saveSuccess'), 'success');

      // Refresh file tree if in a folder
      if (state.currentFolder) {
        state.fileTree = await buildFileTree(state.currentFolder);
        renderCurrentFileTree();
      }
    } catch (error) {
      console.error('Error saving file:', error);
      showToast(t('saveFailed'), 'error');
    }
  }
}

async function createLinkedNote(title: string) {
  if (!state.currentFolder || !title.trim()) {
    showToast(t('openFolderFirst'), 'warning');
    return;
  }

  const safeName = title.trim().replace(/[<>:"/\\|?*\x00-\x1f]+/g, '-').replace(/\s+/g, ' ').slice(0, 80);
  const filePath = await join(state.currentFolder, `${safeName}.md`);
  const now = new Date().toISOString();
  const content = `---\ntitle: "${title.replace(/"/g, '\\"')}"\ncreated: "${now}"\nupdated: "${now}"\naliases: ["${title.replace(/"/g, '\\"')}"]\ntags: []\n---\n\n# ${title}\n`;

  try {
    await writeTextFile(filePath, content);
    state.fileTree = await buildFileTree(state.currentFolder);
    renderCurrentFileTree();
    await indexVault();
    await openFile(filePath);
    showToast(t('linkedNoteCreated'), 'success');
  } catch (error) {
    console.error('Create linked note failed:', error);
    showToast(t('operationFailed', { error: String(error) }), 'error');
  }
}

async function newFile() {
  if (state.modified) {
    const confirmed = await ask(t('unsavedContinue'), { title: t('appTitle'), kind: 'warning' });
    if (!confirmed) return;
  }

  state.currentFile = null;
  state.activeFilePath = null;
  state.content = '';
  state.modified = false;

  fileTitleEl.textContent = t('untitled');
  document.title = `${t('appTitle')} - ${t('untitled')}`;

  if (state.isSourceMode) {
    sourceEditorEl.value = '';
  } else if (state.editor) {
    state.editor.destroy();
    state.editor = await Editor.make()
      .config((ctx) => {
        ctx.set(rootCtx, editorEl);
        ctx.set(defaultValueCtx, '');
        ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
          if (!state.isSourceMode) {
            state.content = markdown;
            state.modified = true;
            updateStatusBar();
          }
        });
      })
      .config(nord)
      .use(commonmark)
      .use(gfm)
      .use(history)
      .use(clipboard)
      .use(indent)
      .use(listener)
      .create();
  }

  updateStatusBar();
  updateKnowledgeState();
}

async function openFolder() {
  const folderPath = await open({
    directory: true,
    multiple: false,
  });

  if (folderPath) {
    state.currentFolder = folderPath as string;
    state.fileTreeSearch = '';
    state.fileTreeSearchResults = [];
    state.fileTreeSearching = false;
    fileTreeSearchEl.value = '';
    welcomeScreenEl.classList.add('hidden');
    await loadVaultConfig();
    state.fileTree = await buildFileTree(state.currentFolder);
    renderCurrentFileTree();
    await indexVault();
    await loadPluginManifests();

    // Show sidebar
    sidebarEl.classList.remove('collapsed');

    // Update Git status
    await updateGitStatus();

    showToast(t('openedFolder', { path: folderPath as string }), 'success');
  }
}

// Git Operations
async function updateGitStatus() {
  if (!state.currentFolder) return;
  if (!isNativeRuntime()) return;

  try {
    // Check if it's a git repo
    const isRepo = await invoke<boolean>('git_is_repo', { path: state.currentFolder });

    if (isRepo) {
      // Get current branch
      state.gitBranch = await invoke<string>('git_current_branch', { repoPath: state.currentFolder });
      gitBranchEl.textContent = state.gitBranch;

      // Get file statuses
      state.gitStatuses = await invoke<GitStatus[]>('git_status', { repoPath: state.currentFolder });

      // Update UI
      const changedFiles = state.gitStatuses.length;
      gitChangesEl.textContent = changedFiles > 0 ? `${changedFiles}` : '';
      renderGitFiles();
    } else {
      gitBranchEl.textContent = t('gitNotInit');
      gitChangesEl.textContent = '';
      gitFilesEl.innerHTML = `<div class="empty-state"><p>${t('notGitRepo')}</p><button class="btn-open-folder" onclick="initGitRepo()">${t('initGit')}</button></div>`;
    }
  } catch (error) {
    console.error('Error updating git status:', error);
    gitBranchEl.textContent = t('error');
  }
}

function renderGitFiles() {
  gitFilesEl.innerHTML = '';

  if (state.gitStatuses.length === 0) {
    gitFilesEl.innerHTML = `<div class="empty-state"><p>${t('noChanges')}</p></div>`;
    return;
  }

  for (const file of state.gitStatuses) {
    const fileEl = document.createElement('div');
    fileEl.className = 'git-file';

    const pathEl = document.createElement('span');
    pathEl.className = 'file-path';
    pathEl.textContent = file.file;

    const statusEl = document.createElement('span');
    statusEl.className = 'file-status';

    if (file.status.includes('conflicted')) {
      statusEl.className += ' status-conflicted';
      statusEl.textContent = t('conflicted');
    } else if (file.status.includes('new') || file.status.includes('untracked')) {
      statusEl.className += ' status-new';
      statusEl.textContent = t('new');
    } else if (file.status.includes('modified')) {
      statusEl.className += ' status-modified';
      statusEl.textContent = t('modified');
    } else if (file.status.includes('deleted')) {
      statusEl.className += ' status-deleted';
      statusEl.textContent = t('deleted');
    } else {
      statusEl.textContent = file.status;
    }

    fileEl.appendChild(pathEl);
    fileEl.appendChild(statusEl);
    gitFilesEl.appendChild(fileEl);
  }
}

async function initGitRepo() {
  if (!state.currentFolder) {
    showToast(t('openFolderFirst'), 'warning');
    return;
  }

  try {
    if (!isNativeRuntime()) {
      showToast(t('nativeOnlyGitInit'), 'warning');
      return;
    }
    await invoke('git_init', { path: state.currentFolder });
    showToast(t('gitInitSuccess'), 'success');
    await updateGitStatus();
  } catch (error) {
    console.error('Error initializing git:', error);
    showToast(t('gitInitFailed'), 'error');
  }
}

// Make initGitRepo available globally for HTML onclick
(window as any).initGitRepo = initGitRepo;

function loadThemeFromStorage(): CustomTheme {
  try {
    const saved = localStorage.getItem('customTheme');
    if (saved) return JSON.parse(saved) as CustomTheme;
  } catch (error) {
    console.warn('Invalid custom theme:', error);
  }

  return {
    accent: '#5b6cff',
    surface: '#fbfcff',
    text: '#1d1d26',
    editorWidth: 860,
  };
}

function applyCustomTheme() {
  document.documentElement.style.setProperty('--color-primary', state.customTheme.accent);
  document.documentElement.style.setProperty('--bg-primary', state.customTheme.surface);
  document.documentElement.style.setProperty('--text-primary', state.customTheme.text);
  document.documentElement.style.setProperty('--editor-max-width', `${state.customTheme.editorWidth}px`);
  localStorage.setItem('customTheme', JSON.stringify(state.customTheme));

  themeAccentEl.value = state.customTheme.accent;
  themeSurfaceEl.value = state.customTheme.surface;
  themeTextEl.value = state.customTheme.text;
  themeEditorWidthEl.value = String(state.customTheme.editorWidth);
}

function themePackageFromState(): ThemePackage {
  return {
    name: 'Markdown233 Theme',
    version: '1.0.0',
    variables: { ...state.customTheme },
  };
}

function normalizeThemePackage(raw: unknown): ThemePackage {
  const candidate = raw as Partial<ThemePackage>;
  if (!candidate || typeof candidate !== 'object' || !candidate.variables) {
    throw new Error('Invalid theme package');
  }

  return {
    name: String(candidate.name || 'Imported Theme'),
    version: String(candidate.version || '1.0.0'),
    variables: {
      accent: candidate.variables.accent || '#5b6cff',
      surface: candidate.variables.surface || '#fbfcff',
      text: candidate.variables.text || '#1d1d26',
      editorWidth: Number(candidate.variables.editorWidth || 860),
    },
    localeOverrides: candidate.localeOverrides,
  };
}

async function exportThemePackage() {
  const themePackage = themePackageFromState();
  const content = JSON.stringify(themePackage, null, 2);
  const filePath = await save({
    filters: [{ name: 'Markdown233 Theme', extensions: ['json'] }],
    defaultPath: 'markdown233-theme.json',
  });

  if (!filePath) return;

  await writeTextFile(filePath as string, content);
  showToast(t('themePackageExported'), 'success');
}

async function importThemePackage() {
  const filePath = await open({
    multiple: false,
    filters: [{ name: 'Markdown233 Theme', extensions: ['json'] }],
  });

  if (!filePath) return;

  try {
    const themePackage = normalizeThemePackage(JSON.parse(await readTextFile(filePath as string)));
    state.customTheme = themePackage.variables;
    applyCustomTheme();
    await saveVaultConfig();

    if (themePackage.localeOverrides) {
      saveUserLocaleOverrides(JSON.stringify(themePackage.localeOverrides, null, 2));
      refreshLocalizedUi();
    }

    showToast(t('themePackageImported', { name: themePackage.name }), 'success');
  } catch (error) {
    console.error('Theme package import failed:', error);
    showToast(t('themePackageInvalid'), 'error');
  }
}

function initLanguageSettings() {
  languageSelectEl.innerHTML = '';

  const systemOption = document.createElement('option');
  systemOption.value = 'system';
  systemOption.textContent = t('systemLanguage');
  languageSelectEl.appendChild(systemOption);

  for (const locale of localeOptions) {
    const option = document.createElement('option');
    option.value = locale.id;
    option.textContent = locale.label;
    languageSelectEl.appendChild(option);
  }

  languageSelectEl.value = currentLanguageSetting();
  localeOverridesEl.value = loadUserLocaleOverrides();
  localeOverridesEl.placeholder = exportBuiltinLocale();
}

function refreshLocalizedUi() {
  applyStaticI18n();
  initLanguageSettings();
  updateStatusBar();
  updateSyncStrategyUi();
  updateKnowledgeState();
  renderSettings();
  if (!state.currentFile) {
    fileTitleEl.textContent = t('fileNotOpen');
  }
}

function resetCustomTheme() {
  state.customTheme = {
    accent: '#5b6cff',
    surface: '#fbfcff',
    text: '#1d1d26',
    editorWidth: 860,
  };
  applyCustomTheme();
  void saveVaultConfig();
  showToast(t('themeReset'), 'success');
}

function noteTitleFromPath(path: string) {
  return (path.split(/[\\/]/).pop() || path).replace(/\.(md|markdown|txt)$/i, '');
}

function parseFrontmatter(content: string) {
  const frontmatter: Record<string, string | string[]> = {};
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return frontmatter;

  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const key = pair[1];
    const value = pair[2].trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key] = value.slice(1, -1).split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      frontmatter[key] = value.replace(/^["']|["']$/g, '');
    }
  }

  return frontmatter;
}

function arrayValue(value: string | string[] | undefined) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function slugifyHeading(value: string) {
  return value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

function parseWikiLink(raw: string): LinkInfo {
  const [targetWithAnchor, label] = raw.split('|').map((part) => part.trim());
  const blockParts = targetWithAnchor.split('^');
  const headingParts = blockParts[0].split('#');
  return {
    raw,
    target: headingParts[0].trim(),
    heading: headingParts[1]?.trim(),
    block: blockParts[1]?.trim(),
    label,
  };
}

function parseNote(path: string, content: string): VaultNote {
  const headings: HeadingInfo[] = [];
  const links = new Set<string>();
  const linkInfos: LinkInfo[] = [];
  const tags = new Set<string>();
  const blocks: BlockInfo[] = [];
  const frontmatter = parseFrontmatter(content);

  content.split(/\r?\n/).forEach((line, index) => {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const text = heading[2].trim();
      headings.push({
        level: heading[1].length,
        text,
        slug: slugifyHeading(text),
        line: index + 1,
      });
    }

    for (const match of line.matchAll(/\[\[([^\]]+)\]\]/g)) {
      const link = parseWikiLink(match[1]);
      if (link.target) {
        links.add(link.target);
        linkInfos.push(link);
      }
    }

    for (const match of line.matchAll(/(^|\s)#([\p{L}\p{N}_/-]+)/gu)) {
      tags.add(match[2]);
    }

    const block = /\s\^([\p{L}\p{N}_-]+)\s*$/u.exec(` ${line}`);
    if (block) {
      blocks.push({
        id: block[1],
        line: index + 1,
        preview: line.replace(/\s\^[\p{L}\p{N}_-]+\s*$/u, '').trim().slice(0, 120),
      });
    }
  });

  arrayValue(frontmatter.tags).forEach((tag) => tags.add(tag.replace(/^#/, '')));
  const aliases = arrayValue(frontmatter.aliases).sort();

  return {
    path,
    title: noteTitleFromPath(path),
    links: [...links].sort(),
    linkInfos,
    tags: [...tags].sort(),
    aliases,
    frontmatter,
    headings,
    blocks,
    preview: content.replace(/^---[\s\S]*?---/, '').replace(/\s+/g, ' ').trim().slice(0, 220),
    body: content,
  };
}

async function collectMarkdownFiles(dirPath: string, limit = 600): Promise<string[]> {
  const entries = await readDir(dirPath);
  const files: string[] = [];

  for (const entry of entries) {
    if (files.length >= limit) break;
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'target' || entry.name === 'dist') {
      continue;
    }

    const fullPath = await join(dirPath, entry.name);
    if (entry.isDirectory) {
      files.push(...await collectMarkdownFiles(fullPath, limit - files.length));
      continue;
    }

    if (/\.(md|markdown|txt)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function indexVault() {
  if (!state.currentFolder) return;

  try {
    const files = await collectMarkdownFiles(state.currentFolder);
    const notes: VaultNote[] = [];

    for (const file of files) {
      try {
        notes.push(parseNote(file, await readTextFile(file)));
      } catch (error) {
        console.warn('Skip unreadable note:', file, error);
      }
    }

    state.vaultNotes = notes;
    updateKnowledgeState();
  } catch (error) {
    console.error('Error indexing vault:', error);
    showToast(t('vaultIndexFailed'), 'error');
  }
}

function updateKnowledgeState() {
  const currentTitle = state.currentFile ? noteTitleFromPath(state.currentFile) : t('untitled');
  const activeNote = parseNote(state.currentFile || currentTitle, state.content);
  const titleAliases = new Set([currentTitle, activeNote.title, ...activeNote.aliases]);
  const knownTitles = new Set<string>();
  for (const note of [...state.vaultNotes, activeNote]) {
    knownTitles.add(note.title);
    note.aliases.forEach((alias) => knownTitles.add(alias));
  }

  state.activeHeadings = activeNote.headings;
  state.activeBacklinks = state.vaultNotes.filter((note) =>
    note.path !== state.currentFile && note.linkInfos.some((link) => {
      const targetMatches = titleAliases.has(link.target) || activeNote.aliases.includes(link.target);
      const headingMatches = !link.heading || activeNote.headings.some((heading) =>
        heading.text === link.heading || heading.slug === slugifyHeading(link.heading || '')
      );
      const blockMatches = !link.block || activeNote.blocks.some((block) => block.id === link.block);
      return targetMatches && headingMatches && blockMatches;
    })
  );
  state.unresolvedLinks = [...new Set(activeNote.links.filter((link) => !knownTitles.has(link)))].sort();

  renderKnowledgePanel(activeNote);
}

function renderKnowledgePanel(activeNote: VaultNote) {
  const allTags = new Set<string>();
  let linkCount = 0;
  for (const note of state.vaultNotes) {
    note.tags.forEach((tag) => allTags.add(tag));
    linkCount += note.links.length;
  }

  activeNote.tags.forEach((tag) => allTags.add(tag));
  linkCount += activeNote.links.length;

  metricNotesEl.textContent = String(state.vaultNotes.length);
  metricLinksEl.textContent = String(linkCount);
  metricTagsEl.textContent = String(allTags.size);

  outlineListEl.innerHTML = state.activeHeadings.length
    ? state.activeHeadings.map((heading, index) =>
        `<button class="outline-item" data-heading-index="${index}" style="padding-left:${8 + (heading.level - 1) * 12}px">${escapeHtml(heading.text)}</button>`
      ).join('')
    : `<div class="outline-item">${t('noHeading')}</div>`;
  outlineListEl.querySelectorAll<HTMLButtonElement>('[data-heading-index]').forEach((button) => {
    button.addEventListener('click', () => scrollToHeading(Number(button.dataset.headingIndex || 0)));
  });

  backlinksListEl.innerHTML = state.activeBacklinks.length
    ? state.activeBacklinks.map((note) => `<button class="backlink-item" data-open-note="${escapeHtml(note.path)}">${escapeHtml(note.title)}</button>`).join('')
    : `<div class="backlink-item">${t('noBacklink')}</div>`;
  backlinksListEl.querySelectorAll<HTMLButtonElement>('[data-open-note]').forEach((button) => {
    button.addEventListener('click', () => openFile(button.dataset.openNote || ''));
  });

  unresolvedLinksListEl.innerHTML = state.unresolvedLinks.length
    ? state.unresolvedLinks.map((link) => `<button class="backlink-item unresolved-link" data-create-note="${escapeHtml(link)}">${escapeHtml(link)}</button>`).join('')
    : `<div class="backlink-item">${t('noUnresolvedLinks')}</div>`;
  unresolvedLinksListEl.querySelectorAll<HTMLButtonElement>('.unresolved-link').forEach((button) => {
    button.addEventListener('click', () => createLinkedNote(button.dataset.createNote || ''));
  });

  const tagValues = [...allTags].slice(0, 36);
  tagsListEl.innerHTML = tagValues.length
    ? tagValues.map((tag) => `<button class="tag-chip" data-graph-filter="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('')
    : '<span class="tag-chip">no-tags</span>';
  tagsListEl.querySelectorAll<HTMLButtonElement>('[data-graph-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      switchInspectorTab('graph');
      graphFilterEl.value = button.dataset.graphFilter || '';
      state.graph.filter = graphFilterEl.value;
      updateGraphData(activeNote);
      drawGraph();
    });
  });

  const graphRows = [activeNote, ...state.activeBacklinks].slice(0, 8);
  graphListEl.innerHTML = graphRows.length
    ? graphRows.map((note) =>
        `<button class="graph-item" data-open-note="${escapeHtml(note.path)}">${escapeHtml(note.title)} <span>${note.links.length} links</span></button>`
      ).join('')
    : `<div class="graph-item">${t('graphAfterFolder')}</div>`;
  graphListEl.querySelectorAll<HTMLButtonElement>('[data-open-note]').forEach((button) => {
    button.addEventListener('click', () => openFile(button.dataset.openNote || ''));
  });

  updateGraphData(activeNote);
  drawGraph();
}

function scrollToHeading(index: number) {
  const heading = state.activeHeadings[index];
  if (!heading) return;

  if (state.isSourceMode) {
    const lines = sourceEditorEl.value.split(/\r?\n/);
    const position = lines.slice(0, Math.max(heading.line - 1, 0)).join('\n').length + (heading.line > 1 ? 1 : 0);
    sourceEditorEl.focus();
    sourceEditorEl.selectionStart = sourceEditorEl.selectionEnd = position;
    const lineHeight = parseFloat(getComputedStyle(sourceEditorEl).lineHeight) || 24;
    sourceEditorEl.scrollTop = Math.max(0, (heading.line - 2) * lineHeight);
    return;
  }

  const headings = [...editorEl.querySelectorAll('h1,h2,h3,h4,h5,h6')] as HTMLElement[];
  const target = headings.find((element) => slugifyHeading(element.textContent || '') === heading.slug) || headings[index];
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateGraphData(activeNote: VaultNote) {
  const notes = [...state.vaultNotes];
  if (!notes.some((note) => note.path === activeNote.path)) {
    notes.push(activeNote);
  }

  const query = state.graph.filter.trim().toLowerCase();
  const filtered = notes.filter((note) => {
    if (!query) return true;
    return note.title.toLowerCase().includes(query) || note.tags.some((tag) => tag.toLowerCase().includes(query));
  }).slice(0, 80);

  const titleToId = new Map<string, string>();
  filtered.forEach((note) => {
    titleToId.set(note.title, note.path);
    note.aliases.forEach((alias) => titleToId.set(alias, note.path));
  });
  const previous = new Map(state.graph.nodes.map((node) => [node.id, node]));
  const savedPositions = state.vaultConfig?.graph?.nodes || {};
  const centerX = graphCanvasEl.width / 2;
  const centerY = graphCanvasEl.height / 2;

  state.graph.nodes = filtered.map((note, index) => {
    const existing = previous.get(note.path);
    if (existing) {
      existing.tags = note.tags;
      return existing;
    }
    const saved = savedPositions[note.path];
    if (saved) {
      return {
        id: note.path,
        title: note.title,
        x: saved.x,
        y: saved.y,
        radius: note.path === state.currentFile ? 18 : 12,
        tags: note.tags,
      };
    }

    const angle = (index / Math.max(filtered.length, 1)) * Math.PI * 2;
    const radius = 80 + Math.min(filtered.length, 36) * 4;
    return {
      id: note.path,
      title: note.title,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
      radius: note.path === state.currentFile ? 18 : 12,
      tags: note.tags,
    };
  });

  state.graph.links = filtered.flatMap((note) =>
    note.links
      .map((link) => titleToId.get(link))
      .filter((target): target is string => Boolean(target))
      .map((target) => ({ source: note.path, target }))
  );
}

function drawGraph() {
  if (!graphCanvasEl) return;

  const context = graphCanvasEl.getContext('2d');
  if (!context) return;

  const { width, height } = graphCanvasEl;
  context.clearRect(0, 0, width, height);
  context.save();
  context.translate(state.graph.panX, state.graph.panY);
  context.scale(state.graph.zoom, state.graph.zoom);

  const nodeById = new Map(state.graph.nodes.map((node) => [node.id, node]));
  context.lineWidth = 1.4 / state.graph.zoom;
  context.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border-color').trim() || 'rgba(83,91,122,.24)';
  for (const link of state.graph.links) {
    const source = nodeById.get(link.source);
    const target = nodeById.get(link.target);
    if (!source || !target) continue;
    context.beginPath();
    context.moveTo(source.x, source.y);
    context.lineTo(target.x, target.y);
    context.stroke();
  }

  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue('--color-primary').trim() || '#5b6cff';
  const text = styles.getPropertyValue('--text-primary').trim() || '#1d1d26';
  const surface = styles.getPropertyValue('--glass-strong').trim() || 'rgba(255,255,255,.78)';

  for (const node of state.graph.nodes) {
    context.beginPath();
    context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    context.fillStyle = node.id === state.currentFile ? accent : surface;
    context.fill();
    context.strokeStyle = node.id === state.currentFile ? accent : 'rgba(120,130,160,.32)';
    context.stroke();

    context.fillStyle = node.id === state.currentFile ? '#fff' : text;
    context.font = `${12 / state.graph.zoom}px -apple-system, BlinkMacSystemFont, sans-serif`;
    context.textAlign = 'center';
    context.fillText(node.title.slice(0, 18), node.x, node.y + node.radius + 14 / state.graph.zoom);
  }

  if (!state.graph.nodes.length) {
    context.fillStyle = text;
    context.font = '14px -apple-system, BlinkMacSystemFont, sans-serif';
    context.textAlign = 'center';
    context.fillText(t('graphAfterFolder'), width / 2, height / 2);
  }

  context.restore();
}

function graphPointFromEvent(event: MouseEvent) {
  const rect = graphCanvasEl.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - state.graph.panX) / state.graph.zoom,
    y: (event.clientY - rect.top - state.graph.panY) / state.graph.zoom,
    screenX: event.clientX - rect.left,
    screenY: event.clientY - rect.top,
  };
}

function hitGraphNode(x: number, y: number) {
  return [...state.graph.nodes].reverse().find((node) => {
    const distance = Math.hypot(node.x - x, node.y - y);
    return distance <= node.radius + 8;
  });
}

function resetGraphView() {
  state.graph.zoom = 1;
  state.graph.panX = 0;
  state.graph.panY = 0;
  state.graph.filter = '';
  graphFilterEl.value = '';
  updateKnowledgeState();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markdownToHtml(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  let inCode = false;
  const html: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const line = rawLine.replace(/\t/g, '    ');
    if (line.startsWith('```')) {
      inCode = !inCode;
      html.push(inCode ? '<pre><code>' : '</code></pre>');
      continue;
    }

    if (inCode) {
      html.push(escapeHtml(line));
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
    } else if (isTableRow(line) && lines[i + 1] && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[i + 1])) {
      const headers = splitTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      i -= 1;
      html.push(`<table><thead><tr>${headers.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    } else if (/^[-*]\s+\[[ xX]\]\s+/.test(line)) {
      const checked = /^[-*]\s+\[[xX]\]/.test(line);
      html.push(`<p><input type="checkbox" disabled ${checked ? 'checked' : ''}> ${inlineMarkdown(line.replace(/^[-*]\s+\[[ xX]\]\s+/, ''))}</p>`);
    } else if (/^[-*]\s+/.test(line)) {
      html.push(`<p>• ${inlineMarkdown(line.replace(/^[-*]\s+/, ''))}</p>`);
    } else if (/^\d+\.\s+/.test(line)) {
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    } else if (/^---+$/.test(line.trim())) {
      html.push('<hr>');
    } else if (/^\[TOC\]$/i.test(line.trim())) {
      const headings = parseNote(state.currentFile || 'export', markdown).headings;
      html.push(`<nav class="toc">${headings.map((heading) => `<a style="padding-left:${(heading.level - 1) * 14}px" href="#${escapeHtml(heading.slug)}">${escapeHtml(heading.text)}</a>`).join('')}</nav>`);
    } else if (line.trim() === '') {
      html.push('');
    } else {
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }
  }

  return html.join('\n');
}

function inlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g, (_, target, label) =>
      `<a href="#${encodeURIComponent(target)}">${escapeHtml(label || target)}</a>`
    )
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

async function exportHtml() {
  const title = state.currentFile ? noteTitleFromPath(state.currentFile) : 'untitled';
  const filePath = await save({
    filters: [{ name: 'HTML', extensions: ['html'] }],
    defaultPath: `${title}.html`,
  });

  if (!filePath) return;

  const documentHtml = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;background:${state.customTheme.surface};color:${state.customTheme.text};font:16px/1.78 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:${state.customTheme.editorWidth}px;margin:56px auto;padding:0 32px}
a{color:${state.customTheme.accent}} pre{padding:18px;border-radius:16px;background:rgba(0,0,0,.06);overflow:auto} code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
table{width:100%;border-collapse:collapse;margin:1.2em 0}th,td{border:1px solid rgba(120,130,160,.28);padding:10px 12px;text-align:left}th{background:rgba(120,130,160,.08)}img{max-width:100%;height:auto}.toc{display:grid;gap:6px;margin:1em 0 2em}hr{border:0;border-top:1px solid rgba(120,130,160,.28);margin:2em 0}
</style>
</head>
<body><main>${markdownToHtml(state.content)}</main></body>
</html>`;

  await writeTextFile(filePath as string, documentHtml);
  showToast(t('htmlExported'), 'success');
}

function printPdf() {
  showToast(t('printHint'), 'success');
  window.print();
}

async function checkForUpdates(options: { silent?: boolean } = {}) {
  if (!isNativeRuntime()) {
    if (!options.silent) showToast(t('nativeOnlyUpdate'), 'warning');
    return;
  }

  try {
    const update = await check();
    if (!update) {
      if (!options.silent) showToast(t('alreadyLatest'), 'success');
      return;
    }

    const shouldInstall = await ask(t('updateAvailable', { version: update.version }), {
      title: t('appTitle'),
      kind: 'info',
    });

    if (!shouldInstall) return;

    await update.downloadAndInstall();
    await relaunch();
  } catch (error) {
    console.error('Update check failed:', error);
    if (!options.silent) showToast(t('updateCheckFailed', { error: String(error) }), 'error');
  }
}

function scheduleAutoUpdateCheck() {
  if (localStorage.getItem('autoUpdateCheck') === 'off') return;
  window.setTimeout(() => {
    void checkForUpdates({ silent: true });
  }, 2500);
}

async function loadSyncStrategies() {
  try {
    state.syncStrategies = isNativeRuntime()
      ? await invoke<SyncStrategy[]>('sync_strategies')
      : [
          {
            id: 'git',
            name: 'Git',
            description: 'Default native Git sync.',
            is_default: true,
            needs_target: false,
          },
          {
            id: 'mirror',
            name: 'Local mirror',
            description: 'Local cloud-drive mirror.',
            is_default: false,
            needs_target: true,
          },
        ];
    syncStrategySelectEl.innerHTML = '';

    for (const strategy of state.syncStrategies) {
      const option = document.createElement('option');
      option.value = strategy.id;
      option.textContent = strategy.name;
      option.title = strategy.description;
      syncStrategySelectEl.appendChild(option);
    }

    const hasSavedStrategy = state.syncStrategies.some((strategy) => strategy.id === state.syncStrategy);
    if (!hasSavedStrategy) {
      state.syncStrategy = state.syncStrategies.find((strategy) => strategy.is_default)?.id || 'git';
    }

    syncStrategySelectEl.value = state.syncStrategy;
    updateSyncStrategyUi();
    renderSettings();
  } catch (error) {
    console.error('Error loading sync strategies:', error);
    showToast(t('syncStrategiesFailed'), 'error');
  }
}

function updateSyncStrategyUi() {
  const strategy = state.syncStrategies.find((item) => item.id === state.syncStrategy);
  btnSyncTargetEl.classList.toggle('hidden', !strategy?.needs_target);
  btnSyncTargetEl.textContent = state.mirrorPath ? t('selected') : t('directory');
  btnSyncTargetEl.title = state.mirrorPath || t('chooseMirror');
}

async function chooseMirrorTarget() {
  const folderPath = await open({
    directory: true,
    multiple: false,
    title: t('chooseCloudMirror'),
  });

  if (!folderPath) return;

  state.mirrorPath = folderPath as string;
  localStorage.setItem('mirrorPath', state.mirrorPath);
  updateSyncStrategyUi();
  await saveVaultConfig();
  showToast(t('syncTargetSet'), 'success');
}

async function runCloudSync(message?: string) {
  if (!state.currentFolder) {
    showToast(t('openFolderFirst'), 'warning');
    return;
  }

  const strategy = state.syncStrategies.find((item) => item.id === state.syncStrategy);
  if (strategy?.needs_target && !state.mirrorPath) {
    await chooseMirrorTarget();
    if (!state.mirrorPath) return;
  }

  try {
    if (!isNativeRuntime()) {
      showToast(t('nativeOnlySync'), 'warning');
      return;
    }

    if (state.modified && state.currentFile) {
      await saveFile();
    }

    const result = await invoke<SyncResult>('sync_run', {
      repoPath: state.currentFolder,
      strategyId: state.syncStrategy,
      message: message ?? null,
      mirrorPath: state.mirrorPath ?? null,
      remote: null,
      branch: state.gitBranch ?? null,
    });

    showToast(result.message, result.ok ? 'success' : 'warning');

    if (state.syncStrategy === 'git') {
      await updateGitStatus();
    }
  } catch (error) {
    console.error('Error syncing:', error);
    showToast(t('syncFailed', { error: String(error) }), 'error');
  }
}

async function handleGitCommit() {
  if (!state.currentFolder) {
    showToast(t('openFolderFirst'), 'warning');
    return;
  }

  if (state.syncStrategy !== 'git') {
    await runCloudSync();
    return;
  }

  // Show commit dialog
  const modal = document.getElementById('modalGitCommit') as HTMLDialogElement;
  const messageInput = document.getElementById('commitMessage') as HTMLTextAreaElement;
  messageInput.value = '';
  modal.showModal();
}

async function executeCommit() {
  const messageInput = document.getElementById('commitMessage') as HTMLTextAreaElement;
  const commitMessage = messageInput.value.trim();

  if (!commitMessage) {
    showToast(t('commitRequired'), 'warning');
    return;
  }

  const modal = document.getElementById('modalGitCommit') as HTMLDialogElement;
  modal.close();

  try {
    await runCloudSync(commitMessage);
  } catch (error) {
    console.error('Error committing:', error);
    showToast(t('syncFailed', { error: String(error) }), 'error');
  }
}

async function handleGitPush() {
  if (!state.currentFolder) return;
  if (state.syncStrategy !== 'git') {
    await runCloudSync();
    return;
  }

  try {
    // Get remotes
    const remotes = await invoke<{ name: string; url: string }[]>('git_remote', { repoPath: state.currentFolder });

    if (remotes.length === 0) {
      showToast(t('noRemote'), 'warning');
      return;
    }

    const remote = remotes[0].name;
    const branch = state.gitBranch || 'main';

    await invoke('git_push', { repoPath: state.currentFolder, remote, branch });
    showToast(t('pushSuccess'), 'success');
  } catch (error) {
    console.error('Error pushing:', error);
    showToast(t('pushFailed', { error: String(error) }), 'error');
  }
}

async function handleGitPull() {
  if (!state.currentFolder) {
    showToast(t('openFolderFirst'), 'warning');
    return;
  }
  if (state.syncStrategy !== 'git') {
    await runCloudSync();
    return;
  }

  try {
    // Save current file first
    if (state.modified && state.currentFile) {
      await saveFile();
    }

    // Get remotes
    const remotes = await invoke<{ name: string; url: string }[]>('git_remote', { repoPath: state.currentFolder });

    if (remotes.length === 0) {
      showToast(t('noRemote'), 'warning');
      return;
    }

    const remote = remotes[0].name;
    const branch = state.gitBranch || 'main';

    // Pull
    const result = await invoke<ConflictInfo>('git_pull', { repoPath: state.currentFolder, remote, branch });

    if (result.has_conflict) {
      // Show conflict dialog
      showConflictDialog(result);
    } else {
      showToast(result.message, 'success');
      await updateGitStatus();

      // Reload current file if it exists
      if (state.currentFile) {
        const content = await readTextFile(state.currentFile);
        state.content = content;
        state.modified = false;

        if (state.isSourceMode) {
          sourceEditorEl.value = content;
        } else {
          // Reload editor
          await reloadEditor(content);
        }
      }
    }
  } catch (error) {
    console.error('Error pulling:', error);
    showToast(t('pullFailed', { error: String(error) }), 'error');
  }
}

function showConflictDialog(conflict: ConflictInfo) {
  const modal = document.getElementById('modalConflict') as HTMLDialogElement;
  const messageEl = document.getElementById('conflictMessage')!;
  const filesEl = document.getElementById('conflictFiles')!;

  messageEl.textContent = conflict.message;
  filesEl.innerHTML = '';

  for (const file of conflict.conflicted_files) {
    const fileEl = document.createElement('div');
    fileEl.className = 'conflict-file';
    fileEl.textContent = file;
    filesEl.appendChild(fileEl);
  }

  modal.showModal();
}

async function handleForcePull() {
  const modal = document.getElementById('modalConflict') as HTMLDialogElement;
  modal.close();

  try {
    const remotes = await invoke<{ name: string; url: string }[]>('git_remote', { repoPath: state.currentFolder! });
    const remote = remotes[0].name;
    const branch = state.gitBranch || 'main';

    await invoke('git_force_pull', { repoPath: state.currentFolder!, remote, branch });
    showToast(t('forcePullSuccess'), 'success');

    // Reload current file
    if (state.currentFile) {
      const content = await readTextFile(state.currentFile);
      state.content = content;
      state.modified = false;

      if (state.isSourceMode) {
        sourceEditorEl.value = content;
      } else {
        await reloadEditor(content);
      }
    }

    await updateGitStatus();
  } catch (error) {
    console.error('Error force pulling:', error);
    showToast(t('operationFailed', { error: String(error) }), 'error');
  }
}

async function reloadEditor(content: string) {
  if (state.editor) {
    state.editor.destroy();
  }

  state.editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, editorEl);
      ctx.set(defaultValueCtx, content);
      ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
        if (!state.isSourceMode) {
        state.content = markdown;
        state.modified = true;
        updateStatusBar();
        updateKnowledgeState();
      }
    });
    })
    .config(nord)
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use(indent)
    .use(listener)
    .create();
}

// UI Helpers
function updateStatusBar() {
  const text = state.content;
  const words = text.trim() ? text.trim().length : 0;
  statusWordsEl.textContent = t('words', { count: words });

  // Update cursor position (simplified)
  statusLinesEl.textContent = t('lineColumn');
}

function showToast(message: string, type: 'success' | 'error' | 'warning' = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);

  statusMessageEl.textContent = message;
  setTimeout(() => {
    statusMessageEl.textContent = '';
  }, 3000);
}

function toggleTheme() {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', state.theme);
  localStorage.setItem('theme', state.theme);
  showToast(t('themeSwitched', { theme: t(state.theme === 'light' ? 'light' : 'dark') }), 'success');
}

// Event Listeners
document.getElementById('btnToggleSidebar')?.addEventListener('click', () => {
  sidebarEl.classList.toggle('collapsed');
});

document.getElementById('btnWindowMinimize')?.addEventListener('click', () => {
  if (isNativeRuntime()) void getCurrentWindow().minimize();
});

document.getElementById('btnWindowMaximize')?.addEventListener('click', async () => {
  if (!isNativeRuntime()) return;
  const currentWindow = getCurrentWindow();
  if (await currentWindow.isMaximized()) {
    await currentWindow.unmaximize();
  } else {
    await currentWindow.maximize();
  }
});

document.getElementById('btnWindowClose')?.addEventListener('click', () => {
  if (isNativeRuntime()) void getCurrentWindow().close();
});

document.getElementById('btnNew')?.addEventListener('click', newFile);
document.getElementById('btnOpenFile')?.addEventListener('click', async () => {
  const filePath = await open({
    multiple: false,
    filters: [{
      name: 'Markdown',
      extensions: ['md', 'markdown', 'txt']
    }]
  });

  if (filePath) {
    await openFile(filePath as string);
  }
});

document.getElementById('btnOpenFolder')?.addEventListener('click', openFolder);
document.getElementById('btnOpenFolderSidebar')?.addEventListener('click', openFolder);
document.getElementById('btnSave')?.addEventListener('click', saveFile);
document.getElementById('btnSaveAs')?.addEventListener('click', saveFileAs);
document.getElementById('btnExportHtml')?.addEventListener('click', exportHtml);
document.getElementById('btnPrintPdf')?.addEventListener('click', printPdf);
document.getElementById('btnViewSource')?.addEventListener('click', toggleSourceMode);
document.getElementById('btnTheme')?.addEventListener('click', toggleTheme);
document.getElementById('btnThemeStudio')?.addEventListener('click', () => switchInspectorTab('theme'));
document.getElementById('btnSettings')?.addEventListener('click', openSettings);
document.getElementById('btnToggleInspector')?.addEventListener('click', () => {
  document.getElementById('inspector')?.classList.toggle('collapsed');
});
document.getElementById('btnRefreshTree')?.addEventListener('click', async () => {
  if (state.currentFolder) {
    state.fileTree = await buildFileTree(state.currentFolder);
    renderCurrentFileTree();
    await indexVault();
    showToast(t('refreshed'), 'success');
  }
});

document.querySelectorAll<HTMLButtonElement>('[data-sidebar-mode]').forEach((button) => {
  button.addEventListener('click', () => {
    const mode = button.dataset.sidebarMode || 'files';
    document.querySelectorAll<HTMLButtonElement>('[data-sidebar-mode]').forEach((item) => {
      item.classList.toggle('active', item.dataset.sidebarMode === mode);
    });
    document.querySelectorAll<HTMLElement>('[data-sidebar-pane]').forEach((pane) => {
      pane.classList.toggle('active', pane.dataset.sidebarPane === mode);
    });
  });
});

fileTreeSearchEl.addEventListener('input', () => {
  state.fileTreeSearch = fileTreeSearchEl.value;
  scheduleFileTreeSearch();
});

document.querySelectorAll<HTMLButtonElement>('.inspector-tab').forEach((button) => {
  button.addEventListener('click', () => switchInspectorTab(button.dataset.inspectorTab || 'insight'));
});

themeAccentEl.addEventListener('input', () => {
  state.customTheme.accent = themeAccentEl.value;
  applyCustomTheme();
  void saveVaultConfig();
});

themeSurfaceEl.addEventListener('input', () => {
  state.customTheme.surface = themeSurfaceEl.value;
  applyCustomTheme();
  void saveVaultConfig();
});

themeTextEl.addEventListener('input', () => {
  state.customTheme.text = themeTextEl.value;
  applyCustomTheme();
  void saveVaultConfig();
});

themeEditorWidthEl.addEventListener('input', () => {
  state.customTheme.editorWidth = Number(themeEditorWidthEl.value);
  applyCustomTheme();
  void saveVaultConfig();
});

document.getElementById('btnResetTheme')?.addEventListener('click', resetCustomTheme);
document.getElementById('btnImportThemePackage')?.addEventListener('click', importThemePackage);
document.getElementById('btnExportThemePackage')?.addEventListener('click', exportThemePackage);
document.getElementById('welcomeOpenFolder')?.addEventListener('click', openFolder);
document.getElementById('welcomeNewFile')?.addEventListener('click', () => {
  welcomeScreenEl.classList.add('hidden');
  void newFile();
});

document.getElementById('btnCommandPalette')?.addEventListener('click', openCommandPalette);
commandPaletteEl.addEventListener('click', (event) => {
  if (event.target === commandPaletteEl) closeCommandPalette();
});
commandSearchEl.addEventListener('input', () => renderCommandPalette(commandSearchEl.value));
commandSearchEl.addEventListener('keydown', async (event) => {
  const items = [...commandListEl.querySelectorAll<HTMLButtonElement>('.command-item')];
  const activeIndex = Math.max(0, items.findIndex((item) => item.classList.contains('active')));

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    items[activeIndex]?.classList.remove('active');
    items[Math.min(activeIndex + 1, items.length - 1)]?.classList.add('active');
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    items[activeIndex]?.classList.remove('active');
    items[Math.max(activeIndex - 1, 0)]?.classList.add('active');
  } else if (event.key === 'Enter') {
    event.preventDefault();
    items[activeIndex]?.click();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeCommandPalette();
  }
});

searchPaletteEl.addEventListener('click', (event) => {
  if (event.target === searchPaletteEl) closeGlobalSearch();
});
globalSearchInputEl.addEventListener('input', renderGlobalSearch);
globalSearchInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeGlobalSearch();
  }
});

findInputEl.addEventListener('input', () => updateFindMatches());
findInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    moveFind(event.shiftKey ? -1 : 1);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeFindPanel();
  }
});
replaceInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void replaceCurrentMatch();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeFindPanel();
  }
});
document.getElementById('btnFindPrev')?.addEventListener('click', () => moveFind(-1));
document.getElementById('btnFindNext')?.addEventListener('click', () => moveFind(1));
document.getElementById('btnReplaceOne')?.addEventListener('click', () => { void replaceCurrentMatch(); });
document.getElementById('btnReplaceAll')?.addEventListener('click', () => { void replaceAllMatches(); });
document.getElementById('btnCloseFind')?.addEventListener('click', closeFindPanel);

document.getElementById('btnCloseSettings')?.addEventListener('click', () => modalSettingsEl.close());
document.querySelectorAll<HTMLButtonElement>('.settings-tab').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach((tab) => tab.classList.toggle('active', tab === button));
    document.querySelectorAll('.settings-panel').forEach((panel) => {
      panel.classList.toggle('active', (panel as HTMLElement).dataset.settingsPanel === button.dataset.settingsTab);
    });
  });
});
settingsLanguageSelectEl.addEventListener('change', () => {
  setLocale(settingsLanguageSelectEl.value as Locale | 'system');
  refreshLocalizedUi();
});
settingsSyncStrategyEl.addEventListener('change', () => {
  state.syncStrategy = settingsSyncStrategyEl.value || 'git';
  localStorage.setItem('syncStrategy', state.syncStrategy);
  syncStrategySelectEl.value = state.syncStrategy;
  updateSyncStrategyUi();
  void saveVaultConfig();
});
shortcutListEl.addEventListener('change', (event) => {
  const input = event.target as HTMLInputElement;
  const commandId = input.dataset.shortcutCommand;
  if (!commandId) return;
  state.shortcuts[commandId] = input.value.trim();
  saveShortcuts();
  renderCommandPalette(commandSearchEl.value);
});
document.getElementById('btnResetShortcuts')?.addEventListener('click', () => {
  state.shortcuts = { ...DEFAULT_SHORTCUTS };
  saveShortcuts();
  renderSettings();
});
document.getElementById('btnSaveVaultConfig')?.addEventListener('click', async () => {
  await saveVaultConfig();
  showToast(t('vaultConfigSaved'), 'success');
});
document.getElementById('btnReloadPlugins')?.addEventListener('click', loadPluginManifests);
document.getElementById('btnExportDiagnostics')?.addEventListener('click', exportDiagnostics);

async function handleAttachmentEvent(event: DragEvent | ClipboardEvent) {
  const files = 'clipboardData' in event ? event.clipboardData?.files : event.dataTransfer?.files;
  const image = [...(files || [])].find((file) => file.type.startsWith('image/'));
  if (!image) return;
  event.preventDefault();
  await saveAttachment(image);
}

editorEl.addEventListener('paste', handleAttachmentEvent);
sourceEditorEl.addEventListener('paste', handleAttachmentEvent);
editorEl.addEventListener('drop', handleAttachmentEvent);
sourceEditorEl.addEventListener('drop', handleAttachmentEvent);
editorEl.addEventListener('dragover', (event) => event.preventDefault());
sourceEditorEl.addEventListener('dragover', (event) => event.preventDefault());

[editorWrapper, editorEl, sourceEditorEl].forEach((target) => {
  target.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    showEditorContextMenu(event.clientX, event.clientY);
  }, { capture: true });
});

editorContextMenuEl.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-editor-action]');
  if (!button) return;
  void runEditorAction(button.dataset.editorAction as EditorAction);
});

document.addEventListener('click', (event) => {
  if (!editorContextMenuEl.contains(event.target as Node)) {
    hideEditorContextMenu();
  }
});

graphFilterEl.addEventListener('input', () => {
  state.graph.filter = graphFilterEl.value;
  updateKnowledgeState();
});
document.getElementById('btnResetGraph')?.addEventListener('click', resetGraphView);
graphCanvasEl.addEventListener('wheel', (event) => {
  event.preventDefault();
  const delta = event.deltaY > 0 ? 0.92 : 1.08;
  state.graph.zoom = Math.max(0.35, Math.min(2.6, state.graph.zoom * delta));
  drawGraph();
});
graphCanvasEl.addEventListener('mousedown', (event) => {
  const point = graphPointFromEvent(event);
  const node = hitGraphNode(point.x, point.y);
  state.graph.dragNodeId = node?.id || null;
  state.graph.isPanning = !node;
  state.graph.lastX = point.screenX;
  state.graph.lastY = point.screenY;
  state.graph.pointerMoved = false;
});
window.addEventListener('mousemove', (event) => {
  if (!state.graph.dragNodeId && !state.graph.isPanning) return;
  const rect = graphCanvasEl.getBoundingClientRect();
  const screenX = event.clientX - rect.left;
  const screenY = event.clientY - rect.top;
  const dx = screenX - state.graph.lastX;
  const dy = screenY - state.graph.lastY;
  if (Math.abs(dx) + Math.abs(dy) > 2) {
    state.graph.pointerMoved = true;
  }

  if (state.graph.dragNodeId) {
    const node = state.graph.nodes.find((item) => item.id === state.graph.dragNodeId);
    if (node) {
      node.x += dx / state.graph.zoom;
      node.y += dy / state.graph.zoom;
    }
  } else if (state.graph.isPanning) {
    state.graph.panX += dx;
    state.graph.panY += dy;
  }

  state.graph.lastX = screenX;
  state.graph.lastY = screenY;
  drawGraph();
});
window.addEventListener('mouseup', () => {
  if (state.graph.dragNodeId && !state.graph.pointerMoved) {
    void openFile(state.graph.dragNodeId);
  }
  state.graph.dragNodeId = null;
  state.graph.isPanning = false;
  state.graph.pointerMoved = false;
  void saveVaultConfig();
});

languageSelectEl.addEventListener('change', () => {
  setLocale(languageSelectEl.value as Locale | 'system');
  refreshLocalizedUi();
  showToast(t('languageChanged'), 'success');
});

document.getElementById('btnSaveLocaleOverrides')?.addEventListener('click', () => {
  try {
    saveUserLocaleOverrides(localeOverridesEl.value);
    refreshLocalizedUi();
    showToast(t('overrideSaved'), 'success');
  } catch (error) {
    console.error('Invalid locale overrides:', error);
    showToast(t('overrideInvalid'), 'error');
  }
});

document.getElementById('btnRestoreLocaleBuiltin')?.addEventListener('click', () => {
  resetUserLocaleOverrides();
  refreshLocalizedUi();
  showToast(t('overrideRestored'), 'success');
});

syncStrategySelectEl?.addEventListener('change', () => {
  state.syncStrategy = syncStrategySelectEl.value || 'git';
  localStorage.setItem('syncStrategy', state.syncStrategy);
  updateSyncStrategyUi();
  void saveVaultConfig();
  showToast(t('strategyChanged', { name: syncStrategySelectEl.selectedOptions[0]?.textContent || state.syncStrategy }), 'success');
});

btnSyncTargetEl?.addEventListener('click', chooseMirrorTarget);

// Git buttons
document.getElementById('btnGitPull')?.addEventListener('click', handleGitPull);
document.getElementById('btnGitPush')?.addEventListener('click', handleGitPush);
document.getElementById('btnGitCommit')?.addEventListener('click', handleGitCommit);

// Commit dialog
document.getElementById('btnCancelCommit')?.addEventListener('click', () => {
  const modal = document.getElementById('modalGitCommit') as HTMLDialogElement;
  modal.close();
});
document.getElementById('btnConfirmCommit')?.addEventListener('click', executeCommit);

// Conflict dialog
document.getElementById('btnCancelConflict')?.addEventListener('click', () => {
  const modal = document.getElementById('modalConflict') as HTMLDialogElement;
  modal.close();
});
document.getElementById('btnForcePull')?.addEventListener('click', handleForcePull);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const shortcutCommand = commands.find((command) => shortcutMatches(e, command.id));
  if (shortcutCommand) {
    e.preventDefault();
    void shortcutCommand.run();
    return;
  }

  if (e.ctrlKey || e.metaKey) {
    switch (e.key.toLowerCase()) {
      case 'k':
        e.preventDefault();
        openCommandPalette();
        break;
      case 'n':
        e.preventDefault();
        newFile();
        break;
      case 'o':
        e.preventDefault();
        if (e.shiftKey) {
          openFolder();
        } else {
          document.getElementById('btnOpenFile')?.click();
        }
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
        sidebarEl.classList.toggle('collapsed');
        break;
      case 'z':
        // Undo is handled by the editor
        break;
      case 'y':
        // Redo is handled by the editor
        break;
    }
  }

  if (e.key === 'Escape' && !commandPaletteEl.classList.contains('hidden')) {
    closeCommandPalette();
  }

  if (e.key === 'Escape') {
    hideEditorContextMenu();
  }
});

// Initialize
async function init() {
  applyCustomTheme();
  initLanguageSettings();
  initCommandRegistry();
  await activateCorePlugins();
  await loadSyncStrategies();
  await initEditor();
  updateStatusBar();
  updateKnowledgeState();

  // Welcome message
  showToast(t('welcomeToast'), 'success');
  scheduleAutoUpdateCheck();
}

// Start app
init().catch(console.error);

function switchInspectorTab(tab: string) {
  document.querySelectorAll('.inspector-tab').forEach((button) => {
    button.classList.toggle('active', (button as HTMLElement).dataset.inspectorTab === tab);
  });
  document.querySelectorAll('.inspector-panel').forEach((panel) => {
    panel.classList.toggle('active', (panel as HTMLElement).dataset.inspectorPanel === tab);
  });
  if (tab === 'graph') {
    requestAnimationFrame(drawGraph);
  }
}
