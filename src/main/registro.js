const { getDb } = require('./db');
const empleados = require('./empleados');
const catalogos = require('./catalogos');

function getLastEventToday(empleadoId) {
  return getDb()
    .prepare(`
      SELECT id, empleado_id, tipo, timestamp, registrado_por, motivo_tipo, motivo_detalle
      FROM registro_eventos
      WHERE empleado_id = ?
        AND date(timestamp, 'localtime') = date('now', 'localtime')
      ORDER BY timestamp DESC
      LIMIT 1
    `)
    .get(empleadoId) || null;
}

function getEmpleadoStatus(empleadoId) {
  const emp = empleados.findById(empleadoId);
  if (!emp) return { ok: false, error: 'Empleado no encontrado' };
  return {
    ok: true,
    empleado: empleados.publicEmpleado(emp),
    lastEvent: getLastEventToday(emp.id),
  };
}

function markEvent(empleadoId, registradoPorId, tipo, motivoInfo) {
  const emp = empleados.findById(empleadoId);
  if (!emp) return { ok: false, error: 'Empleado no encontrado' };
  if (emp.estatus !== 'activo') {
    return { ok: false, error: 'El empleado está inactivo' };
  }

  // Explicit tipo if provided; otherwise auto-toggle from last event today.
  let resolvedTipo;
  if (tipo === 'entrada' || tipo === 'salida') {
    resolvedTipo = tipo;
  } else {
    const last = getLastEventToday(emp.id);
    resolvedTipo = last?.tipo === 'entrada' ? 'salida' : 'entrada';
  }

  // Motivo: required for salida, optional for entrada. Both validate against
  // the dynamic 'motivos' catalog when provided. Detalle is always optional.
  const t = String(motivoInfo?.tipo || '').trim();
  const d = String(motivoInfo?.detalle || '').trim();
  let motivoTipo = null;
  let motivoDetalle = null;

  if (resolvedTipo === 'salida' && !t) {
    return { ok: false, error: 'Selecciona el motivo de la salida' };
  }
  if (t) {
    if (!catalogos.isActiveValue('motivos', t)) {
      return { ok: false, error: 'Motivo no válido' };
    }
    motivoTipo = t;
  }
  if (d) motivoDetalle = d;

  const info = getDb()
    .prepare(`
      INSERT INTO registro_eventos (empleado_id, tipo, registrado_por, motivo_tipo, motivo_detalle)
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(emp.id, resolvedTipo, registradoPorId, motivoTipo, motivoDetalle);

  const evento = getDb()
    .prepare(`
      SELECT id, empleado_id, tipo, timestamp, registrado_por, motivo_tipo, motivo_detalle
      FROM registro_eventos WHERE id = ?
    `)
    .get(info.lastInsertRowid);

  return { ok: true, evento, empleado: empleados.publicEmpleado(emp) };
}

function listTodayEvents() {
  return getDb()
    .prepare(`
      SELECT
        e.id,
        e.tipo,
        e.timestamp,
        e.empleado_id,
        e.motivo_tipo,
        e.motivo_detalle,
        emp.numero_empleado,
        emp.nombre        AS emp_nombre,
        emp.apellidos     AS emp_apellidos,
        u.username        AS registrado_por_username
      FROM registro_eventos e
      JOIN empleados emp ON emp.id = e.empleado_id
      JOIN users u       ON u.id   = e.registrado_por
      WHERE date(e.timestamp, 'localtime') = date('now', 'localtime')
      ORDER BY e.timestamp DESC
    `)
    .all();
}

function findEventById(id) {
  return getDb()
    .prepare(`
      SELECT id, empleado_id, tipo, timestamp, registrado_por, motivo_tipo, motivo_detalle
      FROM registro_eventos WHERE id = ?
    `)
    .get(id) || null;
}

// Acepta { tipo, timestamp, motivoTipo, motivoDetalle }.
// timestamp esperado en formato 'YYYY-MM-DD HH:MM:SS' UTC (mismo que SQLite datetime('now')).
function updateEvent(id, { tipo, timestamp, motivoTipo, motivoDetalle } = {}) {
  const target = findEventById(id);
  if (!target) return { ok: false, error: 'Registro no encontrado' };

  const newTipo = tipo === 'entrada' || tipo === 'salida' ? tipo : target.tipo;
  const ts = String(timestamp || target.timestamp).trim();
  if (!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(ts)) {
    return { ok: false, error: 'Fecha y hora no válidas' };
  }
  const normalizedTs = ts.replace('T', ' ').slice(0, 19) +
    (ts.length === 16 || ts.length === 17 ? ':00' : '');

  // Validar motivo según tipo nuevo.
  const t = String(motivoTipo || '').trim();
  const d = String(motivoDetalle || '').trim();
  let finalMotivoTipo = null;
  let finalMotivoDetalle = null;
  if (newTipo === 'salida' && !t) {
    return { ok: false, error: 'Selecciona el motivo de la salida' };
  }
  if (t) {
    if (!catalogos.isActiveValue('motivos', t)) {
      return { ok: false, error: 'Motivo no válido' };
    }
    finalMotivoTipo = t;
  }
  if (d) finalMotivoDetalle = d;

  getDb()
    .prepare(`
      UPDATE registro_eventos
      SET tipo = ?, timestamp = ?, motivo_tipo = ?, motivo_detalle = ?
      WHERE id = ?
    `)
    .run(newTipo, normalizedTs, finalMotivoTipo, finalMotivoDetalle, target.id);

  return { ok: true, evento: findEventById(target.id) };
}

function deleteEvent(id) {
  const target = findEventById(id);
  if (!target) return { ok: false, error: 'Registro no encontrado' };
  getDb().prepare('DELETE FROM registro_eventos WHERE id = ?').run(target.id);
  return { ok: true };
}

module.exports = {
  getLastEventToday,
  getEmpleadoStatus,
  markEvent,
  listTodayEvents,
  findEventById,
  updateEvent,
  deleteEvent,
};
