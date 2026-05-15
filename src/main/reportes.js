const { getDb } = require('./db');

// fecha: 'YYYY-MM-DD' (local). Si no se pasa, usa hoy local.
function asistenciaDia(fecha) {
  const f = (fecha || '').trim();
  const where = f
    ? "date(e.timestamp, 'localtime') = ?"
    : "date(e.timestamp, 'localtime') = date('now', 'localtime')";
  const sql = `
    SELECT
      e.id,
      e.timestamp,
      e.tipo,
      e.motivo_tipo,
      e.motivo_detalle,
      emp.numero_empleado,
      emp.nombre        AS emp_nombre,
      emp.apellidos     AS emp_apellidos,
      u.username        AS registrado_por_username
    FROM registro_eventos e
    JOIN empleados emp ON emp.id = e.empleado_id
    JOIN users u       ON u.id   = e.registrado_por
    WHERE ${where}
    ORDER BY e.timestamp ASC
  `;
  const stmt = getDb().prepare(sql);
  return f ? stmt.all(f) : stmt.all();
}

function historialEmpleado(empleadoId, fechaIni, fechaFin) {
  if (!empleadoId) return { ok: false, error: 'Selecciona un empleado' };
  const ini = (fechaIni || '').trim();
  const fin = (fechaFin || '').trim();
  if (!ini || !fin) return { ok: false, error: 'Selecciona rango de fechas' };
  if (ini > fin) return { ok: false, error: 'La fecha inicial debe ser anterior o igual a la final' };

  const emp = getDb().prepare('SELECT * FROM empleados WHERE id = ?').get(empleadoId);
  if (!emp) return { ok: false, error: 'Empleado no encontrado' };

  const eventos = getDb()
    .prepare(`
      SELECT
        e.id,
        e.timestamp,
        e.tipo,
        e.motivo_tipo,
        e.motivo_detalle,
        u.username AS registrado_por_username
      FROM registro_eventos e
      JOIN users u ON u.id = e.registrado_por
      WHERE e.empleado_id = ?
        AND date(e.timestamp, 'localtime') BETWEEN ? AND ?
      ORDER BY e.timestamp ASC
    `)
    .all(empleadoId, ini, fin);

  // Días asistidos = días distintos con al menos una entrada
  const diasAsistidos = new Set(
    eventos
      .filter((ev) => ev.tipo === 'entrada')
      .map((ev) => ev.timestamp.slice(0, 10))
  ).size;

  return {
    ok: true,
    empleado: {
      id: emp.id,
      numero_empleado: emp.numero_empleado,
      nombre: emp.nombre,
      apellidos: emp.apellidos,
      puesto: emp.puesto || '',
      departamento: emp.departamento || '',
    },
    rango: { ini, fin },
    eventos,
    diasAsistidos,
  };
}

function salidasPorMotivo(fechaIni, fechaFin) {
  const ini = (fechaIni || '').trim();
  const fin = (fechaFin || '').trim();
  if (!ini || !fin) return { ok: false, error: 'Selecciona rango de fechas' };
  if (ini > fin) return { ok: false, error: 'La fecha inicial debe ser anterior o igual a la final' };

  const rows = getDb()
    .prepare(`
      SELECT
        COALESCE(motivo_tipo, '(sin motivo)') AS motivo,
        COUNT(*) AS total
      FROM registro_eventos
      WHERE tipo = 'salida'
        AND date(timestamp, 'localtime') BETWEEN ? AND ?
      GROUP BY motivo
      ORDER BY total DESC, motivo ASC
    `)
    .all(ini, fin);

  const total = rows.reduce((sum, r) => sum + r.total, 0);
  return { ok: true, rango: { ini, fin }, rows, total };
}

module.exports = {
  asistenciaDia,
  historialEmpleado,
  salidasPorMotivo,
};
