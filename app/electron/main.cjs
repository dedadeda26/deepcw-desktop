'use strict';

/**
 * DeepCW Desktop — Electron main process.
 *
 * The renderer is the original DeepCW web application (built into ../dist).
 * It is served from a tiny loopback HTTP server so that:
 *   - the app keeps a secure-context origin (127.0.0.1) for getUserMedia,
 *   - cross-origin isolation headers can be provided (needed by
 *     onnxruntime-web multi-threaded WASM),
 *   - absolute asset paths such as /models/*.onnx keep working.
 *
 * Everything runs offline: models, WASM runtime and fonts ship inside the app.
 */

const {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  powerSaveBlocker,
  session,
  shell,
} = require('electron');

// Virtual display adapters installed by remote-desktop / emulator tools
// (UU远程 / GameViewer, MuMu, ToDesk, Sunlogin, ...) make the *sandboxed*
// Chromium GPU process crash during initialisation with an access violation.
// After five failed restarts Chromium gives up and aborts the whole app:
// "FATAL: GPU process isn't usable. Goodbye."
//
// `app.disableHardwareAcceleration()` does NOT help here: a GPU process is
// still spawned for software compositing and crashes the same way. Dropping
// only the GPU process sandbox is the minimal switch that keeps the app alive
// while leaving the renderer sandbox untouched. Set DEEPCW_GPU_SANDBOX=1 to
// restore the Chromium default.
if (process.platform === 'win32' && process.env.DEEPCW_GPU_SANDBOX !== '1') {
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');

const { RigController } = require('./rig.cjs');
const { WsjtxSender } = require('./wsjtx.cjs');

const DIST_DIR = path.join(__dirname, '..', 'dist');
const IS_DEV = !app.isPackaged;
const APP_NAME = 'DeepCW Desktop';

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {http.Server | null} */
let assetServer = null;
let assetPort = 0;
let powerSaveBlockerId = null;

const rig = new RigController();
const wsjtx = new WsjtxSender();

function backgroundDir() {
  return path.join(app.getPath('userData'), 'background');
}

function backgroundPaths() {
  const dir = backgroundDir();
  return {
    dir,
    image: path.join(dir, 'image'),
    meta: path.join(dir, 'meta.json'),
  };
}

const BACKGROUND_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

function sendBackgroundImage(res) {
  const { image, meta } = backgroundPaths();
  let mime = 'image/png';
  try {
    mime = JSON.parse(fs.readFileSync(meta, 'utf8')).mime || mime;
  } catch {
    /* no metadata yet */
  }

  fs.stat(image, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No background image');
      return;
    }

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': String(stats.size),
      'Cache-Control': 'no-store',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    fs.createReadStream(image).pipe(res);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.onnx': 'application/octet-stream',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveAssetPath(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://127.0.0.1').pathname);
  } catch {
    return null;
  }

  if (pathname === '/' || pathname === '') {
    pathname = '/index.html';
  }

  const resolved = path.normalize(path.join(DIST_DIR, pathname));
  if (!resolved.startsWith(DIST_DIR + path.sep) && resolved !== DIST_DIR) {
    return null;
  }
  return resolved;
}

function sendFile(res, filePath) {
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] || 'application/octet-stream',
      'Content-Length': String(stats.size),
      'Cache-Control': 'no-store',
      // Keep the page cross-origin isolated so onnxruntime-web can spawn
      // SharedArrayBuffer backed worker threads.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });

    if (res.req && res.req.method === 'HEAD') {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      res.destroy();
    });
    stream.pipe(res);
  });
}

function startAssetServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const requestUrl = req.url || '/';

      if (requestUrl.split('?')[0] === '/user/background') {
        sendBackgroundImage(res);
        return;
      }

      const resolved = resolveAssetPath(requestUrl);
      if (!resolved) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Bad request');
        return;
      }

      // Single-page-app style fallback: unknown paths without a file extension
      // are routed to index.html.
      if (!fs.existsSync(resolved) && path.extname(resolved) === '') {
        sendFile(res, path.join(DIST_DIR, 'index.html'));
        return;
      }

      sendFile(res, resolved);
    });

    // A stable port keeps the page origin (and therefore localStorage with all
    // user settings) identical across restarts. Fall back to an ephemeral port
    // if something else already owns it.
    const preferredPort = 17321;
    let usedFallback = false;

    const onListening = () => {
      assetPort = server.address().port;
      assetServer = server;
      resolve(assetPort);
    };

    server.once('error', (error) => {
      if (error && error.code === 'EADDRINUSE' && !usedFallback) {
        usedFallback = true;
        server.listen(0, '127.0.0.1', onListening);
        return;
      }
      reject(error);
    });
    server.once('listening', onListening);
    server.listen(preferredPort, '127.0.0.1');
  });
}

function loadWindowState() {
  const stateFile = path.join(app.getPath('userData'), 'window-state.json');
  try {
    const raw = fs.readFileSync(stateFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      Number.isFinite(parsed.width) &&
      Number.isFinite(parsed.height)
    ) {
      return parsed;
    }
  } catch {
    /* first run */
  }
  return { width: 1440, height: 900 };
}

function saveWindowState(win) {
  if (!win || win.isDestroyed()) {
    return;
  }
  try {
    const bounds = win.getNormalBounds();
    const stateFile = path.join(app.getPath('userData'), 'window-state.json');
    fs.writeFileSync(stateFile, JSON.stringify(bounds));
  } catch {
    /* ignore */
  }
}

function sendMenuAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('deepcw:menu-action', action);
  }
}

const MENU_TEXT = {
  zh: {
    file: '文件(&F)',
    open: '打开音频文件…',
    save: '保存解码文本…',
    copy: '复制解码文本',
    clear: '清空解码窗口',
    settings: '设置…',
    edit: '编辑(&E)',
    view: '视图(&V)',
    decode: '解码(&D)',
    startStop: '开始 / 停止',
    alwaysTop: '窗口置顶',
    help: '帮助(&H)',
    about: '关于 DeepCW Desktop',
    homepage: '项目主页',
    aboutDetail:
      'DeepCW 神经网络 CW 解码器的本地桌面版本。\n\n' +
      '解码引擎、模型与原始网页界面 © 2026 e04（AGPL-3.0-only）。\n' +
      '桌面外壳：本项目。',
  },
  en: {
    file: '&File',
    open: 'Open Audio File…',
    save: 'Save Transcript…',
    copy: 'Copy Transcript',
    clear: 'Clear Transcript',
    settings: 'Settings…',
    edit: '&Edit',
    view: '&View',
    decode: '&Decode',
    startStop: 'Start / Stop',
    alwaysTop: 'Always on Top',
    help: '&Help',
    about: 'About DeepCW Desktop',
    homepage: 'Project Homepage',
    aboutDetail:
      'A local desktop build of the DeepCW neural CW decoder.\n\n' +
      'Decoder engine, model and web UI © 2026 e04 (AGPL-3.0-only).\n' +
      'Desktop shell: local build for offline use.',
  },
};

let menuLanguage = 'zh';

function texts() {
  return MENU_TEXT[menuLanguage] || MENU_TEXT.en;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const label = texts();
  const englishRoleLabels = menuLanguage === 'zh' ? undefined : true;
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [];

  if (isMac) {
    template.push({ role: 'appMenu' });
  }

  template.push({
    label: label.file,
    submenu: [
      {
        label: label.open,
        accelerator: 'CmdOrCtrl+O',
        click: () => sendMenuAction('open-file'),
      },
      { type: 'separator' },
      {
        label: label.save,
        accelerator: 'CmdOrCtrl+S',
        click: () => sendMenuAction('save'),
      },
      {
        label: label.copy,
        accelerator: 'CmdOrCtrl+Shift+C',
        click: () => sendMenuAction('copy'),
      },
      {
        label: label.clear,
        accelerator: 'CmdOrCtrl+L',
        click: () => sendMenuAction('clear'),
      },
      { type: 'separator' },
      {
        label: label.settings,
        accelerator: 'CmdOrCtrl+,',
        click: () => sendMenuAction('settings'),
      },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' },
    ],
  });

  template.push({
    label: label.edit,
    submenu: [
      { role: 'copy', ...(englishRoleLabels ? {} : { label: '复制' }) },
      { role: 'paste', ...(englishRoleLabels ? {} : { label: '粘贴' }) },
      { role: 'selectAll', ...(englishRoleLabels ? {} : { label: '全选' }) },
    ],
  });

  template.push({
    label: label.view,
    submenu: [
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
    ],
  });

  template.push({
    label: label.decode,
    submenu: [
      {
        label: label.startStop,
        accelerator: 'CmdOrCtrl+Return',
        click: () => sendMenuAction('toggle-decode'),
      },
      {
        label: label.alwaysTop,
        type: 'checkbox',
        accelerator: 'CmdOrCtrl+T',
        click: (item) => sendMenuAction(item.checked ? 'top-on' : 'top-off'),
      },
    ],
  });

  template.push({
    label: label.help,
    submenu: [
      {
        label: label.about,
        click: () => {
          const version = app.getVersion();
          dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: label.about,
            message: `DeepCW Desktop ${version}`,
            detail: label.aboutDetail,
            buttons: ['OK'],
          });
        },
      },
      {
        label: label.homepage,
        click: () => {
          void shell.openExternal('https://github.com/e04/web-deep-cw-decoder');
        },
      },
      { type: 'separator' },
      { role: 'about' },
    ],
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(port) {
  const state = loadWindowState();

  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 1100,
    minHeight: 640,
    backgroundColor: '#101113',
    show: false,
    title: APP_NAME,
    autoHideMenuBar: false,
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      // AudioContext must be allowed to start without an extra click.
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', () => saveWindowState(mainWindow));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedPrefix = `http://127.0.0.1:${port}/`;
    if (!url.startsWith(allowedPrefix)) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) {
        void shell.openExternal(url);
      }
    }
  });

  void mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  if (IS_DEV && process.env.DEEPCW_OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  return mainWindow;
}

function configurePermissions() {
  const allowed = new Set([
    'media',
    'audioCapture',
    'speaker-selection',
    'clipboard-sanitized-write',
    'clipboard-read',
  ]);

  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(allowed.has(permission));
    },
  );

  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => allowed.has(permission),
  );
}

function registerIpcHandlers() {
  ipcMain.handle('deepcw:info', () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
  }));

  ipcMain.handle('deepcw:copy-text', (_event, text) => {
    clipboard.writeText(String(text ?? ''));
    return true;
  });

  ipcMain.handle('deepcw:save-text', async (_event, text, defaultName) => {
    const suggested = typeof defaultName === 'string' && defaultName
      ? defaultName
      : `deepcw-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save DeepCW transcript',
      defaultPath: path.join(app.getPath('documents'), suggested),
      filters: [
        { name: 'Text file', extensions: ['txt'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    await fsp.writeFile(result.filePath, String(text ?? ''), 'utf8');
    return result.filePath;
  });

  ipcMain.handle('deepcw:open-audio', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open an audio recording to decode',
      properties: ['openFile'],
      filters: [
        {
          name: 'Audio',
          extensions: ['wav', 'mp3', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'webm', 'opus'],
        },
        { name: 'All files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const buffer = await fsp.readFile(filePath);
    return {
      name: path.basename(filePath),
      path: filePath,
      data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };
  });

  ipcMain.handle('deepcw:always-on-top', (_event, value) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(Boolean(value));
    }
    return Boolean(value);
  });

  ipcMain.handle('deepcw:set-awake', (_event, value) => {
    if (value) {
      if (powerSaveBlockerId === null || !powerSaveBlocker.isStarted(powerSaveBlockerId)) {
        powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
      }
      return true;
    }

    if (powerSaveBlockerId !== null) {
      if (powerSaveBlocker.isStarted(powerSaveBlockerId)) {
        powerSaveBlocker.stop(powerSaveBlockerId);
      }
      powerSaveBlockerId = null;
    }
    return false;
  });

  // ---- Rig control (CAT) -------------------------------------------------
  ipcMain.handle('deepcw:rig-list', () => rig.list());
  ipcMain.handle('deepcw:rig-connect', (_event, config) => rig.connect(config));
  ipcMain.handle('deepcw:rig-disconnect', () => rig.disconnect());
  ipcMain.handle('deepcw:rig-status', () => rig.status());
  ipcMain.handle('deepcw:rig-set-frequency', (_event, hz) =>
    rig.setFrequency(Number(hz)),
  );
  ipcMain.handle('deepcw:rig-set-mode', (_event, mode) =>
    rig.setMode(String(mode)),
  );
  ipcMain.handle('deepcw:rig-set-ptt', (_event, on) => rig.setPtt(Boolean(on)));
  ipcMain.handle('deepcw:rig-auto-detect', async () => {
    try {
      return await rig.autoDetect();
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // ---- App level helpers -------------------------------------------------
  ipcMain.handle('deepcw:app-data-folder', () =>
    shell.openPath(app.getPath('userData')),
  );
  ipcMain.on('deepcw:set-language', (_event, lang) => {
    if (lang === 'zh' || lang === 'en') {
      menuLanguage = lang;
      buildMenu();
    }
  });

  // ---- WSJT-X / N1MM UDP -------------------------------------------------
  ipcMain.handle('deepcw:wsjtx-configure', (_event, config) =>
    wsjtx.configure(config || {}),
  );
  ipcMain.handle('deepcw:wsjtx-send', (_event, type, payload) => {
    if (type === 'status') return wsjtx.sendStatus(payload || {});
    if (type === 'decode') return wsjtx.sendDecode(payload || {});
    if (type === 'clear') return wsjtx.sendClear();
    if (type === 'heartbeat') return wsjtx.sendHeartbeat();
    if (type === 'close') return wsjtx.sendClose();
    return false;
  });

  // ---- Custom background image ------------------------------------------
  ipcMain.handle('deepcw:background-choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a background image',
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const extension = path.extname(filePath).toLowerCase();
    const mime = BACKGROUND_MIME[extension] || 'image/png';
    const { dir, image, meta } = backgroundPaths();

    await fsp.mkdir(dir, { recursive: true });
    await fsp.copyFile(filePath, image);
    await fsp.writeFile(meta, JSON.stringify({ mime, source: filePath }), 'utf8');

    return { url: `/user/background?v=${Date.now()}`, mime, source: filePath };
  });

  ipcMain.handle('deepcw:background-clear', async () => {
    const { dir } = backgroundPaths();
    await fsp.rm(dir, { recursive: true, force: true });
    return true;
  });
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

  app.whenReady().then(async () => {
    app.setAppUserModelId('cc.deepcw.desktop');
    configurePermissions();
    registerIpcHandlers();
    buildMenu();

    rig.on('status', (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('deepcw:rig-status', status);
      }
    });

    try {
      const port = await startAssetServer();
      createWindow(port);
    } catch (error) {
      dialog.showErrorBox(
        'DeepCW Desktop failed to start',
        `${error instanceof Error ? error.message : String(error)}\n\n` +
          `Expected web assets in: ${DIST_DIR}`,
      );
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && assetPort) {
        createWindow(assetPort);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', () => {
    wsjtx.close();
    void rig.disconnect().catch(() => undefined);
    if (assetServer) {
      assetServer.close();
      assetServer = null;
    }
  });
}
