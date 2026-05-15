const { getDb } = require('./db');

const RANGES = {
  today: { days: 1, label: 'Hoy' },
  '7d':   { days: 7, label: 'Últimos 7 días' },
  '30d':  { days: 30, label: 'Últimos 30 días' },
};

function normalizeRange(range) {
  return RANGES[range] ? range : 'today';
}

// Returns 'YYYY-MM-DD' local string for "today - n days"
function isoDateOffset(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Prepared statements (lazy init) ───────────────────────────
// better-sqlite3 prepare() compiles + caches plan; doing it once per module
// avoids JIT/compile work on every dashboard refresh.
let S = null;
function stmts() {
  if (S) return S;
  const db = getDb();
  S = {
    empleadosActivos: db.prepare("SELECT COUNT(*) AS c FROM empleados WHERE estatus = 'activo'"),
    eventosHoy: db.prepare(`
      SELECT COUNT(*) AS c FROM registro_eventos
      WHERE date(timestamp, 'localtime') = date('now', 'localtime')
    `),
    entradasHoy: db.prepare(`
      SELECT COUNT(*) AS c FROM registro_eventos
      WHERE tipo = 'entrada'
        AND date(timestamp, 'localtime') = date('now', 'localtime')
    `),
    salidasHoy: db.prepare(`
      SELECT COUNT(*) AS c FROM registro_eventos
      WHERE tipo = 'salida'
        AND date(timestamp, 'localtime') = date('now', 'localtime')
    `),
    presentes: db.prepare(`
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
    `),
    actividadHoy: db.prepare(`
      SELECT
        e.id, e.tipo, e.timestamp, e.motivo_tipo, e.motivo_detalle,
        emp.numero_empleado, emp.nombre AS emp_nombre, emp.apellidos AS emp_apellidos
      FROM registro_eventos e
      JOIN empleados emp ON emp.id = e.empleado_id
      WHERE date(e.timestamp, 'localtime') = date('now', 'localtime')
      ORDER BY e.timestamp DESC
      LIMIT 8
    `),
    motivosRango: db.prepare(`
      SELECT
        COALESCE(motivo_tipo, '(sin motivo)') AS motivo,
        COUNT(*) AS total
      FROM registro_eventos
      WHERE tipo = 'salida'
        AND date(timestamp, 'localtime') BETWEEN ? AND ?
      GROUP BY motivo
      ORDER BY total DESC
      LIMIT 8
    `),
    horasHoy: db.prepare(`
      SELECT
        CAST(strftime('%H', timestamp, 'localtime') AS INTEGER) AS bucket,
        tipo,
        COUNT(*) AS total
      FROM registro_eventos
      WHERE date(timestamp, 'localtime') = date('now', 'localtime')
      GROUP BY bucket, tipo
    `),
    diasRango: db.prepare(`
      SELECT
        date(timestamp, 'localtime') AS bucket,
        tipo,
        COUNT(*) AS total
      FROM registro_eventos
      WHERE date(timestamp, 'localtime') BETWEEN ? AND ?
      GROUP BY bucket, tipo
    `),
  };
  return S;
}

function getStats(rangeRaw) {
  const s = stmts();
  const range = normalizeRange(rangeRaw);
  const days = RANGES[range].days;
  const finIso = isoDateOffset(0);
  const iniIso = isoDateOffset(-(days - 1));

  const empleadosActivos = s.empleadosActivos.get().c;
  const eventosHoy       = s.eventosHoy.get().c;
  const entradasHoy      = s.entradasHoy.get().c;
  const salidasHoy       = s.salidasHoy.get().c;
  const presentes        = s.presentes.all();
  const actividad        = s.actividadHoy.all();
  const motivos          = s.motivosRango.all(iniIso, finIso);

  let actividadSerie;
  if (range === 'today') {
    const horasRows = s.horasHoy.all();
    const buckets = Array.from({ length: 24 }, (_, h) => ({
      key: String(h).padStart(2, '0'),
      label: `${String(h).padStart(2, '0')}:00`,
      shortLabel: h % 3 === 0 ? `${String(h).padStart(2, '0')}h` : '',
      entradas: 0,
      salidas: 0,
    }));
    for (const r of horasRows) {
      if (r.bucket < 0 || r.bucket > 23) continue;
      if (r.tipo === 'entrada') buckets[r.bucket].entradas = r.total;
      else if (r.tipo === 'salida') buckets[r.bucket].salidas = r.total;
    }
    actividadSerie = { kind: 'hourly', buckets };
  } else {
    const diasRows = s.diasRango.all(iniIso, finIso);
    const buckets = [];
    for (let i = 0; i < days; i++) {
      const d = isoDateOffset(-(days - 1 - i));
      const dt = new Date(d + 'T00:00:00');
      const dayShort = dt.toLocaleDateString('es-MX', { weekday: 'short' });
      const dayNum = dt.getDate();
      const monthShort = dt.toLocaleDateString('es-MX', { month: 'short' });
      buckets.push({
        key: d,
        label: dt.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' }),
        shortLabel: days <= 7
          ? `${dayShort.replace('.', '')} ${dayNum}`
          : (i % Math.ceil(days / 8) === 0 ? `${dayNum} ${monthShort.replace('.', '')}` : ''),
        entradas: 0,
        salidas: 0,
      });
    }
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const r of diasRows) {
      const b = byKey.get(r.bucket);
      if (!b) continue;
      if (r.tipo === 'entrada') b.entradas = r.total;
      else if (r.tipo === 'salida') b.salidas = r.total;
    }
    actividadSerie = { kind: 'daily', buckets };
  }

  return {
    range,
    rangeLabel: RANGES[range].label,
    rangeIni: iniIso,
    rangeFin: finIso,
    kpis: {
      empleadosActivos,
      eventosHoy,
      entradasHoy,
      salidasHoy,
      presentes: presentes.length,
    },
    presentes,
    actividad,
    motivos,
    actividadSerie,
  };
}

module.exports = { getStats };
