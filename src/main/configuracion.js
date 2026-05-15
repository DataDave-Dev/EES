const { getDb } = require('./db');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseWorkDays(str) {
  return String(str || '')
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
}

function getWorkSchedule() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM app_settings WHERE key IN (?, ?, ?)')
    .all('work_start', 'work_end', 'work_days');
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

  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);
  const tx = db.transaction(() => {
    upsert.run('work_start', work_start);
    upsert.run('work_end',   work_end);
    upsert.run('work_days',  [...new Set(work_days)].sort().join(','));
  });
  tx();
  return { ok: true, schedule: getWorkSchedule() };
}

// ── Company / brand name ──────────────────────────────────────
const DEFAULT_COMPANY_NAME = 'Onix';
const MAX_COMPANY_NAME = 60;

function getCompanyName() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM app_settings WHERE key = 'company_name'").get();
  const v = String(row?.value || '').trim();
  return v || DEFAULT_COMPANY_NAME;
}

function setCompanyName(name) {
  const v = String(name ?? '').trim();
  if (v.length > MAX_COMPANY_NAME) {
    return { ok: false, error: `El nombre no puede tener más de ${MAX_COMPANY_NAME} caracteres` };
  }
  const db = getDb();
  db.prepare(`
    INSERT INTO app_settings (key, value) VALUES ('company_name', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(v);
  return { ok: true, name: getCompanyName(), customized: v.length > 0 };
}

module.exports = {
  getWorkSchedule,
  setWorkSchedule,
  getCompanyName,
  setCompanyName,
  DEFAULT_COMPANY_NAME,
};
