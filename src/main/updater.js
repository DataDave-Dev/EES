const { app, autoUpdater, BrowserWindow } = require('electron');

const FEED_REPO = 'DataDave-Dev/EES';
const CHECK_TIMEOUT_MS = 20000;

let lastDownloaded = null;
let lastAvailableVersion = null;
let listenersAttached = false;

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w && !w.isDestroyed()) {
      w.webContents.send(channel, payload);
    }
  }
}

// Normaliza las notas de release. En Windows, Squirrel.Windows entrega XML
// (<item><title>...</title><description>...</description></item>); en otros
// casos llega como texto plano o Markdown. Devolvemos el contenido tal cual,
// con una limpieza mínima para que el renderer lo procese.
function normalizeReleaseNotes(raw) {
  if (!raw) return '';
  if (typeof raw !== 'string') return String(raw);
  // Quita envolvente <item><description>...</description></item> si existe
  const descMatch = raw.match(/<description>([\s\S]*?)<\/description>/i);
  if (descMatch) return descMatch[1].trim();
  return raw.trim();
}

function attachPersistentListeners() {
  if (listenersAttached) return;
  listenersAttached = true;

  autoUpdater.on('checking-for-update', () => {
    broadcast('update:status', { status: 'checking' });
  });

  autoUpdater.on('update-available', () => {
    broadcast('update:status', { status: 'available' });
  });

  autoUpdater.on('update-not-available', () => {
    broadcast('update:status', { status: 'not-available' });
  });

  autoUpdater.on('update-downloaded', (_event, releaseNotes, releaseName) => {
    const notes = normalizeReleaseNotes(releaseNotes);
    lastDownloaded = {
      releaseName: releaseName || lastAvailableVersion || null,
      releaseNotes: notes || null,
      downloadedAt: new Date().toISOString(),
    };
    broadcast('update:downloaded', lastDownloaded);
  });

  autoUpdater.on('error', (err) => {
    broadcast('update:status', {
      status: 'error',
      error: String(err?.message || err || 'Error desconocido'),
    });
  });
}

function getVersionInfo() {
  return {
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    feedRepo: FEED_REPO,
    alreadyDownloaded: lastDownloaded,
  };
}

function getDownloadedUpdate() {
  return lastDownloaded;
}

function quitAndInstall() {
  if (!lastDownloaded) {
    return { ok: false, error: 'No hay ninguna actualización descargada todavía.' };
  }
  try {
    setImmediate(() => autoUpdater.quitAndInstall());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function checkForUpdates() {
  if (!app.isPackaged) {
    return Promise.resolve({
      ok: false,
      status: 'unsupported',
      error: 'Las actualizaciones solo funcionan en la versión instalada (no en modo desarrollo).',
    });
  }
  if (process.platform !== 'win32') {
    return Promise.resolve({
      ok: false,
      status: 'unsupported',
      error: 'Las actualizaciones automáticas solo están configuradas para Windows.',
    });
  }

  if (lastDownloaded) {
    return Promise.resolve({
      ok: true,
      status: 'downloaded',
      releaseName: lastDownloaded.releaseName,
      releaseNotes: lastDownloaded.releaseNotes,
    });
  }

  return new Promise((resolve) => {
    let timer = null;
    let settled = false;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      autoUpdater.removeListener('update-available', onAvailable);
      autoUpdater.removeListener('update-not-available', onNotAvailable);
      autoUpdater.removeListener('update-downloaded', onDownloaded);
      autoUpdater.removeListener('error', onError);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };

    const onAvailable = () => finish({ ok: true, status: 'available' });
    const onNotAvailable = () => finish({ ok: true, status: 'not-available' });
    const onDownloaded = (_e, releaseNotes, releaseName) => {
      const notes = normalizeReleaseNotes(releaseNotes);
      finish({
        ok: true,
        status: 'downloaded',
        releaseName: releaseName || null,
        releaseNotes: notes || null,
      });
    };
    const onError = (err) =>
      finish({ ok: false, status: 'error', error: String(err?.message || err || 'Error desconocido') });

    autoUpdater.on('update-available', onAvailable);
    autoUpdater.on('update-not-available', onNotAvailable);
    autoUpdater.on('update-downloaded', onDownloaded);
    autoUpdater.on('error', onError);

    timer = setTimeout(
      () => finish({ ok: false, status: 'timeout', error: 'Tiempo de espera agotado al consultar actualizaciones.' }),
      CHECK_TIMEOUT_MS
    );

    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      finish({ ok: false, status: 'error', error: String(err?.message || err) });
    }
  });
}

module.exports = {
  getVersionInfo,
  checkForUpdates,
  attachPersistentListeners,
  getDownloadedUpdate,
  quitAndInstall,
  FEED_REPO,
};
