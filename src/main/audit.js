const { getDb } = require('./db');
const logger = require('./logger');

// Action codes used across the system. Listed here for documentation/UI.
// Format: <domain>.<verb>
const ACTIONS = [
  // Auth
  'auth.login',
  'auth.login_fail',
  'auth.logout',
  'auth.setup_initial_user',
  'auth.reauth_fail',
  // Users
  'user.create',
  'user.update',
  'user.estatus_change',
  'user.permissions_change',
  'user.settings_change',
  // Empleados
  'empleado.create',
  'empleado.update',
  'empleado.estatus_change',
  // Eventos de registro
  'evento.create',
  'evento.update',
  'evento.delete',
  // Catálogos
  'catalogo.create',
  'catalogo.update',
  'catalogo.estatus_change',
  'catalogo.delete',
  // Configuración
  'config.work_schedule_update',
  'config.company_name_update',
  'config.company_logo_update',
  'config.company_logo_remove',
];

// ── Prepared statements (lazy init) ───────────────────────────
let S = null;
function stmts() {
  if (S) return S;
  const db = getDb();
  S = {
    insert: db.prepare(`
      INSERT INTO audit_log
        (user_id, username, action, entity_type, entity_id, entity_label, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    distinctActions: db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action'),
    distinctUsers: db.prepare(`
      SELECT DISTINCT user_id AS id, username
      FROM audit_log
      WHERE user_id IS NOT NULL
      ORDER BY username
    `),
    purgeOlderThan: db.prepare(`
      DELETE FROM audit_log
      WHERE timestamp < datetime('now', ?)
    `),
  };
  return S;
}

// Retención: borra entradas de la bitácora con más de N meses.
// Se invoca al arrancar la app para evitar que la tabla crezca sin límite.
const RETENTION_MONTHS = 12;
function purgeOldEntries(months = RETENTION_MONTHS) {
  try {
    const offset = `-${Math.max(1, months)} months`;
    const info = stmts().purgeOlderThan.run(offset);
    if (info.changes > 0) {
      logger.info('audit', `purga retención: ${info.changes} entrada(s) eliminadas (>${months} meses)`);
    }
    return info.changes;
  } catch (err) {
    logger.error('audit', 'purgeOldEntries failed:', err);
    return 0;
  }
}

// listLog uses dynamic WHERE clauses; cache compiled statements per unique
// WHERE-shape so repeated filter combinations don't re-compile.
const _listLogCache = new Map();
function listLogStmts(whereSql) {
  const cached = _listLogCache.get(whereSql);
  if (cached) return cached;
  const db = getDb();
  const obj = {
    count: db.prepare(`SELECT COUNT(*) AS c FROM audit_log ${whereSql}`),
    rows: db.prepare(`
      SELECT id, timestamp, user_id, username, action,
             entity_type, entity_id, entity_label, details
      FROM audit_log
      ${whereSql}
      ORDER BY timestamp DESC, id DESC
      LIMIT ? OFFSET ?
    `),
  };
  _listLogCache.set(whereSql, obj);
  return obj;
}

// Write one audit entry. Never throws — auditing must not break operations.
function log(entry) {
  try {
    const details = entry.details
      ? (typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details))
      : null;
    stmts().insert.run(
      entry.user_id ?? null,
      String(entry.username || 'anon'),
      String(entry.action || 'unknown'),
      entry.entity_type || null,
      entry.entity_id ?? null,
      entry.entity_label || null,
      details
    );
  } catch (err) {
    logger.error('audit', 'log failed:', err);
  }
}

// List entries with filters and pagination.
// opts: { ini, fin, action, userId, search, limit, offset }
function listLog(opts = {}) {
  try {
    const ini = (opts.ini || '').trim();
    const fin = (opts.fin || '').trim();
    const action = (opts.action || '').trim();
    const userId = Number.isInteger(opts.userId) ? opts.userId : null;
    const search = (opts.search || '').trim();
    const limit = Math.min(500, Math.max(1, parseInt(opts.limit, 10) || 50));
    const offset = Math.max(0, parseInt(opts.offset, 10) || 0);

    const where = [];
    const params = [];
    if (ini) { where.push("date(timestamp, 'localtime') >= ?"); params.push(ini); }
    if (fin) { where.push("date(timestamp, 'localtime') <= ?"); params.push(fin); }
    if (action) { where.push('action = ?'); params.push(action); }
    if (userId !== null) { where.push('user_id = ?'); params.push(userId); }
    if (search) {
      where.push('(username LIKE ? OR entity_label LIKE ? OR details LIKE ?)');
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const ls = listLogStmts(whereSql);

    const total = ls.count.get(...params).c;
    const rows = ls.rows.all(...params, limit, offset);

    return {
      ok: true,
      total,
      limit,
      offset,
      rows: rows.map((r) => ({
        ...r,
        details: r.details ? safeJsonParse(r.details) : null,
      })),
    };
  } catch (err) {
    logger.error('audit', 'listLog failed:', err);
    return { ok: false, error: 'Error al consultar la bitácora' };
  }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}

function listKnownActions() {
  const inDb = stmts().distinctActions.all();
  const merged = new Set([...ACTIONS, ...inDb.map((r) => r.action)]);
  return Array.from(merged).sort();
}

function listKnownUsers() {
  return stmts().distinctUsers.all();
}

module.exports = {
  ACTIONS,
  RETENTION_MONTHS,
  log,
  listLog,
  listKnownActions,
  listKnownUsers,
  purgeOldEntries,
};
