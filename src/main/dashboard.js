const { getDb } = require('./db');

function getStats() {
  const db = getDb();

  // ── KPIs ──────────────────────────────────────────────
  const empleadosActivos = db
    .prepare("SELECT COUNT(*) AS c FROM empleados WHERE estatus = 'activo'")
    .get().c;

  const eventosHoy = db
    .prepare(`
      SELECT COUNT(*) AS c FROM registro_eventos
      WHERE date(timestamp, 'localtime') = date('now', 'localtime')
    `)
    .get().c;

  const entradasHoy = db
    .prepare(`
      SELECT COUNT(*) AS c FROM registro_eventos
      WHERE tipo = 'entrada'
        AND date(timestamp, 'localtime') = date('now', 'localtime')
    `)
    .get().c;

  const salidasHoy = db
    .prepare(`
      SELECT COUNT(*) AS c FROM registro_eventos
      WHERE tipo = 'salida'
        AND date(timestamp, 'localtime') = date('now', 'localtime')
    `)
    .get().c;

  // ── Empleados presentes ahora ────────────────────────
  // Para cada empleado, busca su último evento de HOY; si es 'entrada' → está aquí.
  const presentes = db
    .prepare(`
      WITH last_today AS (
        SELECT empleado_id, MAX(timestamp) AS ultimo_ts
        FROM registro_eventos
        WHERE date(timestamp, 'localtime') = date('now', 'localtime')
        GROUP BY empleado_id
      )
      SELECT
        lt.empleado_id,
        lt.ultimo_ts,
        ev.tipo,
        emp.numero_empleado,
        emp.nombre,
        emp.apellidos,
        emp.puesto,
        emp.departamento
      FROM last_today lt
      JOIN registro_eventos ev
        ON ev.empleado_id = lt.empleado_id AND ev.timestamp = lt.ultimo_ts
      JOIN empleados emp ON emp.id = lt.empleado_id
      WHERE ev.tipo = 'entrada' AND emp.estatus = 'activo'
      ORDER BY lt.ultimo_ts DESC
    `)
    .all();

  // ── Actividad reciente (últimos 8 eventos del día) ───
  const actividad = db
    .prepare(`
      SELECT
        e.id, e.tipo, e.timestamp, e.motivo_tipo, e.motivo_detalle,
        emp.numero_empleado, emp.nombre AS emp_nombre, emp.apellidos AS emp_apellidos
      FROM registro_eventos e
      JOIN empleados emp ON emp.id = e.empleado_id
      WHERE date(e.timestamp, 'localtime') = date('now', 'localtime')
      ORDER BY e.timestamp DESC
      LIMIT 8
    `)
    .all();

  // ── Salidas por motivo, últimos 7 días ───────────────
  const motivos7d = db
    .prepare(`
      SELECT
        COALESCE(motivo_tipo, '(sin motivo)') AS motivo,
        COUNT(*) AS total
      FROM registro_eventos
      WHERE tipo = 'salida'
        AND date(timestamp, 'localtime') >= date('now', 'localtime', '-6 days')
      GROUP BY motivo
      ORDER BY total DESC
      LIMIT 8
    `)
    .all();

  // ── Actividad por hora (hoy) ─────────────────────────
  // Devuelve 24 buckets (0..23) con conteo de entradas y salidas.
  const horasRows = db
    .prepare(`
      SELECT
        CAST(strftime('%H', timestamp, 'localtime') AS INTEGER) AS hora,
        tipo,
        COUNT(*) AS total
      FROM registro_eventos
      WHERE date(timestamp, 'localtime') = date('now', 'localtime')
      GROUP BY hora, tipo
    `)
    .all();
  const horas = Array.from({ length: 24 }, (_, h) => ({ hora: h, entradas: 0, salidas: 0 }));
  for (const r of horasRows) {
    if (r.hora < 0 || r.hora > 23) continue;
    if (r.tipo === 'entrada') horas[r.hora].entradas = r.total;
    else if (r.tipo === 'salida') horas[r.hora].salidas = r.total;
  }

  return {
    kpis: {
      empleadosActivos,
      eventosHoy,
      entradasHoy,
      salidasHoy,
      presentes: presentes.length,
    },
    presentes,
    actividad,
    motivos7d,
    horas,
  };
}

module.exports = { getStats };
