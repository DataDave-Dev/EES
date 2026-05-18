const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');

// Logger minimo a archivo. Reemplaza a console.error para que los issues
// reportados desde produccion (donde no hay consola) queden persistidos.
//
// Archivo: <userData>/onix-errors.log
// Rotacion: si el archivo supera MAX_BYTES, se mueve a .1 y se empieza uno nuevo.

const MAX_BYTES = 512 * 1024; // 512 KB
let _logPath = null;
let _rotating = false;

function getLogPath() {
  if (_logPath) return _logPath;
  try {
    _logPath = path.join(app.getPath('userData'), 'onix-errors.log');
  } catch (_) {
    // app no listo aun: fallback al tmp del proceso.
    _logPath = path.join(__dirname, '..', '..', 'onix-errors.log');
  }
  return _logPath;
}

function rotateIfNeeded(file) {
  if (_rotating) return;
  try {
    const st = fs.statSync(file);
    if (st.size < MAX_BYTES) return;
    _rotating = true;
    const old = `${file}.1`;
    try { fs.unlinkSync(old); } catch (_) { /* puede no existir */ }
    fs.renameSync(file, old);
  } catch (_) {
    // file no existe todavia: nada que rotar.
  } finally {
    _rotating = false;
  }
}

function formatLine(level, tag, args) {
  const stamp = new Date().toISOString();
  const parts = args.map((a) => {
    if (a instanceof Error) return a.stack || String(a);
    if (typeof a === 'object') {
      try { return JSON.stringify(a); } catch (_) { return String(a); }
    }
    return String(a);
  });
  return `${stamp} ${level} [${tag}] ${parts.join(' ')}\n`;
}

function write(level, tag, args) {
  const line = formatLine(level, tag, args);
  // Eco a consola tambien (util en dev).
  if (level === 'ERROR') console.error(line.trim());
  else if (level === 'WARN') console.warn(line.trim());
  else console.log(line.trim());

  const file = getLogPath();
  try {
    rotateIfNeeded(file);
    fs.appendFileSync(file, line, 'utf8');
  } catch (_) {
    // No podemos hacer nada si el FS falla; al menos quedo el eco a consola.
  }
}

module.exports = {
  error: (tag, ...args) => write('ERROR', tag, args),
  warn: (tag, ...args) => write('WARN', tag, args),
  info: (tag, ...args) => write('INFO', tag, args),
  getLogPath,
};
