const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const bcrypt = require('bcrypt');
const logger = require('./logger');
const {
  getDb,
  ALL_MODULES,
  ALLOWED_THEMES,
  ALLOWED_ACCENTS,
  DEFAULT_THEME,
  DEFAULT_ACCENT,
} = require('./db');

const BCRYPT_COST = 12;

let currentUser = null;

// ── Prepared statements (lazy init) ───────────────────────────
let S = null;
function stmts() {
  if (S) return S;
  const db = getDb();
  S = {
    countUsers: db.prepare('SELECT COUNT(*) AS c FROM users'),
    findByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    findById: db.prepare('SELECT * FROM users WHERE id = ?'),
    listPermissions: db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?'),
    hasPermission: db.prepare('SELECT 1 FROM user_permissions WHERE user_id = ? AND permission = ? LIMIT 1'),
    listUsers: db.prepare(`
      SELECT u.id, u.username, u.nombre, u.apellidos, u.estatus,
             u.fecha_creacion, u.fecha_modificacion, u.fecha_ultima_conexion,
             COALESCE(GROUP_CONCAT(p.permission, ','), '') AS perm_csv
      FROM users u
      LEFT JOIN user_permissions p ON p.user_id = u.id
      GROUP BY u.id
      ORDER BY u.fecha_creacion DESC
    `),
    insertUser: db.prepare(`
      INSERT INTO users (username, password_hash, nombre, apellidos, estatus)
      VALUES (?, ?, ?, ?, 'activo')
    `),
    insertPerm: db.prepare('INSERT OR IGNORE INTO user_permissions (user_id, permission) VALUES (?, ?)'),
    deletePermsForUser: db.prepare('DELETE FROM user_permissions WHERE user_id = ?'),
    insertPermStrict: db.prepare('INSERT INTO user_permissions (user_id, permission) VALUES (?, ?)'),
    updateLastConn: db.prepare("UPDATE users SET fecha_ultima_conexion = datetime('now') WHERE id = ?"),
    updateBasic: db.prepare('UPDATE users SET username = ?, nombre = ?, apellidos = ? WHERE id = ?'),
    updateWithPassword: db.prepare('UPDATE users SET username = ?, nombre = ?, apellidos = ?, password_hash = ? WHERE id = ?'),
    updateSettings: db.prepare('UPDATE users SET theme = ?, accent = ? WHERE id = ?'),
    updateEstatus: db.prepare('UPDATE users SET estatus = ? WHERE id = ?'),
  };
  return S;
}

function lastUserPath() {
  const dir = app.isPackaged
    ? app.getPath('userData')
    : path.join(__dirname, '..', '..', '.tmp');
  return path.join(dir, 'last-user.txt');
}

function getLastUser() {
  try {
    const username = fs.readFileSync(lastUserPath(), 'utf-8').trim();
    if (!username) return null;
    const row = findUserByUsername(username);
    return {
      username,
      theme:  row?.theme  || DEFAULT_THEME,
      accent: row?.accent || DEFAULT_ACCENT,
    };
  } catch {
    return null;
  }
}

function saveLastUser(username) {
  try {
    const file = lastUserPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(username || '').trim(), 'utf-8');
  } catch (err) {
    logger.error('auth', 'failed to save last user:', err);
  }
}

function countUsers() {
  return stmts().countUsers.get().c;
}

function findUserByUsername(username) {
  return stmts().findByUsername.get(username);
}

function findUserById(id) {
  return stmts().findById.get(id);
}

function getUserPermissions(userId) {
  return stmts().listPermissions.all(userId).map((r) => r.permission);
}

function hasPermission(userId, perm) {
  return !!stmts().hasPermission.get(userId, perm);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    nombre: row.nombre,
    apellidos: row.apellidos,
    estatus: row.estatus,
    theme: row.theme || DEFAULT_THEME,
    accent: row.accent || DEFAULT_ACCENT,
    fecha_creacion: row.fecha_creacion,
    fecha_modificacion: row.fecha_modificacion,
    fecha_ultima_conexion: row.fecha_ultima_conexion,
    permissions: getUserPermissions(row.id),
  };
}

async function createInitialUser({ nombre, apellidos, username, password }) {
  if (countUsers() > 0) {
    return { ok: false, error: 'Ya existe un usuario registrado' };
  }
  if (!nombre || !apellidos || !username || !password) {
    return { ok: false, error: 'Todos los campos son obligatorios' };
  }
  const pwErr = validatePassword(password);
  if (pwErr) return { ok: false, error: pwErr };

  const hash = await bcrypt.hash(password, BCRYPT_COST);

  const s = stmts();
  const info = s.insertUser.run(username.trim(), hash, nombre.trim(), apellidos.trim());

  // First admin: seed with full module access.
  const seed = getDb().transaction(() => {
    for (const perm of ALL_MODULES) s.insertPerm.run(info.lastInsertRowid, perm);
  });
  seed();

  const user = findUserById(info.lastInsertRowid);
  currentUser = publicUser(user);
  return { ok: true, user: currentUser };
}

async function login(username, password) {
  const GENERIC = { ok: false, error: 'Credenciales inválidas' };
  if (!username || !password) return GENERIC;

  const row = findUserByUsername(username.trim());
  if (!row) return GENERIC;

  const matches = await bcrypt.compare(password, row.password_hash);
  if (!matches) return GENERIC;

  if (row.estatus !== 'activo') {
    return { ok: false, error: 'Usuario inactivo' };
  }

  stmts().updateLastConn.run(row.id);

  const fresh = findUserById(row.id);
  currentUser = publicUser(fresh);
  saveLastUser(fresh.username);
  return { ok: true, user: currentUser };
}

function logout() {
  currentUser = null;
}

async function verifyPassword(userId, password) {
  if (!userId || !password) return false;
  const row = findUserById(userId);
  if (!row) return false;
  try {
    return await bcrypt.compare(String(password), row.password_hash);
  } catch {
    return false;
  }
}

function getCurrentUser() {
  return currentUser;
}

function hasUsers() {
  return countUsers() > 0;
}

function listUsers() {
  const rows = stmts().listUsers.all();
  return rows.map(({ perm_csv, ...rest }) => ({
    ...rest,
    permissions: perm_csv ? perm_csv.split(',').filter(Boolean) : [],
  }));
}

function setUserPermissions(userId, permissions) {
  const target = findUserById(userId);
  if (!target) return { ok: false, error: 'Usuario no encontrado' };

  const list = Array.isArray(permissions) ? permissions : [];
  const valid = list.filter((p) => ALL_MODULES.includes(p));

  const isSelf = currentUser && currentUser.id === target.id;
  if (isSelf && !valid.includes('accesos')) {
    return { ok: false, error: 'No puedes quitarte el permiso de Accesos' };
  }

  const s = stmts();
  const replace = getDb().transaction(() => {
    s.deletePermsForUser.run(target.id);
    for (const perm of valid) s.insertPermStrict.run(target.id, perm);
  });
  replace();

  const fresh = publicUser(findUserById(target.id));
  if (isSelf) currentUser = fresh;
  return { ok: true, user: fresh };
}

function normalizeName(s) {
  return String(s ?? '').trim();
}

function validateUsername(username) {
  const v = normalizeName(username);
  if (v.length < 2) return 'El usuario debe tener al menos 2 caracteres';
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) return 'El usuario solo admite letras, números, punto, guion y guion bajo';
  return null;
}

function validatePassword(pw) {
  const p = String(pw ?? '');
  if (p.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (!/[A-Z]/.test(p)) return 'La contraseña debe incluir al menos una letra mayúscula';
  if (!/[a-z]/.test(p)) return 'La contraseña debe incluir al menos una letra minúscula';
  if (!/\d/.test(p)) return 'La contraseña debe incluir al menos un número';
  if (!/[^A-Za-z0-9]/.test(p)) return 'La contraseña debe incluir al menos un símbolo';
  return null;
}

async function createUser({ nombre, apellidos, username, password }) {
  const nom = normalizeName(nombre);
  const ape = normalizeName(apellidos);
  const usr = normalizeName(username);

  if (!nom || !ape || !usr || !password) {
    return { ok: false, error: 'Todos los campos son obligatorios' };
  }
  const usrErr = validateUsername(usr);
  if (usrErr) return { ok: false, error: usrErr };
  const pwErr = validatePassword(password);
  if (pwErr) return { ok: false, error: pwErr };
  if (findUserByUsername(usr)) {
    return { ok: false, error: 'Ese usuario ya está en uso' };
  }

  const hash = await bcrypt.hash(password, BCRYPT_COST);
  const info = stmts().insertUser.run(usr, hash, nom, ape);

  return { ok: true, user: publicUser(findUserById(info.lastInsertRowid)) };
}

async function updateUser(id, { nombre, apellidos, username, password }) {
  const target = findUserById(id);
  if (!target) return { ok: false, error: 'Usuario no encontrado' };

  const nom = normalizeName(nombre);
  const ape = normalizeName(apellidos);
  const usr = normalizeName(username);

  if (!nom || !ape || !usr) {
    return { ok: false, error: 'Nombre, apellidos y usuario son obligatorios' };
  }
  const usrErr = validateUsername(usr);
  if (usrErr) return { ok: false, error: usrErr };

  const isSelf = currentUser && currentUser.id === target.id;
  if (isSelf && usr !== target.username) {
    return { ok: false, error: 'No puedes cambiar tu propio usuario' };
  }

  if (usr !== target.username) {
    const conflict = findUserByUsername(usr);
    if (conflict && conflict.id !== target.id) {
      return { ok: false, error: 'Ese usuario ya está en uso' };
    }
  }

  const s = stmts();
  if (password) {
    const pwErr = validatePassword(password);
    if (pwErr) return { ok: false, error: pwErr };
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    s.updateWithPassword.run(usr, nom, ape, hash, target.id);
  } else {
    s.updateBasic.run(usr, nom, ape, target.id);
  }

  const fresh = findUserById(target.id);
  if (isSelf) currentUser = publicUser(fresh);
  return { ok: true, user: publicUser(fresh) };
}

function setUserSettings({ theme, accent } = {}) {
  if (!currentUser) return { ok: false, error: 'No autenticado' };

  const target = findUserById(currentUser.id);
  if (!target) return { ok: false, error: 'Usuario no encontrado' };

  const nextTheme = theme ?? target.theme;
  const nextAccent = accent ?? target.accent;

  if (!ALLOWED_THEMES.includes(nextTheme)) {
    return { ok: false, error: 'Tema inválido' };
  }
  const isNamed = ALLOWED_ACCENTS.includes(nextAccent);
  const isHex = typeof nextAccent === 'string' && /^#[0-9a-fA-F]{6}$/.test(nextAccent);
  if (!isNamed && !isHex) {
    return { ok: false, error: 'Color de acento inválido' };
  }

  stmts().updateSettings.run(nextTheme, nextAccent, target.id);

  currentUser = publicUser(findUserById(target.id));
  return { ok: true, user: currentUser };
}

function setUserEstatus(id, estatus) {
  if (estatus !== 'activo' && estatus !== 'inactivo') {
    return { ok: false, error: 'Estatus inválido' };
  }
  const target = findUserById(id);
  if (!target) return { ok: false, error: 'Usuario no encontrado' };

  if (currentUser && currentUser.id === target.id && estatus === 'inactivo') {
    return { ok: false, error: 'No puedes inactivar tu propia cuenta' };
  }

  stmts().updateEstatus.run(estatus, target.id);
  return { ok: true, user: publicUser(findUserById(target.id)) };
}

module.exports = {
  createInitialUser,
  login,
  logout,
  getCurrentUser,
  hasUsers,
  getLastUser,
  listUsers,
  createUser,
  updateUser,
  setUserEstatus,
  hasPermission,
  setUserPermissions,
  setUserSettings,
  verifyPassword,
};
