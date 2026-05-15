const { getDb } = require('./db');

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
];

// Write one audit entry. Never throws — auditing must not break operations.
function log(entry) {
  try {
    const db = getDb();
    const details = entry.details
      ? (typeof entry.details === 'string' ? entry.details : JSON.stringify(entry.details))
      : null;
    db.prepare(`
      INSERT INTO audit_log
        (user_id, username, action, entity_type, entity_id, entity_label, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.user_id ?? null,
      String(entry.username || 'anon'),
      String(entry.action || 'unknown'),
      entry.entity_type || null,
      entry.entity_id ?? null,
      entry.entity_label || null,
      details
    );
  } catch (err) {
    console.error('[audit] log failed:', err);
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

    const total = getDb().prepare(
      `SELECT COUNT(*) AS c FROM audit_log ${whereSql}`
    ).get(...params).c;

    const rows = getDb().prepare(`
      SELECT id, timestamp, user_id, username, action,
             entity_type, entity_id, entity_label, details
      FROM audit_log
      ${whereSql}
      ORDER BY timestamp DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

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
    console.error('[audit] listLog failed:', err);
    return { ok: false, error: 'Error al consultar la bitácora' };
  }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return s; }
}

function listKnownActions() {
  // Return both the canonical list and any that appear in the DB (in case of upgrades).
  const inDb = getDb().prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all();
  const merged = new Set([...ACTIONS, ...inDb.map((r) => r.action)]);
  return Array.from(merged).sort();
}

function listKnownUsers() {
  return getDb().prepare(`
    SELECT DISTINCT user_id AS id, username
    FROM audit_log
    WHERE user_id IS NOT NULL
    ORDER BY username
  `).all();
}

module.exports = {
  ACTIONS,
  log,
  listLog,
  listKnownActions,
  listKnownUsers,
};
