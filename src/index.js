const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const { getDb, closeDb } = require('./main/db');
const { registerIpc, VIEW_SIZES } = require('./main/ipc');
const { hasUsers } = require('./main/auth');

if (require('electron-squirrel-startup')) {
  app.quit();
}

if (app.isPackaged && process.platform === 'win32') {
  const { updateElectronApp, UpdateSourceType } = require('update-electron-app');
  const { attachPersistentListeners } = require('./main/updater');
  attachPersistentListeners();
  updateElectronApp({
    updateSource: {
      type: UpdateSourceType.ElectronPublicUpdateService,
      repo: 'DataDave-Dev/EES',
    },
    updateInterval: '1 hour',
    notifyUser: true,
  });
}

let mainWindow = null;

function createWindow() {
  const startView = hasUsers() ? 'login' : 'setup';
  const size = VIEW_SIZES[startView];

  mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    useContentSize: true,
    resizable: size.resizable,
    minimizable: true,
    maximizable: size.resizable,
    backgroundColor: '#eeece6',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'logo', process.platform === 'win32' ? 'icon.ico' : 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', startView, `${startView}.html`));

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(() => {
  getDb();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  closeDb();
});
