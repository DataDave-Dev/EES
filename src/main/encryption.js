const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, safeStorage } = require('electron');
const logger = require('./logger');

// La llave de SQLCipher es de 256 bits (32 bytes), expresada en hex (64 chars)
// para pasarla via PRAGMA key = "x'...'". La guardamos envuelta con safeStorage
// de Electron, que en Windows usa DPAPI y ata el cifrado a la cuenta de usuario
// (en macOS Keychain, Linux libsecret/kwallet). El archivo wrapped no es legible
// por otra cuenta de Windows ni copiandolo a otra maquina.
//
// Archivo: <userData>/key.bin
//   Contenido: salida cruda de safeStorage.encryptString(base64(rawKey))
//   No incluye el algoritmo ni metadata: safeStorage maneja todo internamente.

const KEY_FILENAME = 'key.bin';
const KEY_BYTES = 32;

function getKeyPath() {
  return path.join(app.getPath('userData'), KEY_FILENAME);
}

// Devuelve true si safeStorage puede cifrar/descifrar de forma persistente en
// este entorno. En Linux sin libsecret/kwallet, Electron devuelve true pero
// usa una llave "basic" que no es persistente entre arranques — preferimos
// fallar duro antes que cifrar con algo que no podemos recuperar.
function isSafeStorageReady() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux') {
      // selectedStorageBackend devuelve 'basic_text', 'gnome_libsecret',
      // 'kwallet', etc. 'basic_text' significa que no hay backend real.
      if (typeof safeStorage.getSelectedStorageBackend === 'function') {
        const backend = safeStorage.getSelectedStorageBackend();
        if (backend === 'basic_text' || backend === 'basic') return false;
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

function keyFileExists() {
  try { return fs.existsSync(getKeyPath()); } catch (_) { return false; }
}

// Genera una nueva llave aleatoria, la envuelve con safeStorage y la persiste.
// Devuelve la llave en hex (64 chars).
function generateAndPersistKey() {
  const raw = crypto.randomBytes(KEY_BYTES);
  const hex = raw.toString('hex');
  const b64 = raw.toString('base64');
  const wrapped = safeStorage.encryptString(b64);
  const tmp = getKeyPath() + '.tmp';
  fs.writeFileSync(tmp, wrapped, { mode: 0o600 });
  fs.renameSync(tmp, getKeyPath());
  return hex;
}

// Lee la llave existente. Devuelve hex (64 chars) o lanza si no se puede.
function loadKey() {
  const wrapped = fs.readFileSync(getKeyPath());
  const b64 = safeStorage.decryptString(wrapped);
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== KEY_BYTES) {
    throw new Error(`Llave invalida: se esperaban ${KEY_BYTES} bytes, hay ${raw.length}`);
  }
  return raw.toString('hex');
}

// Garantiza que existe una llave persistida y la devuelve en hex.
// Si no existe la genera; si existe la lee.
function ensureKey() {
  if (!isSafeStorageReady()) {
    throw new Error('safeStorage no disponible en este sistema (sin backend de keyring).');
  }
  if (keyFileExists()) return loadKey();
  return generateAndPersistKey();
}

module.exports = {
  ensureKey,
  isSafeStorageReady,
  keyFileExists,
  getKeyPath,
};
