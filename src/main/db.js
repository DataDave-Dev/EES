const path = require('node:path');
const fs = require('node:fs');
const { app } = require('electron');
const Database = require('better-sqlite3-multiple-ciphers');
const encryption = require('./encryption');
const logger = require('./logger');

let db = null;

// SQLCipher v4 es el cipher por defecto del fork. Lo declaramos explicito
// para que un cambio futuro de defaults aguas arriba no rompa BDs existentes.
const CIPHER = 'sqlcipher';
// Cuanto tiempo guardamos la copia plana de seguridad antes de borrarla
// automaticamente (ver maybeCleanupOldBackup).
const BACKUP_RETENTION_DAYS = 30;
const BACKUP_FILENAME = 'app.db.unencrypted.bak';

// Keep in sync with MODULES in src/renderer/shared/permissions.js.
// Main process can't share modules with the renderer directly; if you add
// a module here, add its { key, label } there too.
const ALL_MODULES = [
  'registro', 'inasistencias', 'empleados', 'catalogos', 'reportes', 'usuarios', 'accesos', 'auditoria',
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

    -- Inasistencias: ausencias registradas explícitamente con motivo opcional y
    -- archivo de evidencia (PDF/imagen) copiado a userData/evidencias/.
    -- fecha_ini y fecha_fin son 'YYYY-MM-DD' locales (no UTC); el rango es
    -- inclusivo. evidencia_path es relativa a userData/evidencias/.
    CREATE TABLE IF NOT EXISTS inasistencias (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      empleado_id         INTEGER NOT NULL,
      fecha_ini           TEXT    NOT NULL,
      fecha_fin           TEXT    NOT NULL,
      motivo_tipo         TEXT    NOT NULL,
      motivo_detalle      TEXT,
      evidencia_filename  TEXT,
      evidencia_path      TEXT,
      evidencia_mime      TEXT,
      registrado_por      INTEGER NOT NULL,
      fecha_creacion      TEXT    NOT NULL DEFAULT (datetime('now')),
      fecha_modificacion  TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (empleado_id)    REFERENCES empleados(id),
      FOREIGN KEY (registrado_por) REFERENCES users(id),
      CHECK (fecha_fin >= fecha_ini)
    );

    CREATE INDEX IF NOT EXISTS idx_inasistencias_emp_rango ON inasistencias(empleado_id, fecha_ini, fecha_fin);
    CREATE INDEX IF NOT EXISTS idx_inasistencias_rango     ON inasistencias(fecha_ini, fecha_fin);

    CREATE TRIGGER IF NOT EXISTS trg_inasistencias_updated
    AFTER UPDATE ON inasistencias
    FOR EACH ROW
    WHEN OLD.empleado_id    IS NOT NEW.empleado_id
      OR OLD.fecha_ini      IS NOT NEW.fecha_ini
      OR OLD.fecha_fin      IS NOT NEW.fecha_fin
      OR OLD.motivo_tipo    IS NOT NEW.motivo_tipo
      OR OLD.motivo_detalle IS NOT NEW.motivo_detalle
      OR OLD.evidencia_path IS NOT NEW.evidencia_path
    BEGIN
      UPDATE inasistencias SET fecha_modificacion = datetime('now') WHERE id = OLD.id;
    END;

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

  // Seed default inasistencia motivos if catalog still empty.
  // Los valores marcados como "justificadas" en src/main/inasistencias.js
  // (JUSTIFICADAS) usan EXACTAMENTE estos textos como llave. Si se cambian
  // aquí, actualizar también esa constante para no romper la clasificación.
  const seedInaCount = database
    .prepare("SELECT COUNT(*) AS c FROM catalogo_items WHERE catalogo = 'inasistencia_motivos'")
    .get().c;
  if (seedInaCount === 0) {
    const defaultInaMotivos = [
      'Justificada',
      'Injustificada',
      'Vacaciones',
      'Incapacidad médica',
      'Permiso',
      'Día económico',
      'Otro',
    ];
    const ins = database.prepare(
      'INSERT INTO catalogo_items (catalogo, valor, orden) VALUES (?, ?, ?)'
    );
    const seed = database.transaction(() => {
      defaultInaMotivos.forEach((v, i) => ins.run('inasistencia_motivos', v, i));
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

  // One-time migration: conceder permiso 'inasistencias' a usuarios existentes
  // que ya tenían permisos asignados antes de que el módulo existiera. Sin esto
  // tendrían que ir a Accesos a marcarlo manualmente. Se gatea con una clave en
  // app_settings para correr una sola vez.
  const inaMigrated = database
    .prepare("SELECT value FROM app_settings WHERE key = 'migration_inasistencias_grant'")
    .get();
  if (!inaMigrated) {
    if (hasUsers) {
      const ids = database.prepare('SELECT id FROM users').all();
      const insert = database.prepare(
        "INSERT OR IGNORE INTO user_permissions (user_id, permission) VALUES (?, 'inasistencias')"
      );
      const grant = database.transaction(() => {
        for (const { id } of ids) insert.run(id);
      });
      grant();
    }
    database
      .prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('migration_inasistencias_grant', '1')")
      .run();
  }
}

// Detecta si un archivo SQLite ya esta cifrado. Si abrimos sin llave un archivo
// cifrado, el primer query (PRAGMA schema_version) lanza "file is not a database"
// o similar. Si abrimos con llave un archivo plano, tambien falla. Lo usamos
// para decidir el flujo en getDb().
function detectEncryption(filePath) {
  if (!fs.existsSync(filePath)) return 'absent';
  // Intentamos abrir sin llave: si funciona, el archivo es plano.
  try {
    const test = new Database(filePath, { fileMustExist: true });
    try { test.pragma('schema_version'); test.close(); return 'plain'; }
    catch (_) { test.close(); }
  } catch (_) { /* sigue intentando */ }
  return 'encrypted';
}

// Pre-flight: comprueba que SQLCipher funciona en este entorno antes de tocar
// la BD real. SQLCipher NO permite PRAGMA key en :memory: ni temporary, asi que
// usamos un archivo temporal: lo creamos, lo ciframos, escribimos/leemos y lo
// borramos. Si algo falla, no migramos y dejamos el archivo plano sin tocar.
function sqlcipherPreflightOk(hexKey) {
  const tmpPath = path.join(app.getPath('userData'), `.sqlcipher-test-${Date.now()}.db`);
  let test = null;
  try {
    test = new Database(tmpPath);
    test.pragma(`cipher='${CIPHER}'`);
    test.pragma(`key="x'${hexKey}'"`);
    test.exec('CREATE TABLE t(x INTEGER); INSERT INTO t VALUES (1);');
    const row = test.prepare('SELECT x FROM t').get();
    test.close();
    test = null;

    // Reabrir con la misma llave para confirmar persistencia.
    const reopen = new Database(tmpPath);
    reopen.pragma(`cipher='${CIPHER}'`);
    reopen.pragma(`key="x'${hexKey}'"`);
    const row2 = reopen.prepare('SELECT x FROM t').get();
    reopen.close();

    return row && row.x === 1 && row2 && row2.x === 1;
  } catch (err) {
    logger.error('db', 'preflight SQLCipher fallo:', err);
    return false;
  } finally {
    try { if (test) test.close(); } catch (_) {}
    for (const ext of ['', '-shm', '-wal']) {
      const f = tmpPath + ext;
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    }
  }
}

// Rename con reintentos: en Windows, Node a veces no libera el handle de
// SQLite inmediatamente tras close() y el primer rename revienta con EBUSY.
// Reintentamos con pausa sincrona corta — bloqueo aceptable en arranque.
function renameWithRetry(src, dst, attempts = 6) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.renameSync(src, dst);
      return;
    } catch (err) {
      lastErr = err;
      if (err.code !== 'EBUSY' && err.code !== 'EPERM' && err.code !== 'EACCES') throw err;
      // Espera 50/100/150/200/250/300 ms antes del siguiente intento.
      const sab = new SharedArrayBuffer(4);
      Atomics.wait(new Int32Array(sab), 0, 0, 50 * (i + 1));
    }
  }
  throw lastErr;
}

// Migra un app.db plano a uno cifrado copiando esquema + datos tabla por tabla.
// Atomico: si algo falla, deja el archivo original intacto y limpia parciales.
// Devuelve true si migro, false si decidio no migrar (y la BD plana sigue activa).
//
// El binding better-sqlite3-multiple-ciphers no expone una funcion del estilo
// sqlcipher_export() ni sqlite3mc_export(), por lo que hacemos la copia con
// SQL puro: leemos sqlite_master del origen, recreamos los objetos en el
// destino (tablas → indices → triggers → views) y volcamos cada tabla con
// INSERT en una transaccion. Esto funciona con cualquier driver SQLite.
function migratePlainToEncrypted(plainPath, hexKey) {
  const dir = path.dirname(plainPath);
  const encPath = path.join(dir, 'app.db.encrypted');
  const bakPath = path.join(dir, BACKUP_FILENAME);

  // Limpia residuos de un intento anterior.
  try { if (fs.existsSync(encPath)) fs.unlinkSync(encPath); } catch (_) {}

  let plain = null;
  let dest = null;
  try {
    // Backup binario antes de tocar nada. Si la migracion falla a mitad, el
    // archivo original sigue intacto y el .bak es una segunda red de seguridad.
    fs.copyFileSync(plainPath, bakPath);

    // Abrimos sin readonly para poder forzar journal_mode = DELETE antes de
    // cerrar: en Windows los archivos .shm/.wal en modo WAL mantienen un
    // bloqueo y bloquean el unlink/rename posterior. journal_mode = DELETE
    // flushea y elimina esos compañeros.
    plain = new Database(plainPath);
    plain.pragma('foreign_keys = OFF');
    plain.pragma('journal_mode = DELETE');

    dest = new Database(encPath);
    dest.pragma(`cipher='${CIPHER}'`);
    dest.pragma(`key="x'${hexKey}'"`);
    dest.pragma('foreign_keys = OFF');
    dest.pragma('journal_mode = DELETE');

    // Esquema: tablas primero, luego indices/triggers/views. Filtramos los
    // objetos auto-creados por SQLite (sqlite_*) y los indices internos de
    // UNIQUE/PK (sql IS NULL en sqlite_master) — esos se recrean solos.
    const schemaRows = plain.prepare(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE sql IS NOT NULL
        AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type
        WHEN 'table'   THEN 1
        WHEN 'index'   THEN 2
        WHEN 'view'    THEN 3
        WHEN 'trigger' THEN 4
        ELSE 5
      END
    `).all();

    for (const obj of schemaRows) {
      dest.exec(obj.sql);
    }

    // Datos: una transaccion por tabla. Evitamos prepare/INSERT por fila usando
    // un INSERT con todas las columnas; better-sqlite3 reutiliza el prepared.
    const tables = plain.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all();

    for (const t of tables) {
      const colsInfo = plain.prepare(`PRAGMA table_info(${t.name})`).all();
      if (colsInfo.length === 0) continue;
      const cols = colsInfo.map((c) => c.name);
      const colList = cols.map((c) => `"${c}"`).join(',');
      const placeholders = cols.map(() => '?').join(',');
      const insertSql = `INSERT INTO "${t.name}" (${colList}) VALUES (${placeholders})`;
      const insertStmt = dest.prepare(insertSql);

      const rowsIter = plain.prepare(`SELECT ${colList} FROM "${t.name}"`).iterate();
      const tx = dest.transaction(() => {
        for (const row of rowsIter) {
          insertStmt.run(cols.map((c) => row[c]));
        }
      });
      tx();
    }

    // Verificacion: conteo de filas debe coincidir en tablas criticas.
    const checkTables = ['users', 'empleados', 'registro_eventos', 'audit_log'];
    for (const tbl of checkTables) {
      const tableExists = tables.some((t) => t.name === tbl);
      if (!tableExists) continue;
      const src = plain.prepare(`SELECT COUNT(*) AS c FROM "${tbl}"`).get().c;
      const dst = dest.prepare(`SELECT COUNT(*) AS c FROM "${tbl}"`).get().c;
      if (src !== dst) {
        throw new Error(`migracion: tabla ${tbl} no coincide (src=${src} dst=${dst})`);
      }
    }

    plain.close();
    plain = null;
    dest.close();
    dest = null;

    // Swap atomico mediante doble rename. Windows libera handles con un
    // pequeño retraso tras close(); usar rename (con retry) suele ganar a
    // unlink que es mas estricto. Si el rename intermedio falla, se reintenta
    // un par de veces con pausa corta.
    const deletedPath = `${plainPath}.deleting-${Date.now()}`;
    renameWithRetry(plainPath, deletedPath);
    renameWithRetry(encPath, plainPath);
    // El plano viejo ya esta fuera del camino; lo borramos en background sin
    // bloquear el arranque (si Windows aun lo tiene, se reintenta).
    try { fs.unlinkSync(deletedPath); } catch (_) {
      setTimeout(() => { try { fs.unlinkSync(deletedPath); } catch (_) {} }, 1500);
    }

    // Limpia residuos de WAL del archivo plano antiguo.
    for (const ext of ['-shm', '-wal']) {
      const f = plainPath + ext;
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
    }

    // Refresca timestamp del backup para la purga futura.
    try {
      const now = new Date();
      fs.utimesSync(bakPath, now, now);
    } catch (_) {}

    logger.info('db', 'migracion a cifrado completada; backup en', bakPath);
    return true;
  } catch (err) {
    logger.error('db', 'migracion a cifrado fallo, rollback:', err);
    try { if (dest) dest.close(); } catch (_) {}
    try { if (plain) plain.close(); } catch (_) {}
    try { if (fs.existsSync(encPath)) fs.unlinkSync(encPath); } catch (_) {}
    // El archivo plano original sigue intacto.
    return false;
  }
}

// Purga el backup plano si tiene mas de BACKUP_RETENTION_DAYS dias. Se llama
// en cada arranque despues de abrir la BD cifrada con exito.
function maybeCleanupOldBackup(userDataDir) {
  const bakPath = path.join(userDataDir, BACKUP_FILENAME);
  try {
    if (!fs.existsSync(bakPath)) return;
    const st = fs.statSync(bakPath);
    const ageDays = (Date.now() - st.mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageDays >= BACKUP_RETENTION_DAYS) {
      fs.unlinkSync(bakPath);
      logger.info('db', `backup plano purgado tras ${ageDays.toFixed(1)} dias`);
    }
  } catch (err) {
    logger.warn('db', 'no se pudo purgar backup plano:', err);
  }
}

function getDb() {
  if (db) return db;

  const userDataDir = app.getPath('userData');
  fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, 'app.db');

  console.log('[db] opening connection at', dbPath);

  // Estado del cifrado:
  //   - absent: primera instalacion. Generamos llave y abrimos cifrado vacio.
  //   - plain: BD pre-existente sin cifrar; corremos migracion.
  //   - encrypted: ya es SQLCipher; abrimos con la llave.
  const state = detectEncryption(dbPath);

  // Si safeStorage no esta disponible (Linux sin keyring), seguimos en modo
  // plano para no romper. El usuario nunca pierde acceso a sus datos.
  if (!encryption.isSafeStorageReady()) {
    logger.warn('db', 'safeStorage no disponible: la BD seguira sin cifrar.');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
    return db;
  }

  let hexKey;
  try {
    hexKey = encryption.ensureKey();
  } catch (err) {
    logger.error('db', 'no se pudo obtener la llave de cifrado:', err);
    // Fallback: abrir sin cifrar para que la app no quede inservible.
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
    return db;
  }

  // Pre-flight: verifica que el binding SQLCipher funcione en este equipo.
  if (!sqlcipherPreflightOk(hexKey)) {
    logger.error('db', 'preflight SQLCipher fallo; abriendo sin cifrar.');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
    return db;
  }

  if (state === 'plain') {
    const migrated = migratePlainToEncrypted(dbPath, hexKey);
    if (!migrated) {
      // Quedamos sin cifrar; al proximo arranque se intenta de nuevo.
      db = new Database(dbPath);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      initSchema(db);
      return db;
    }
  }

  // Abrir (o crear) cifrado. Si la llave no abre el archivo (perfil Windows
  // distinto, key.bin perdida) intentamos restaurar desde el backup plano.
  try {
    db = openEncrypted(dbPath, hexKey);
  } catch (err) {
    logger.error('db', 'la llave no abre la BD cifrada:', err);
    const bakPath = path.join(userDataDir, BACKUP_FILENAME);
    if (fs.existsSync(bakPath)) {
      logger.warn('db', 'restaurando desde backup plano:', bakPath);
      try {
        const corrupted = dbPath + '.unopenable-' + Date.now();
        fs.renameSync(dbPath, corrupted);
        fs.copyFileSync(bakPath, dbPath);
        // Limpia residuos de WAL del archivo restaurado.
        for (const ext of ['-shm', '-wal']) {
          const f = dbPath + ext;
          try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) {}
        }
        // Re-intentamos migrar; si falla, abre plano.
        const migrated = migratePlainToEncrypted(dbPath, hexKey);
        if (migrated) {
          db = openEncrypted(dbPath, hexKey);
        } else {
          db = new Database(dbPath);
          db.pragma('journal_mode = WAL');
          db.pragma('foreign_keys = ON');
        }
      } catch (restoreErr) {
        logger.error('db', 'restauracion desde backup fallo:', restoreErr);
        throw new Error('No se pudo abrir la base de datos. Contacta a soporte.');
      }
    } else {
      throw new Error('No se pudo abrir la base de datos cifrada (sin backup disponible).');
    }
  }

  initSchema(db);
  maybeCleanupOldBackup(userDataDir);
  return db;
}

function openEncrypted(dbPath, hexKey) {
  const conn = new Database(dbPath);
  conn.pragma(`cipher='${CIPHER}'`);
  conn.pragma(`key="x'${hexKey}'"`);
  // Sanity check: revienta si la llave es incorrecta.
  conn.pragma('schema_version');
  conn.pragma('journal_mode = WAL');
  conn.pragma('foreign_keys = ON');
  return conn;
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
