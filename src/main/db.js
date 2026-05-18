const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const Database = require('better-sqlite3');

let db = null;

// Keep in sync with MODULES in src/renderer/shared/permissions.js.
// Main process can't share modules with the renderer directly; if you add
// a module here, add its { key, label } there too.
const ALL_MODULES = [
  'registro', 'empleados', 'catalogos', 'reportes', 'usuarios', 'accesos', 'auditoria',
];

// Allowed theme/accent keys. Keep in sync with ACCENTS in shared/theme.js.
const ALLOWED_THEMES = ['claro', 'oscuro'];
const ALLOWED_ACCENTS = ['terracota', 'azul', 'verde', 'violeta'];
const DEFAULT_THEME = 'claro';
const DEFAULT_ACCENT = 'terracota';

// Convencion de zonas horarias en toda la app:
//   - Los TIMESTAMP se persisten en UTC (datetime('now') de SQLite).
//   - Las consultas que comparan "hoy"/"ayer" usan date(timestamp, 'localtime'),
//     que respeta el huso horario del SO donde corre Onix.
//   - El renderer convierte UTC -> local con shared/time.js (EES_TIME).
// Implicacion: si la BD se copia a una maquina con otro huso horario, los
// reportes "del dia" pueden cambiar de dia frente al equipo origen. Para
// mover datos entre husos hay que tenerlo presente.
function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      username              TEXT    UNIQUE NOT NULL,
      password_hash         TEXT    NOT NULL,
      nombre                TEXT    NOT NULL,
      apellidos             TEXT    NOT NULL,
      estatus               TEXT    NOT NULL DEFAULT 'activo'
                                    CHECK (estatus IN ('activo','inactivo')),
      theme                 TEXT    NOT NULL DEFAULT 'claro',
      accent                TEXT    NOT NULL DEFAULT 'terracota',
      fecha_creacion        TEXT    NOT NULL DEFAULT (datetime('now')),
      fecha_modificacion    TEXT    NOT NULL DEFAULT (datetime('now')),
      fecha_ultima_conexion TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

    DROP TRIGGER IF EXISTS trg_users_updated;
    CREATE TRIGGER IF NOT EXISTS trg_users_updated
    AFTER UPDATE ON users
    FOR EACH ROW
    WHEN OLD.username      IS NOT NEW.username
      OR OLD.password_hash IS NOT NEW.password_hash
      OR OLD.nombre        IS NOT NEW.nombre
      OR OLD.apellidos     IS NOT NEW.apellidos
      OR OLD.estatus       IS NOT NEW.estatus
    BEGIN
      UPDATE users SET fecha_modificacion = datetime('now') WHERE id = OLD.id;
    END;

    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id     INTEGER NOT NULL,
      permission  TEXT    NOT NULL,
      PRIMARY KEY (user_id, permission),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);

    CREATE TABLE IF NOT EXISTS empleados (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_empleado    TEXT    UNIQUE NOT NULL,
      nombre             TEXT    NOT NULL,
      apellidos          TEXT    NOT NULL,
      puesto             TEXT    NOT NULL DEFAULT '',
      departamento       TEXT    NOT NULL DEFAULT '',
      estatus            TEXT    NOT NULL DEFAULT 'activo'
                                 CHECK (estatus IN ('activo','inactivo')),
      fecha_creacion     TEXT    NOT NULL DEFAULT (datetime('now')),
      fecha_modificacion TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_empleados_numero ON empleados(numero_empleado);
    CREATE INDEX IF NOT EXISTS idx_empleados_estatus ON empleados(estatus);

    CREATE TRIGGER IF NOT EXISTS trg_empleados_updated
    AFTER UPDATE ON empleados
    FOR EACH ROW
    WHEN OLD.numero_empleado IS NOT NEW.numero_empleado
      OR OLD.nombre          IS NOT NEW.nombre
      OR OLD.apellidos       IS NOT NEW.apellidos
      OR OLD.puesto          IS NOT NEW.puesto
      OR OLD.departamento    IS NOT NEW.departamento
      OR OLD.estatus         IS NOT NEW.estatus
    BEGIN
      UPDATE empleados SET fecha_modificacion = datetime('now') WHERE id = OLD.id;
    END;

    CREATE TABLE IF NOT EXISTS registro_eventos (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      empleado_id     INTEGER NOT NULL,
      tipo            TEXT    NOT NULL CHECK (tipo IN ('entrada','salida')),
      timestamp       TEXT    NOT NULL DEFAULT (datetime('now')),
      registrado_por  INTEGER NOT NULL,
      motivo_tipo     TEXT,
      motivo_detalle  TEXT,
      FOREIGN KEY (empleado_id) REFERENCES empleados(id),
      FOREIGN KEY (registrado_por) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_registro_empleado_ts ON registro_eventos(empleado_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_registro_timestamp ON registro_eventos(timestamp);
    -- Acelera queries del dashboard / reportes que filtran por tipo + rango
    -- (motivos, salidas por motivo, KPIs entradas/salidas hoy).
    CREATE INDEX IF NOT EXISTS idx_registro_tipo_ts ON registro_eventos(tipo, timestamp);

    -- Catálogo genérico (salida_tipos, en el futuro puestos, departamentos, etc.)
    CREATE TABLE IF NOT EXISTS catalogo_items (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      catalogo       TEXT    NOT NULL,
      valor          TEXT    NOT NULL,
      estatus        TEXT    NOT NULL DEFAULT 'activo'
                             CHECK (estatus IN ('activo','inactivo')),
      orden          INTEGER NOT NULL DEFAULT 0,
      fecha_creacion TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE (catalogo, valor)
    );

    CREATE INDEX IF NOT EXISTS idx_catalogo_items_cat ON catalogo_items(catalogo, estatus, orden);

    -- Global app settings (key/value)
    CREATE TABLE IF NOT EXISTS app_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Auditoría: bitácora de todas las acciones del sistema.
    -- username es snapshot del momento (para sobrevivir renombres/borrados).
    -- details guarda un JSON con contexto, before/after, motivo del fallo, etc.
    CREATE TABLE IF NOT EXISTS audit_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp     TEXT    NOT NULL DEFAULT (datetime('now')),
      user_id       INTEGER,
      username      TEXT    NOT NULL DEFAULT 'anon',
      action        TEXT    NOT NULL,
      entity_type   TEXT,
      entity_id     INTEGER,
      entity_label  TEXT,
      details       TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_ts     ON audit_log(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_log_user   ON audit_log(user_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action, timestamp);
    -- Lookup por entidad afectada (drill-down futuro)
    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
  `);

  // Seed default work schedule (only if rows missing).
  // work_days encoded as comma-separated weekday numbers: 1=Mon..7=Sun.
  const settingDefaults = [
    ['work_start', '09:00'],
    ['work_end',   '18:00'],
    ['work_days',  '1,2,3,4,5'],
  ];
  const insSetting = database.prepare(
    'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)'
  );
  for (const [k, v] of settingDefaults) insSetting.run(k, v);

  // Migrate catalog name: 'salida_tipos' → 'motivos'.
  // Defensive against the case where a previous (broken) run seeded 'motivos'
  // BEFORE renaming, leaving both catalogs with overlapping values.
  const oldSalidaCount = database
    .prepare("SELECT COUNT(*) AS c FROM catalogo_items WHERE catalogo = 'salida_tipos'")
    .get().c;
  if (oldSalidaCount > 0) {
    // Drop any newly-seeded 'motivos' rows that would collide with the rename.
    database
      .prepare(`
        DELETE FROM catalogo_items
        WHERE catalogo = 'motivos'
          AND valor IN (SELECT valor FROM catalogo_items WHERE catalogo = 'salida_tipos')
      `)
      .run();
    database
      .prepare("UPDATE catalogo_items SET catalogo = 'motivos' WHERE catalogo = 'salida_tipos'")
      .run();
  }

  // Seed default motivos if catalog still empty (fresh install).
  const seedCount = database
    .prepare("SELECT COUNT(*) AS c FROM catalogo_items WHERE catalogo = 'motivos'")
    .get().c;
  if (seedCount === 0) {
    const defaultMotivos = [
      'Fin de jornada',
      'Comida',
      'Trámite',
      'Cita médica',
      'Comisión',
      'Personal',
      'Llegada normal',
      'Regreso',
      'Otro',
    ];
    const ins = database.prepare(
      'INSERT INTO catalogo_items (catalogo, valor, orden) VALUES (?, ?, ?)'
    );
    const seed = database.transaction(() => {
      defaultMotivos.forEach((v, i) => ins.run('motivos', v, i));
    });
    seed();
  }

  // Migration: add theme/accent columns to pre-existing users tables.
  const cols = database.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('theme')) {
    database.exec("ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'claro'");
  }
  if (!cols.includes('accent')) {
    database.exec("ALTER TABLE users ADD COLUMN accent TEXT NOT NULL DEFAULT 'terracota'");
  }

  // Migration: registro_eventos motivo columns.
  // Step 1: add motivo_tipo/motivo_detalle if neither old nor new exists.
  // Step 2: rename salida_* → motivo_* if old still exists.
  const evCols = database
    .prepare("SELECT name FROM pragma_table_info('registro_eventos')")
    .all()
    .map((c) => c.name);
  if (evCols.length > 0) {
    if (evCols.includes('salida_tipo') && !evCols.includes('motivo_tipo')) {
      database.exec('ALTER TABLE registro_eventos RENAME COLUMN salida_tipo TO motivo_tipo');
    } else if (!evCols.includes('motivo_tipo')) {
      database.exec('ALTER TABLE registro_eventos ADD COLUMN motivo_tipo TEXT');
    }
    if (evCols.includes('salida_detalle') && !evCols.includes('motivo_detalle')) {
      database.exec('ALTER TABLE registro_eventos RENAME COLUMN salida_detalle TO motivo_detalle');
    } else if (!evCols.includes('motivo_detalle')) {
      database.exec('ALTER TABLE registro_eventos ADD COLUMN motivo_detalle TEXT');
    }
  }

  // One-time migration: if the perms table is empty but users exist,
  // grant all module permissions to existing users (they predate the system).
  const hasUsers = database.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0;
  const hasPerms = database.prepare('SELECT COUNT(*) AS c FROM user_permissions').get().c > 0;
  if (hasUsers && !hasPerms) {
    const ids = database.prepare('SELECT id FROM users').all();
    const insert = database.prepare(
      'INSERT OR IGNORE INTO user_permissions (user_id, permission) VALUES (?, ?)'
    );
    const seed = database.transaction(() => {
      for (const { id } of ids) {
        for (const perm of ALL_MODULES) insert.run(id, perm);
      }
    });
    seed();
  }
}

function getDb() {
  if (db) return db;

  const userDataDir = app.getPath('userData');
  fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, 'app.db');

  console.log('[db] opening connection at', dbPath);
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initSchema(db);
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  getDb,
  closeDb,
  ALL_MODULES,
  ALLOWED_THEMES,
  ALLOWED_ACCENTS,
  DEFAULT_THEME,
  DEFAULT_ACCENT,
};
