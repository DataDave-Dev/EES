const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { getDb } = require('./db');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

let S = null;
function stmts() {
  if (S) return S;
  const db = getDb();
  S = {
    getSchedule: db.prepare('SELECT key, value FROM app_settings WHERE key IN (?, ?, ?)'),
    upsert: db.prepare(`
      INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),
    getOne: db.prepare('SELECT value FROM app_settings WHERE key = ?'),
    deleteOne: db.prepare('DELETE FROM app_settings WHERE key = ?'),
  };
  return S;
}

function parseWorkDays(str) {
  return String(str || '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
}

function getWorkSchedule() {
  const rows = stmts().getSchedule.all('work_start', 'work_end', 'work_days');
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    work_start: map.work_start || '09:00',
    work_end:   map.work_end   || '18:00',
    work_days:  parseWorkDays(map.work_days || '1,2,3,4,5'),
  };
}

function setWorkSchedule(payload) {
  const work_start = (payload?.work_start || '').trim();
  const work_end   = (payload?.work_end   || '').trim();
  const work_days  = Array.isArray(payload?.work_days)
    ? payload.work_days.filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
    : [];

  if (!TIME_RE.test(work_start)) return { ok: false, error: 'Hora de inicio inválida (HH:MM)' };
  if (!TIME_RE.test(work_end))   return { ok: false, error: 'Hora de fin inválida (HH:MM)' };
  if (work_start >= work_end)    return { ok: false, error: 'La hora de inicio debe ser anterior a la de fin' };
  if (work_days.length === 0)    return { ok: false, error: 'Selecciona al menos un día laboral' };

  const s = stmts();
  const tx = getDb().transaction(() => {
    s.upsert.run('work_start', work_start);
    s.upsert.run('work_end',   work_end);
    s.upsert.run('work_days',  [...new Set(work_days)].sort().join(','));
  });
  tx();
  return { ok: true, schedule: getWorkSchedule() };
}

// ── Company / brand name ──────────────────────────────────────
const DEFAULT_COMPANY_NAME = 'Onix';
const MAX_COMPANY_NAME = 60;

function getCompanyName() {
  const row = stmts().getOne.get('company_name');
  const v = String(row?.value || '').trim();
  return v || DEFAULT_COMPANY_NAME;
}

function getCompanyNameInfo() {
  const row = stmts().getOne.get('company_name');
  const stored = String(row?.value || '').trim();
  return {
    name: stored || DEFAULT_COMPANY_NAME,
    stored,
    customized: stored.length > 0,
  };
}

function setCompanyName(name) {
  const v = String(name ?? '').trim();
  if (v.length > MAX_COMPANY_NAME) {
    return { ok: false, error: `El nombre no puede tener más de ${MAX_COMPANY_NAME} caracteres` };
  }
  stmts().upsert.run('company_name', v);
  return { ok: true, name: getCompanyName(), customized: v.length > 0 };
}

// ── Company logo (binary file under userData/branding/) ───────
const ALLOWED_LOGO_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/svg+xml',
  'image/webp',
]);
const LOGO_EXT_BY_MIME = {
  'image/png':     'png',
  'image/jpeg':    'jpg',
  'image/jpg':     'jpg',
  'image/svg+xml': 'svg',
  'image/webp':    'webp',
};
const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB

function brandingDir() {
  const dir = path.join(app.getPath('userData'), 'branding');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readSetting(key) {
  const row = stmts().getOne.get(key);
  return row ? String(row.value || '') : '';
}
function writeSetting(key, value) {
  stmts().upsert.run(key, value);
}
function deleteSetting(key) {
  stmts().deleteOne.run(key);
}

function getCompanyLogoInfo() {
  const filename = readSetting('company_logo_filename').trim();
  const mime = readSetting('company_logo_mime').trim();
  if (!filename || !mime) return { exists: false };
  const filepath = path.join(brandingDir(), filename);
  if (!fs.existsSync(filepath)) return { exists: false };
  let size = 0;
  try { size = fs.statSync(filepath).size; } catch {}
  return { exists: true, filename, mime, filepath, size };
}

// Cache the data URL in memory so brand.js (called on every renderer load)
// doesn't re-read + base64-encode a 2 MB file on each request.
let _logoCache = { mtimeMs: 0, dataUrl: null };
function getCompanyLogoDataUrl() {
  const info = getCompanyLogoInfo();
  if (!info.exists) {
    _logoCache = { mtimeMs: 0, dataUrl: null };
    return null;
  }
  try {
    const stat = fs.statSync(info.filepath);
    if (_logoCache.dataUrl && stat.mtimeMs === _logoCache.mtimeMs) {
      return _logoCache.dataUrl;
    }
    const buf = fs.readFileSync(info.filepath);
    const dataUrl = `data:${info.mime};base64,${buf.toString('base64')}`;
    _logoCache = { mtimeMs: stat.mtimeMs, dataUrl };
    return dataUrl;
  } catch {
    return null;
  }
}

function invalidateLogoCache() {
  _logoCache = { mtimeMs: 0, dataUrl: null };
}

function removeCompanyLogo() {
  const info = getCompanyLogoInfo();
  if (info.exists) {
    try { fs.unlinkSync(info.filepath); } catch {}
  }
  deleteSetting('company_logo_filename');
  deleteSetting('company_logo_mime');
  invalidateLogoCache();
  return { ok: true };
}

function setCompanyLogo({ data, mime } = {}) {
  if (!data || typeof data !== 'string') {
    return { ok: false, error: 'Imagen inválida' };
  }
  const normalizedMime = String(mime || '').toLowerCase().trim();
  if (!ALLOWED_LOGO_MIMES.has(normalizedMime)) {
    return { ok: false, error: 'Formato no soportado. Usa PNG, JPG, SVG o WebP.' };
  }

  let buf;
  try { buf = Buffer.from(data, 'base64'); } catch {
    return { ok: false, error: 'No se pudo decodificar la imagen' };
  }
  if (!buf.length) return { ok: false, error: 'Imagen vacía' };
  if (buf.length > MAX_LOGO_BYTES) {
    return { ok: false, error: `La imagen supera el máximo de ${Math.round(MAX_LOGO_BYTES / 1024 / 1024)} MB` };
  }

  // Delete any previous logo (might have a different extension)
  removeCompanyLogo();

  const ext = LOGO_EXT_BY_MIME[normalizedMime];
  const filename = `logo.${ext}`;
  const filepath = path.join(brandingDir(), filename);
  try {
    fs.writeFileSync(filepath, buf);
  } catch (err) {
    return { ok: false, error: 'No se pudo guardar el archivo en disco' };
  }

  writeSetting('company_logo_filename', filename);
  writeSetting('company_logo_mime', normalizedMime);
  invalidateLogoCache();

  return { ok: true, mime: normalizedMime, size: buf.length };
}

module.exports = {
  getWorkSchedule,
  setWorkSchedule,
  getCompanyName,
  getCompanyNameInfo,
  setCompanyName,
  getCompanyLogoInfo,
  getCompanyLogoDataUrl,
  setCompanyLogo,
  removeCompanyLogo,
  DEFAULT_COMPANY_NAME,
  MAX_LOGO_BYTES,
};
