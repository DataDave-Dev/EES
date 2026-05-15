const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const bcrypt = require('bcrypt');
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
    console.error('[auth] failed to save last user:', err);
  }
}

function countUsers() {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM users').get();
  return row.c;
}

function findUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function findUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getUserPermissions(userId) {
  const rows = getDb()
    .prepare('SELECT permission FROM user_permissions WHERE user_id = ?')
    .all(userId);
  return rows.map((r) => r.permission);
}

function hasPermission(userId, perm) {
  const row = getDb()
    .prepare('SELECT 1 FROM user_permissions WHERE user_id = ? AND permission = ? LIMIT 1')
    .get(userId, perm);
  return !!row;
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

  const stmt = getDb().prepare(`
    INSERT INTO users (username, password_hash, nombre, apellidos, estatus)
    VALUES (?, ?, ?, ?, 'activo')
  `);
  const info = stmt.run(username.trim(), hash, nombre.trim(), apellidos.trim());

  // First admin: seed with full module access.
  const insertPerm = getDb().prepare(
    'INSERT OR IGNORE INTO user_permissions (user_id, permission) VALUES (?, ?)'
  );
  const seed = getDb().transaction(() => {
    for (const perm of ALL_MODULES) insertPerm.run(info.lastInsertRowid, perm);
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

  getDb()
    .prepare("UPDATE users SET fecha_ultima_conexion = datetime('now') WHERE id = ?")
    .run(row.id);

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
  const rows = getDb()
    .prepare(`
      SELECT u.id, u.username, u.nombre, u.apellidos, u.estatus,
             u.fecha_creacion, u.fecha_modificacion, u.fecha_ultima_conexion,
             COALESCE(GROUP_CONCAT(p.permission, ','), '') AS perm_csv
      FROM users u
      LEFT JOIN user_permissions p ON p.user_id = u.id
      GROUP BY u.id
      ORDER BY u.fecha_creacion DESC
    `)
    .all();
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

  const db = getDb();
  const replace = db.transaction(() => {
    db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(target.id);
    const ins = db.prepare(
      'INSERT INTO user_permissions (user_id, permission) VALUES (?, ?)'
    );
    for (const perm of valid) ins.run(target.id, perm);
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
  const info = getDb()
    .prepare(`
      INSERT INTO users (username, password_hash, nombre, apellidos, estatus)
      VALUES (?, ?, ?, ?, 'activo')
    `)
    .run(usr, hash, nom, ape);

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

  if (password) {
    const pwErr = validatePassword(password);
    if (pwErr) return { ok: false, error: pwErr };
    const hash = await bcrypt.hash(password, BCRYPT_COST);
    getDb()
      .prepare('UPDATE users SET username = ?, nombre = ?, apellidos = ?, password_hash = ? WHERE id = ?')
      .run(usr, nom, ape, hash, target.id);
  } else {
    getDb()
      .prepare('UPDATE users SET username = ?, nombre = ?, apellidos = ? WHERE id = ?')
      .run(usr, nom, ape, target.id);
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

  getDb()
    .prepare('UPDATE users SET theme = ?, accent = ? WHERE id = ?')
    .run(nextTheme, nextAccent, target.id);

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

  getDb().prepare('UPDATE users SET estatus = ? WHERE id = ?').run(estatus, target.id);
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
