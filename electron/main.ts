import { app, BrowserWindow, Menu } from 'electron';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { rootLogger } from './services/logging/Logger';
import { AdbService } from './services/adb/AdbService';
import { RecoverySessionStore } from './services/recovery/RecoverySessionStore';
import { ParserRegistry } from './services/parsers/ParserRegistry';
import { StrategyEngine } from './services/recovery/StrategyEngine';
import { DEFAULT_STRATEGIES } from './services/recovery/strategies';
import { ExportService } from './services/export/ExportService';
import { KilterCatalogService } from './services/catalog/KilterCatalogService';
import { registerIpc } from './ipc';

const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0e1116',
    // Explicitly enable resize/min/max — Electron defaults to true but on
    // Windows 11 the combination of `show: false` + `ready-to-show` can leave
    // the window manager caching a "fixed size" hint until first maximize.
    // Setting these explicitly + reapplying after show forces the WM to honor it.
    resizable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once('ready-to-show', () => {
    // Re-assert resizable BEFORE show to defeat the Windows 11 cached-size bug.
    mainWindow?.setResizable(true);
    mainWindow?.setMinimumSize(1000, 700);
    // Open maximized by default — the catalog browser benefits from real estate.
    mainWindow?.maximize();
    mainWindow?.show();
  });

  if (isDev) {
    await mainWindow.loadURL('http://localhost:8101');
  } else {
    await mainWindow.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  }
}

async function bootstrap() {
  // Workspace directory: a per-user folder under userData where pulled
  // artifacts and session metadata live until export.
  const userData = app.getPath('userData');
  const workspaceRoot = join(userData, 'sessions');
  await fs.mkdir(workspaceRoot, { recursive: true });

  // Single shared log file for the application; per-session logs are
  // also written by the session itself.
  const appLogFile = join(userData, 'kilter-recovery-kit.log.ndjson');
  rootLogger.setFilePath(appLogFile);
  rootLogger.info('main', 'app starting', {
    userData,
    workspaceRoot,
    appLogFile,
    electron: process.versions.electron,
    node: process.versions.node
  });

  const adb = new AdbService(rootLogger);
  const store = new RecoverySessionStore(workspaceRoot);
  const parsers = new ParserRegistry(rootLogger);

  const onProgress = (sessionId: string, phase: string, message: string) => {
    mainWindow?.webContents.send('session.progress', { sessionId, phase, message });
  };
  rootLogger.onEntry((entry) => {
    mainWindow?.webContents.send('log.entry', entry);
  });

  const engine = new StrategyEngine(DEFAULT_STRATEGIES, adb, rootLogger, store, parsers, onProgress);
  const exporter = new ExportService(rootLogger);

  // The catalog service browses the recovered Kilter SQLite db. Project root
  // is two levels up from dist/electron when packaged, but in dev we're at
  // <root>/dist/electron, so resolve relative to __dirname.
  const projectRoot = isDev
    ? join(__dirname, '..', '..')
    : join(__dirname, '..', '..');
  const catalog = new KilterCatalogService(rootLogger, projectRoot);

  registerIpc({ adb, store, engine, exporter, logger: rootLogger, catalog });
}

/**
 * Build the application menu. We use Electron's role-based menu items so we
 * get the platform-correct keyboard shortcuts for free:
 *   - Reload: Ctrl/Cmd+R
 *   - Toggle DevTools: Ctrl/Cmd+Shift+I (or F12)
 *   - Zoom in: Ctrl/Cmd+Plus  (and Ctrl/Cmd+= for keyboards without numpad)
 *   - Zoom out: Ctrl/Cmd+-
 *   - Reset zoom: Ctrl/Cmd+0
 *   - Fullscreen: F11
 *   - Quit: Ctrl/Cmd+Q
 */
function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const }
      ]
    }] : []),
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' as const } : { role: 'quit' as const }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const, accelerator: 'CommandOrControl+0' },
        { role: 'zoomIn' as const, accelerator: 'CommandOrControl+=' },
        { role: 'zoomOut' as const, accelerator: 'CommandOrControl+-' },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const }
            ]
          : [{ role: 'close' as const }])
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  await bootstrap();
  buildAppMenu();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Standard behavior on every platform: close the window = quit the app.
  // In dev this also tears down the `concurrently -k` parent (vite + tsc),
  // which is the right thing — closing the window means the user is done.
  if (process.platform !== 'darwin') app.quit();
});
