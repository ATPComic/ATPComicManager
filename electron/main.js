import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { startServer } from '../src/server.js';
import { parseArgs, resolveWorkspaceConfig } from '../src/utils/cli.js';
import { resolveDefaultWorkspace } from './workspace-path.js';
import { t } from '../public/i18n.js';
import { resolveLocale, supportedLocales } from '../public/locale.js';

const SETTINGS_FILE = 'desktop-settings.json';
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

let applicationOrigin = null;
let currentWorkspace = null;
let launchArgs = {};
let mainWindow = null;
let promptLibraryLocation = false;
let server = null;
let shuttingDown = false;
let interfaceLocale = null;
const nativeText = key => t(key, {}, interfaceLocale ?? resolveLocale({ systemLocales: app.getPreferredSystemLanguages() }));

function commandLineArgs() {
  const values = process.argv.slice(app.isPackaged ? 1 : 2);
  return parseArgs(values.filter((value) => value !== '--'));
}

async function isDirectory(directoryPath) {
  if (!directoryPath) return false;
  try {
    return (await fs.stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

function defaultWorkspace() {
  return resolveDefaultWorkspace({
    currentWorkingDirectory: process.cwd(),
    executablePath: process.execPath,
    isPackaged: app.isPackaged,
    portableExecutableDirectory: process.env.PORTABLE_EXECUTABLE_DIR
  });
}

function settingsPath() {
  return path.join(app.getPath('userData'), SETTINGS_FILE);
}

async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

async function rememberedWorkspace(settings) {
  const savedPath = settings.libraryLocation ?? settings.lastWorkspace;
  return await isDirectory(savedPath) ? path.resolve(savedPath) : null;
}

async function saveWorkspace(workspaceRoot) {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(
    settingsPath(),
    `${JSON.stringify({ initialized: true, libraryLocation: workspaceRoot }, null, 2)}\n`,
    'utf8'
  );
}

function registerWorkspaceHandlers() {
  ipcMain.on('interface-locale', (event, value) => {
    if (mainWindow && event.sender === mainWindow.webContents && supportedLocales.includes(value)) interfaceLocale = value;
  });
  ipcMain.handle('library-location:get-state', (event) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error(nativeText('nativeWindowInactive'));
    }
    return {
      defaultLibraryLocation: defaultWorkspace(),
      prompt: promptLibraryLocation
    };
  });
  ipcMain.handle('library-location:choose', async (event, currentPath) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error(nativeText('nativeWindowInactive'));
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      title: nativeText('nativeChooseLibrary'),
      buttonLabel: nativeText('nativeChooseFolder'),
      defaultPath: await isDirectory(currentPath) ? currentPath : defaultWorkspace(),
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('library-location:change', async (event, selectedPath) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error(nativeText('nativeWindowInactive'));
    }
    await changeWorkspace(selectedPath);
    return { ok: true };
  });
  ipcMain.on('window-control', (event, action) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    if (action === 'minimize') mainWindow.minimize();
    if (action === 'close') mainWindow.close();
  });
}

function openExternalUrl(targetUrl) {
  try {
    const protocol = new URL(targetUrl).protocol;
    if (protocol === 'http:' || protocol === 'https:') void shell.openExternal(targetUrl);
  } catch {
    // Ignore malformed and unsupported external URLs.
  }
}

function createApplicationWindow({ show = true } = {}) {
  const window = new BrowserWindow({
    icon: path.join(currentDirectory, '../generated/icons/app.png'),
    width: 1440,
    height: 810,
    minWidth: 960,
    minHeight: 540,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1c1d21',
      symbolColor: '#e4e2e6',
      // Reserve the last pixel of the 40px app bar for its full-width divider.
      height: 39
    },
    backgroundColor: '#111318',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(currentDirectory, 'app-preload.cjs'),
      sandbox: true
    }
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (applicationOrigin && new URL(targetUrl).origin === applicationOrigin) return { action: 'allow' };
    openExternalUrl(targetUrl);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (!applicationOrigin || new URL(targetUrl).origin !== applicationOrigin) {
      event.preventDefault();
      openExternalUrl(targetUrl);
    }
  });
  if (show) window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

async function closeServer(targetServer) {
  if (!targetServer) return;
  targetServer.closeAllConnections?.();
  await new Promise((resolve) => targetServer.close(resolve));
}

async function activateWorkspace(workspaceRoot, { persist = true, show = true } = {}) {
  const config = await resolveWorkspaceConfig({
    ...launchArgs,
    workspace: workspaceRoot,
    host: '127.0.0.1',
    port: 0
  });

  const nextServer = await startServer(config);
  const address = nextServer.address();
  if (!address || typeof address === 'string') {
    await closeServer(nextServer);
    throw new Error('The local application server did not provide a TCP port.');
  }

  const previousServer = server;
  const previousOrigin = applicationOrigin;
  const url = `http://127.0.0.1:${address.port}`;
  applicationOrigin = new URL(url).origin;
  try {
    if (!mainWindow) mainWindow = createApplicationWindow({ show });
    await mainWindow.loadURL(url);
    if (show && !mainWindow.isVisible()) mainWindow.show();
  } catch (error) {
    applicationOrigin = previousOrigin;
    await closeServer(nextServer);
    throw error;
  }

  server = nextServer;
  currentWorkspace = config.workspaceRoot;
  if (persist) {
    try {
      await saveWorkspace(currentWorkspace);
    } catch (error) {
      dialog.showErrorBox(nativeText('nativeSaveLocationFailed'), error.stack ?? error.message ?? String(error));
    }
  }
  await closeServer(previousServer);
  return url;
}

async function changeWorkspace(selectedPath) {
  if (!selectedPath) return;
  const selected = path.resolve(String(selectedPath ?? ''));
  if (!await isDirectory(selected)) {
    throw new Error(nativeText('nativeLocationUnavailable'));
  }
  if (selected === currentWorkspace) {
    promptLibraryLocation = false;
    await saveWorkspace(selected);
    return;
  }

  const previousPrompt = promptLibraryLocation;
  promptLibraryLocation = false;
  try {
    await activateWorkspace(selected);
  } catch (error) {
    promptLibraryLocation = previousPrompt;
    throw error;
  }
}

async function launch() {
  launchArgs = commandLineArgs();
  const setupSmokeTest = launchArgs['setup-smoke-test'] === true;
  const smokeTest = launchArgs['smoke-test'] === true || setupSmokeTest;
  const settings = await readSettings();
  const explicitWorkspace = launchArgs.workspace ? path.resolve(String(launchArgs.workspace)) : null;
  if (explicitWorkspace && !await isDirectory(explicitWorkspace)) {
    throw new Error(`Library directory does not exist: ${explicitWorkspace}`);
  }

  const remembered = await rememberedWorkspace(settings);
  const hasRememberedWorkspace = settings.initialized === true && Boolean(remembered);
  const workspace = explicitWorkspace ?? (hasRememberedWorkspace ? remembered : defaultWorkspace());
  promptLibraryLocation = setupSmokeTest || (!smokeTest && !explicitWorkspace && !hasRememberedWorkspace);

  const url = await activateWorkspace(workspace, {
    persist: !smokeTest && !promptLibraryLocation,
    show: !smokeTest
  });
  if (smokeTest) {
    const response = await fetch(`${url}/api/state`);
    if (!response.ok) throw new Error(`Smoke-test API returned HTTP ${response.status}.`);
    if (setupSmokeTest) {
      const promptState = await mainWindow.webContents.executeJavaScript(`new Promise((resolve) => {
        const deadline = Date.now() + 5000;
        const check = () => {
          const trigger = document.querySelector('[data-library-location-trigger]');
          if (trigger?.getAttribute('aria-expanded') === 'true') {
            const input = document.querySelector('.library-location-input input');
            resolve({
              visible: true,
              editable: Boolean(input && !input.readOnly),
              fontFamily: input ? getComputedStyle(input).fontFamily : ''
            });
            return;
          }
          if (Date.now() >= deadline) {
            resolve({ visible: false, editable: false, fontFamily: '' });
            return;
          }
          setTimeout(check, 50);
        };
        check();
      })`);
      if (!promptState.visible || !promptState.editable || !promptState.fontFamily.includes('Microsoft YaHei UI')) {
        throw new Error(`Library-location editor is not ready: ${JSON.stringify(promptState)}`);
      }
    }
    if (process.platform === 'win32') {
      mainWindow.setOpacity(0);
      mainWindow.showInactive();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const overlayMetrics = await mainWindow.webContents.executeJavaScript(`(async () => {
          const rect = navigator.windowControlsOverlay?.getTitlebarAreaRect();
          const topBar = document.querySelector('.top-app-bar')?.getBoundingClientRect();
          const actions = document.querySelector('.top-actions')?.getBoundingClientRect();
          const appDivider = getComputedStyle(document.querySelector('.app-shell'), '::before');
          const reader = document.querySelector('.reader');
          reader.hidden = false;
          reader.classList.add('is-fullscreen');
          reader.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: innerWidth / 2, clientY: 1 }));
          await new Promise((resolve) => setTimeout(resolve, 260));
          const readerBar = reader.querySelector('.reader-bar')?.getBoundingClientRect();
          const readerDivider = getComputedStyle(reader, '::before');
          const readerFab = reader.querySelector('.reader-tag-fab')?.getBoundingClientRect();
          const readerMetrics = {
            chromeVisible: reader.classList.contains('is-chrome-visible'),
            windowControls: reader.querySelectorAll('.reader-window-controls button').length,
            barRight: readerBar?.right,
            barHeight: readerBar?.height,
            dividerTop: Number.parseFloat(readerDivider.top),
            dividerWidth: Number.parseFloat(readerDivider.width),
            fabBottom: innerHeight - (readerFab?.bottom ?? innerHeight),
            fabRight: innerWidth - (readerFab?.right ?? innerWidth)
          };
          reader.hidden = true;
          reader.classList.remove('is-fullscreen', 'is-chrome-visible');
          return rect ? {
            x: rect.x,
            width: rect.width,
            height: rect.height,
            viewportWidth: innerWidth,
            topBarHeight: topBar?.height,
            dividerTop: Number.parseFloat(appDivider.top),
            dividerWidth: Number.parseFloat(appDivider.width),
            actionsRight: actions?.right,
            reader: readerMetrics
          } : null;
        })()`);
      mainWindow.hide();
      const safeRight = (overlayMetrics?.x ?? 0) + (overlayMetrics?.width ?? 0);
      if (
        !overlayMetrics
        || overlayMetrics.height !== 39
        || overlayMetrics.topBarHeight !== 40
        || overlayMetrics.dividerTop !== 39
        || Math.abs(overlayMetrics.dividerWidth - overlayMetrics.viewportWidth) > 1
        || overlayMetrics.width >= overlayMetrics.viewportWidth
        || overlayMetrics.actionsRight > safeRight + 1
        || !overlayMetrics.reader?.chromeVisible
        || overlayMetrics.reader.windowControls !== 3
        || Math.abs(overlayMetrics.reader.barRight - overlayMetrics.viewportWidth) > 1
        || overlayMetrics.reader.barHeight !== 40
        || overlayMetrics.reader.dividerTop !== 39
        || Math.abs(overlayMetrics.reader.dividerWidth - overlayMetrics.viewportWidth) > 1
        || Math.abs(overlayMetrics.reader.fabBottom - 22) > 1
        || Math.abs(overlayMetrics.reader.fabRight - 76) > 1
      ) {
        throw new Error(`Window-controls overlay is not active: ${JSON.stringify(overlayMetrics)}`);
      }
    }
    mainWindow.destroy();
    mainWindow = null;
    await shutdown();
  }
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const activeServer = server;
  server = null;
  await closeServer(activeServer);
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app.on('before-quit', (event) => {
    if (!shuttingDown && server) {
      event.preventDefault();
      void shutdown();
    }
  });
  app.on('window-all-closed', () => {
    if (currentWorkspace || server) void shutdown();
  });
  app.whenReady()
    .then(() => {
      registerWorkspaceHandlers();
      return launch();
    })
    .catch((error) => {
      const args = commandLineArgs();
      if (args['smoke-test'] === true || args['setup-smoke-test'] === true) {
        console.error(error.stack ?? error.message ?? String(error));
        app.exit(1);
        return;
      }
      dialog.showErrorBox(nativeText('nativeStartupFailed'), error.stack ?? error.message ?? String(error));
      app.quit();
    });
}
