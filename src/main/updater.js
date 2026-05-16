const { app, autoUpdater } = require('electron');

const FEED_REPO = 'DataDave-Dev/EES';
const CHECK_TIMEOUT_MS = 20000;

let lastDownloaded = null;

function attachPersistentListeners() {
  autoUpdater.on('update-downloaded', (_event, releaseNotes, releaseName) => {
    lastDownloaded = { releaseName: releaseName || null, releaseNotes: releaseNotes || null };
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
    const onDownloaded = (_e, releaseNotes, releaseName) =>
      finish({ ok: true, status: 'downloaded', releaseName: releaseName || null, releaseNotes: releaseNotes || null });
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

module.exports = { getVersionInfo, checkForUpdates, attachPersistentListeners, FEED_REPO };
