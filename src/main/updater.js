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
// Detecta cuando el autoUpdater nativo ya tiene un chequeo en vuelo.
// Mensaje típico de Squirrel.Windows:
//   "AutoUpdater process with arguments --checkForUpdate,<url> is already running"
function isAlreadyRunningError(raw) {
  const s = String(raw || '').toLowerCase();
  return s.includes('already running') || s.includes('already in progress');
}

// Convierte cualquier mensaje técnico del autoUpdater en algo legible para el
// usuario final. Si no reconocemos el patrón, devolvemos un mensaje genérico
// sin filtrar detalles internos (URLs, stack traces, etc.).
function friendlyError(raw) {
  const msg = String(raw || '');
  const lower = msg.toLowerCase();

  if (isAlreadyRunningError(lower)) {
    return 'Ya estamos buscando actualizaciones en segundo plano, espera un momento.';
  }
  if (/\b(enotfound|econnrefused|econnreset|etimedout|getaddrinfo|network|offline)\b/i.test(lower)) {
    return 'No se pudo conectar con el servidor de actualizaciones. Revisa tu conexión a internet e inténtalo de nuevo.';
  }
  if (/(404|not found|no published releases|no release)/i.test(lower)) {
    return 'Aún no hay actualizaciones publicadas para esta versión.';
  }
  if (/(403|401|unauthorized|forbidden|rate limit)/i.test(lower)) {
    return 'El servidor de actualizaciones rechazó la petición. Inténtalo más tarde.';
  }
  if (/(squirrel|update\.exe|cannot find|cannot open|no such file)/i.test(lower)) {
    return 'Las actualizaciones automáticas no están disponibles en esta instalación. Descarga el instalador más reciente desde la página oficial.';
  }
  if (/(500|502|503|504|server error|bad gateway|service unavailable)/i.test(lower)) {
    return 'El servidor de actualizaciones no está disponible en este momento. Inténtalo más tarde.';
  }
  return 'Ocurrió un problema al buscar actualizaciones. Inténtalo más tarde.';
}

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
    const raw = err?.message || err || 'Error desconocido';
    // El "already running" es ruido interno: pasa cuando el usuario pulsa
    // "Buscar actualizaciones" mientras el chequeo automático sigue activo.
    // No es un error real para el usuario, así que ni siquiera lo emitimos.
    if (isAlreadyRunningError(raw)) return;
    broadcast('update:status', {
      status: 'error',
      error: friendlyError(raw),
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
    const onError = (err) => {
      const raw = err?.message || err || '';
      // Si la verificación automática de fondo ya está corriendo, no es un
      // error real: dejamos los listeners activos y esperamos a que ese
      // chequeo termine (sus eventos available/not-available/downloaded
      // resolverán la promesa). El timeout sigue activo como red de seguridad.
      if (isAlreadyRunningError(raw)) return;
      finish({ ok: false, status: 'error', error: friendlyError(raw) });
    };

    autoUpdater.on('update-available', onAvailable);
    autoUpdater.on('update-not-available', onNotAvailable);
    autoUpdater.on('update-downloaded', onDownloaded);
    autoUpdater.on('error', onError);

    timer = setTimeout(
      () => finish({ ok: false, status: 'timeout', error: 'La búsqueda está tardando más de lo normal. Inténtalo de nuevo en un momento.' }),
      CHECK_TIMEOUT_MS
    );

    try {
      autoUpdater.checkForUpdates();
    } catch (err) {
      const raw = err?.message || err || '';
      // Mismo caso síncrono: si el autoUpdater lanza "already running", no
      // disparamos otro chequeo — nos quedamos suscritos al que ya está activo.
      if (isAlreadyRunningError(raw)) return;
      finish({ ok: false, status: 'error', error: friendlyError(raw) });
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
