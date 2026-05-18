const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app } = require('electron');
const { getDb } = require('./db');
const empleados = require('./empleados');
const catalogos = require('./catalogos');

// Motivos del catálogo 'inasistencia_motivos' que cuentan como justificados.
// Si el admin crea un motivo personalizado, por defecto se clasifica como
// injustificado. Si necesitas que uno nuevo cuente como justificado, agrégalo
// aquí. Estos textos deben coincidir EXACTAMENTE con los valores semilla en
// src/main/db.js (seedInaCount block).
const JUSTIFICADAS = new Set([
  'Justificada',
  'Vacaciones',
  'Incapacidad médica',
  'Permiso',
  'Día económico',
]);

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
]);
const MAX_EVIDENCIA_BYTES = 5 * 1024 * 1024;
const EXT_BY_MIME = {
  'application/pdf': '.pdf',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function evidenciasDir() {
  const dir = path.join(app.getPath('userData'), 'evidencias');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalize(s) {
  return String(s ?? '').trim();
}

function isJustificada(motivoTipo) {
  return JUSTIFICADAS.has(normalize(motivoTipo));
}

let S = null;
function stmts() {
  if (S) return S;
  const db = getDb();
  const baseCols = `
    i.id, i.empleado_id, i.fecha_ini, i.fecha_fin,
    i.motivo_tipo, i.motivo_detalle,
    i.evidencia_filename, i.evidencia_path, i.evidencia_mime,
    i.registrado_por, i.fecha_creacion, i.fecha_modificacion
  `;
  const joinCols = `
    ${baseCols},
    emp.numero_empleado, emp.nombre AS emp_nombre, emp.apellidos AS emp_apellidos,
    emp.estatus AS emp_estatus,
    u.username AS registrado_por_username
  `;
  S = {
    insert: db.prepare(`
      INSERT INTO inasistencias
        (empleado_id, fecha_ini, fecha_fin, motivo_tipo, motivo_detalle,
         evidencia_filename, evidencia_path, evidencia_mime, registrado_por)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    update: db.prepare(`
      UPDATE inasistencias
      SET empleado_id = ?, fecha_ini = ?, fecha_fin = ?,
          motivo_tipo = ?, motivo_detalle = ?,
          evidencia_filename = ?, evidencia_path = ?, evidencia_mime = ?
      WHERE id = ?
    `),
    delete: db.prepare('DELETE FROM inasistencias WHERE id = ?'),
    findById: db.prepare(`SELECT ${baseCols} FROM inasistencias i WHERE i.id = ?`),
    findByIdJoin: db.prepare(`
      SELECT ${joinCols}
      FROM inasistencias i
      JOIN empleados emp ON emp.id = i.empleado_id
      JOIN users u       ON u.id   = i.registrado_por
      WHERE i.id = ?
    `),
    listAllJoin: db.prepare(`
      SELECT ${joinCols}
      FROM inasistencias i
      JOIN empleados emp ON emp.id = i.empleado_id
      JOIN users u       ON u.id   = i.registrado_por
      ORDER BY i.fecha_ini DESC, i.id DESC
    `),
    rangeForRange: db.prepare(`
      SELECT i.empleado_id, i.fecha_ini, i.fecha_fin, i.motivo_tipo, i.motivo_detalle
      FROM inasistencias i
      WHERE i.fecha_fin >= ? AND i.fecha_ini <= ?
    `),
    rangeForEmpleado: db.prepare(`
      SELECT i.empleado_id, i.fecha_ini, i.fecha_fin, i.motivo_tipo, i.motivo_detalle
      FROM inasistencias i
      WHERE i.empleado_id = ?
        AND i.fecha_fin >= ? AND i.fecha_ini <= ?
    `),
  };
  return S;
}

function publicInasistencia(row) {
  if (!row) return null;
  return {
    id: row.id,
    empleado_id: row.empleado_id,
    empleado: row.emp_nombre != null
      ? {
          id: row.empleado_id,
          numero_empleado: row.numero_empleado,
          nombre: row.emp_nombre,
          apellidos: row.emp_apellidos,
          estatus: row.emp_estatus,
        }
      : null,
    fecha_ini: row.fecha_ini,
    fecha_fin: row.fecha_fin,
    dias: daysBetweenInclusive(row.fecha_ini, row.fecha_fin),
    motivo_tipo: row.motivo_tipo,
    motivo_detalle: row.motivo_detalle || null,
    justificada: isJustificada(row.motivo_tipo),
    evidencia: row.evidencia_path
      ? {
          filename: row.evidencia_filename || null,
          mime: row.evidencia_mime || null,
        }
      : null,
    registrado_por: row.registrado_por,
    registrado_por_username: row.registrado_por_username || null,
    fecha_creacion: row.fecha_creacion,
    fecha_modificacion: row.fecha_modificacion,
  };
}

function daysBetweenInclusive(ini, fin) {
  if (!DATE_RE.test(ini) || !DATE_RE.test(fin)) return 0;
  const a = new Date(ini + 'T00:00:00');
  const b = new Date(fin + 'T00:00:00');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.round((b - a) / 86400000) + 1);
}

function enumerateDates(ini, fin) {
  const out = [];
  if (!DATE_RE.test(ini) || !DATE_RE.test(fin)) return out;
  const start = new Date(ini + 'T00:00:00');
  const end = new Date(fin + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

function validateRange(ini, fin) {
  const a = normalize(ini);
  const b = normalize(fin);
  if (!DATE_RE.test(a)) return 'Fecha de inicio inválida (YYYY-MM-DD)';
  if (!DATE_RE.test(b)) return 'Fecha de fin inválida (YYYY-MM-DD)';
  if (a > b) return 'La fecha de inicio no puede ser posterior a la de fin';
  return null;
}

function saveEvidencia(evidencia) {
  if (!evidencia) return null;
  const mime = String(evidencia.mime || '').toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) {
    return { error: 'Formato de evidencia no soportado. Usa PDF, PNG, JPG o WebP.' };
  }
  const b64 = String(evidencia.dataBase64 || '');
  if (!b64) return { error: 'Archivo de evidencia vacío' };
  let buf;
  try {
    buf = Buffer.from(b64, 'base64');
  } catch (_) {
    return { error: 'No se pudo decodificar el archivo' };
  }
  if (!buf.length) return { error: 'Archivo de evidencia vacío' };
  if (buf.length > MAX_EVIDENCIA_BYTES) {
    return { error: 'La evidencia supera el máximo de 5 MB' };
  }
  const ext = EXT_BY_MIME[mime] || '';
  const baseName = `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
  const dir = evidenciasDir();
  const abs = path.join(dir, baseName);
  fs.writeFileSync(abs, buf);
  return {
    relPath: baseName,
    mime,
    filename: normalize(evidencia.name).slice(0, 200) || baseName,
  };
}

function deleteEvidenciaFile(relPath) {
  if (!relPath) return;
  try {
    const abs = path.join(evidenciasDir(), relPath);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (_) {
    // best-effort cleanup
  }
}

function findById(id) {
  return stmts().findById.get(id) || null;
}

function findByIdJoined(id) {
  return stmts().findByIdJoin.get(id) || null;
}

function createInasistencia(payload = {}, registradoPorId) {
  const empleadoId = Number(payload.empleadoId);
  const emp = empleados.findById(empleadoId);
  if (!emp) return { ok: false, error: 'Empleado no encontrado' };
  if (emp.estatus !== 'activo') {
    return { ok: false, error: 'El empleado está inactivo' };
  }

  const rangeErr = validateRange(payload.fechaIni, payload.fechaFin);
  if (rangeErr) return { ok: false, error: rangeErr };

  const motivoTipo = normalize(payload.motivoTipo);
  if (!motivoTipo) return { ok: false, error: 'Selecciona el motivo de la inasistencia' };
  if (!catalogos.isActiveValue('inasistencia_motivos', motivoTipo)) {
    return { ok: false, error: 'Motivo de inasistencia no válido' };
  }

  const detalle = normalize(payload.motivoDetalle) || null;

  let evidenciaInfo = null;
  if (payload.evidencia) {
    const saved = saveEvidencia(payload.evidencia);
    if (saved && saved.error) return { ok: false, error: saved.error };
    evidenciaInfo = saved;
  }

  try {
    const info = stmts().insert.run(
      empleadoId,
      payload.fechaIni,
      payload.fechaFin,
      motivoTipo,
      detalle,
      evidenciaInfo?.filename || null,
      evidenciaInfo?.relPath || null,
      evidenciaInfo?.mime || null,
      registradoPorId,
    );
    const row = findByIdJoined(info.lastInsertRowid);
    return { ok: true, inasistencia: publicInasistencia(row) };
  } catch (err) {
    // Si la BD falla después de copiar el archivo, no dejes basura.
    if (evidenciaInfo?.relPath) deleteEvidenciaFile(evidenciaInfo.relPath);
    throw err;
  }
}

// payload: { empleadoId?, fechaIni, fechaFin, motivoTipo, motivoDetalle, evidencia }
// evidencia: { name, mime, dataBase64 } reemplaza el adjunto actual.
// evidencia === null: elimina el adjunto.
// evidencia === undefined: lo deja como está.
function updateInasistencia(id, payload = {}) {
  const target = findById(id);
  if (!target) return { ok: false, error: 'Inasistencia no encontrada' };

  const empleadoId = payload.empleadoId != null
    ? Number(payload.empleadoId)
    : target.empleado_id;
  const emp = empleados.findById(empleadoId);
  if (!emp) return { ok: false, error: 'Empleado no encontrado' };
  if (emp.estatus !== 'activo' && emp.id !== target.empleado_id) {
    return { ok: false, error: 'El empleado está inactivo' };
  }

  const fechaIni = payload.fechaIni != null ? payload.fechaIni : target.fecha_ini;
  const fechaFin = payload.fechaFin != null ? payload.fechaFin : target.fecha_fin;
  const rangeErr = validateRange(fechaIni, fechaFin);
  if (rangeErr) return { ok: false, error: rangeErr };

  const motivoTipo = payload.motivoTipo != null
    ? normalize(payload.motivoTipo)
    : target.motivo_tipo;
  if (!motivoTipo) return { ok: false, error: 'Selecciona el motivo de la inasistencia' };
  if (!catalogos.isActiveValue('inasistencia_motivos', motivoTipo)) {
    return { ok: false, error: 'Motivo de inasistencia no válido' };
  }

  const detalle = payload.motivoDetalle != null
    ? (normalize(payload.motivoDetalle) || null)
    : target.motivo_detalle;

  // Manejo del adjunto.
  let evFilename = target.evidencia_filename;
  let evRelPath = target.evidencia_path;
  let evMime = target.evidencia_mime;
  let savedNew = null;
  let removeOld = false;

  if (payload.evidencia === null) {
    removeOld = !!evRelPath;
    evFilename = null;
    evRelPath = null;
    evMime = null;
  } else if (payload.evidencia && typeof payload.evidencia === 'object') {
    savedNew = saveEvidencia(payload.evidencia);
    if (savedNew && savedNew.error) return { ok: false, error: savedNew.error };
    removeOld = !!evRelPath;
    evFilename = savedNew.filename;
    evRelPath = savedNew.relPath;
    evMime = savedNew.mime;
  }

  try {
    stmts().update.run(
      empleadoId, fechaIni, fechaFin, motivoTipo, detalle,
      evFilename, evRelPath, evMime,
      target.id,
    );
  } catch (err) {
    if (savedNew?.relPath) deleteEvidenciaFile(savedNew.relPath);
    throw err;
  }

  if (removeOld && target.evidencia_path) {
    deleteEvidenciaFile(target.evidencia_path);
  }

  return { ok: true, inasistencia: publicInasistencia(findByIdJoined(target.id)) };
}

function deleteInasistencia(id) {
  const target = findById(id);
  if (!target) return { ok: false, error: 'Inasistencia no encontrada' };
  stmts().delete.run(target.id);
  if (target.evidencia_path) deleteEvidenciaFile(target.evidencia_path);
  return { ok: true };
}

// filtros: { empleadoId?, ini?, fin?, motivoTipo? }
function listInasistencias(filtros = {}) {
  // Para simplicidad y dado el volumen esperado (decenas/cientos por mes),
  // listAll + filtrado en memoria. Si crece, prepared statement dinámico.
  const rows = stmts().listAllJoin.all().map(publicInasistencia);
  const empleadoId = filtros.empleadoId != null ? Number(filtros.empleadoId) : null;
  const ini = normalize(filtros.ini);
  const fin = normalize(filtros.fin);
  const motivoTipo = normalize(filtros.motivoTipo);
  return rows.filter((r) => {
    if (empleadoId && r.empleado_id !== empleadoId) return false;
    if (motivoTipo && r.motivo_tipo !== motivoTipo) return false;
    // Overlap del rango registrado con el rango solicitado.
    if (ini && r.fecha_fin < ini) return false;
    if (fin && r.fecha_ini > fin) return false;
    return true;
  });
}

function getEvidenciaAbsolutePath(id) {
  const row = findById(id);
  if (!row || !row.evidencia_path) return null;
  return path.join(evidenciasDir(), row.evidencia_path);
}

// Devuelve Map<empleado_id, Map<fecha_iso, { motivo_tipo, motivo_detalle, justificada }>>
// para todas las inasistencias que se solapen con [ini, fin].
function getInasistenciasParaRango(ini, fin, empleadoId = null) {
  const out = new Map();
  if (!DATE_RE.test(String(ini || '')) || !DATE_RE.test(String(fin || ''))) {
    return out;
  }
  const rows = empleadoId
    ? stmts().rangeForEmpleado.all(Number(empleadoId), ini, fin)
    : stmts().rangeForRange.all(ini, fin);
  for (const r of rows) {
    const lo = r.fecha_ini < ini ? ini : r.fecha_ini;
    const hi = r.fecha_fin > fin ? fin : r.fecha_fin;
    const dias = enumerateDates(lo, hi);
    let perEmp = out.get(r.empleado_id);
    if (!perEmp) { perEmp = new Map(); out.set(r.empleado_id, perEmp); }
    for (const d of dias) {
      // Si hay varias inasistencias para el mismo día (raro), gana la primera.
      if (!perEmp.has(d)) {
        perEmp.set(d, {
          motivo_tipo: r.motivo_tipo,
          motivo_detalle: r.motivo_detalle || null,
          justificada: isJustificada(r.motivo_tipo),
        });
      }
    }
  }
  return out;
}

module.exports = {
  JUSTIFICADAS,
  isJustificada,
  createInasistencia,
  updateInasistencia,
  deleteInasistencia,
  listInasistencias,
  findById,
  findByIdJoined,
  publicInasistencia,
  getEvidenciaAbsolutePath,
  getInasistenciasParaRango,
};
