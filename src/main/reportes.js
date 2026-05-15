const { getDb } = require('./db');
const configLib = require('./configuracion');

// ── Helpers ───────────────────────────────────────────────────
function timeToSec(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map((s) => parseInt(s, 10));
  return (Number.isFinite(h) ? h : 0) * 3600 + (Number.isFinite(m) ? m : 0) * 60;
}
function pad2(n) { return String(n).padStart(2, '0'); }
function dateToIso(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function todayLocalIso() { return dateToIso(new Date()); }
function nowLocalSec() {
  const d = new Date();
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}
// ISO weekday: 1=Mon..7=Sun (matches schedule encoding)
function isoWeekday(date) {
  const d = date.getDay(); // 0=Sun..6=Sat
  return d === 0 ? 7 : d;
}
function enumerateWorkdays(iniIso, finIso, workDays) {
  const set = new Set(workDays);
  const out = [];
  const start = new Date(iniIso + 'T00:00:00');
  const end = new Date(finIso + 'T00:00:00');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (set.has(isoWeekday(d))) out.push(dateToIso(d));
  }
  return out;
}

// Compute inside/outside seconds for one day given events sorted by time.
// events: [{ time_sec: number, tipo: 'entrada'|'salida' }]
function computeDayStats(events, workStartSec, workEndSec, isToday, nowSec) {
  const ws = workStartSec;
  const we = workEndSec;
  const workWin = Math.max(0, we - ws);
  let insideSec = 0;
  let openStart = null; // currently-open inside interval start sec

  for (const ev of events) {
    if (ev.tipo === 'entrada') {
      if (openStart === null) openStart = ev.time_sec;
      // else duplicate entrada, ignore
    } else if (ev.tipo === 'salida') {
      if (openStart !== null) {
        const a = Math.max(openStart, ws);
        const b = Math.min(ev.time_sec, we);
        if (b > a) insideSec += b - a;
        openStart = null;
      }
      // salida without prior entrada: ignore
    }
  }
  // Open interval at end of day: cap at work_end (or now if today).
  if (openStart !== null) {
    const endCap = isToday ? Math.min(nowSec, we) : we;
    const a = Math.max(openStart, ws);
    const b = Math.min(endCap, we);
    if (b > a) insideSec += b - a;
  }

  const outsideSec = Math.max(0, workWin - insideSec);
  return { inside_sec: insideSec, outside_sec: outsideSec, work_win_sec: workWin };
}



// ── Prepared statements (lazy init) ───────────────────────────
let S = null;
function stmts() {
  if (S) return S;
  const db = getDb();
  const eventCols = `
    e.id, e.timestamp, e.tipo, e.motivo_tipo, e.motivo_detalle,
    emp.numero_empleado, emp.nombre AS emp_nombre, emp.apellidos AS emp_apellidos,
    u.username AS registrado_por_username
  `;
  S = {
    asistenciaDiaFecha: db.prepare(`
      SELECT ${eventCols}
      FROM registro_eventos e
      JOIN empleados emp ON emp.id = e.empleado_id
      JOIN users u       ON u.id   = e.registrado_por
      WHERE date(e.timestamp, 'localtime') = ?
      ORDER BY e.timestamp ASC
    `),
    asistenciaDiaHoy: db.prepare(`
      SELECT ${eventCols}
      FROM registro_eventos e
      JOIN empleados emp ON emp.id = e.empleado_id
      JOIN users u       ON u.id   = e.registrado_por
      WHERE date(e.timestamp, 'localtime') = date('now', 'localtime')
      ORDER BY e.timestamp ASC
    `),
    empleadoById: db.prepare('SELECT * FROM empleados WHERE id = ?'),
    historialEventos: db.prepare(`
      SELECT
        e.id, e.timestamp, e.tipo, e.motivo_tipo, e.motivo_detalle,
        u.username AS registrado_por_username
      FROM registro_eventos e
      JOIN users u ON u.id = e.registrado_por
      WHERE e.empleado_id = ?
        AND date(e.timestamp, 'localtime') BETWEEN ? AND ?
      ORDER BY e.timestamp ASC
    `),
    salidasPorMotivoRango: db.prepare(`
      SELECT
        COALESCE(motivo_tipo, '(sin motivo)') AS motivo,
        COUNT(*) AS total
      FROM registro_eventos
      WHERE tipo = 'salida'
        AND date(timestamp, 'localtime') BETWEEN ? AND ?
      GROUP BY motivo
      ORDER BY total DESC, motivo ASC
    `),
    eventosRangoActivos: db.prepare(`
      SELECT
        e.empleado_id,
        date(e.timestamp, 'localtime') AS local_date,
        CAST(strftime('%H', e.timestamp, 'localtime') AS INTEGER) * 3600 +
        CAST(strftime('%M', e.timestamp, 'localtime') AS INTEGER) * 60 +
        CAST(strftime('%S', e.timestamp, 'localtime') AS INTEGER) AS local_sec,
        e.tipo
      FROM registro_eventos e
      JOIN empleados emp ON emp.id = e.empleado_id
      WHERE date(e.timestamp, 'localtime') BETWEEN ? AND ?
        AND emp.estatus = 'activo'
      ORDER BY e.empleado_id, e.timestamp ASC
    `),
    empleadosActivos: db.prepare(`
      SELECT id, numero_empleado, nombre, apellidos
      FROM empleados WHERE estatus = 'activo'
      ORDER BY apellidos, nombre
    `),
    eventosEmpleadoRango: db.prepare(`
      SELECT
        date(timestamp, 'localtime') AS local_date,
        CAST(strftime('%H', timestamp, 'localtime') AS INTEGER) * 3600 +
        CAST(strftime('%M', timestamp, 'localtime') AS INTEGER) * 60 +
        CAST(strftime('%S', timestamp, 'localtime') AS INTEGER) AS local_sec,
        strftime('%H:%M', timestamp, 'localtime') AS local_hhmm,
        tipo, motivo_tipo
      FROM registro_eventos
      WHERE empleado_id = ?
        AND date(timestamp, 'localtime') BETWEEN ? AND ?
      ORDER BY timestamp ASC
    `),
  };
  return S;
}

// fecha: 'YYYY-MM-DD' (local). Si no se pasa, usa hoy local.
function asistenciaDia(fecha) {
  const s = stmts();
  const f = (fecha || '').trim();
  return f ? s.asistenciaDiaFecha.all(f) : s.asistenciaDiaHoy.all();
}

function historialEmpleado(empleadoId, fechaIni, fechaFin) {
  if (!empleadoId) return { ok: false, error: 'Selecciona un empleado' };
  const ini = (fechaIni || '').trim();
  const fin = (fechaFin || '').trim();
  if (!ini || !fin) return { ok: false, error: 'Selecciona rango de fechas' };
  if (ini > fin) return { ok: false, error: 'La fecha inicial debe ser anterior o igual a la final' };

  const s = stmts();
  const emp = s.empleadoById.get(empleadoId);
  if (!emp) return { ok: false, error: 'Empleado no encontrado' };

  const eventos = s.historialEventos.all(empleadoId, ini, fin);

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

  const rows = stmts().salidasPorMotivoRango.all(ini, fin);

  const total = rows.reduce((sum, r) => sum + r.total, 0);
  return { ok: true, rango: { ini, fin }, rows, total };
}

// ── Horas dentro/fuera ────────────────────────────────────────
// Summary across all active empleados over a date range.
function horasDentroFuera(fechaIni, fechaFin) {
  const ini = (fechaIni || '').trim();
  const fin = (fechaFin || '').trim();
  if (!ini || !fin) return { ok: false, error: 'Selecciona rango de fechas' };
  if (ini > fin) return { ok: false, error: 'La fecha inicial debe ser anterior o igual a la final' };

  const schedule = configLib.getWorkSchedule();
  const ws = timeToSec(schedule.work_start);
  const we = timeToSec(schedule.work_end);
  const workWin = Math.max(0, we - ws);
  const workdays = enumerateWorkdays(ini, fin, schedule.work_days);
  const todayIso = todayLocalIso();
  const nowSec = nowLocalSec();

  const s = stmts();
  const rows = s.eventosRangoActivos.all(ini, fin);

  // group: empleado_id -> Map<date, events[]>
  const byEmp = new Map();
  for (const r of rows) {
    let m = byEmp.get(r.empleado_id);
    if (!m) { m = new Map(); byEmp.set(r.empleado_id, m); }
    let arr = m.get(r.local_date);
    if (!arr) { arr = []; m.set(r.local_date, arr); }
    arr.push({ time_sec: r.local_sec, tipo: r.tipo });
  }

  // Include all active empleados even with zero activity
  const activos = s.empleadosActivos.all();

  const result = activos.map((emp) => {
    const days = byEmp.get(emp.id) || new Map();
    let totalInside = 0;
    let totalOutside = 0;
    let diasConActividad = 0;
    for (const date of workdays) {
      const events = days.get(date);
      if (!events || events.length === 0) continue;
      const s = computeDayStats(events, ws, we, date === todayIso, nowSec);
      totalInside += s.inside_sec;
      totalOutside += s.outside_sec;
      diasConActividad += 1;
    }
    const totalHorario = diasConActividad * workWin;
    const pct = totalHorario > 0 ? (totalInside / totalHorario) * 100 : 0;
    return {
      empleado_id: emp.id,
      numero_empleado: emp.numero_empleado,
      nombre: emp.nombre,
      apellidos: emp.apellidos,
      dias_laborables: workdays.length,
      dias_con_actividad: diasConActividad,
      dias_ausente: workdays.length - diasConActividad,
      inside_sec: totalInside,
      outside_sec: totalOutside,
      total_horario_sec: totalHorario,
      pct_cumplimiento: pct,
    };
  });

  // Sort: highest inside first, ties by name
  result.sort((a, b) => b.inside_sec - a.inside_sec || a.apellidos.localeCompare(b.apellidos));

  return {
    ok: true,
    rango: { ini, fin },
    schedule: {
      work_start: schedule.work_start,
      work_end: schedule.work_end,
      work_days: schedule.work_days,
      work_window_sec: workWin,
    },
    dias_laborables: workdays.length,
    rows: result,
  };
}

// Detail day-by-day for a single empleado.
function horasDentroFueraEmpleado(empleadoId, fechaIni, fechaFin) {
  if (!empleadoId) return { ok: false, error: 'Selecciona un empleado' };
  const ini = (fechaIni || '').trim();
  const fin = (fechaFin || '').trim();
  if (!ini || !fin) return { ok: false, error: 'Selecciona rango de fechas' };
  if (ini > fin) return { ok: false, error: 'La fecha inicial debe ser anterior o igual a la final' };

  const s = stmts();
  const emp = s.empleadoById.get(empleadoId);
  if (!emp) return { ok: false, error: 'Empleado no encontrado' };

  const schedule = configLib.getWorkSchedule();
  const ws = timeToSec(schedule.work_start);
  const we = timeToSec(schedule.work_end);
  const workWin = Math.max(0, we - ws);
  const workdays = enumerateWorkdays(ini, fin, schedule.work_days);
  const todayIso = todayLocalIso();
  const nowSec = nowLocalSec();

  const rows = s.eventosEmpleadoRango.all(empleadoId, ini, fin);

  const byDate = new Map();
  for (const r of rows) {
    let arr = byDate.get(r.local_date);
    if (!arr) { arr = []; byDate.set(r.local_date, arr); }
    arr.push(r);
  }

  let totalInside = 0;
  let totalOutside = 0;
  const days = workdays.map((date) => {
    const evs = byDate.get(date) || [];
    if (!evs.length) {
      return { date, ausente: true, events: [], inside_sec: 0, outside_sec: 0, pct: 0 };
    }
    const s = computeDayStats(
      evs.map((e) => ({ time_sec: e.local_sec, tipo: e.tipo })),
      ws, we, date === todayIso, nowSec
    );
    totalInside += s.inside_sec;
    totalOutside += s.outside_sec;
    return {
      date,
      ausente: false,
      events: evs.map((e) => ({ time: e.local_hhmm, tipo: e.tipo, motivo: e.motivo_tipo || null })),
      inside_sec: s.inside_sec,
      outside_sec: s.outside_sec,
      pct: workWin > 0 ? (s.inside_sec / workWin) * 100 : 0,
    };
  });

  const diasConActividad = days.filter((d) => !d.ausente).length;

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
    schedule: {
      work_start: schedule.work_start,
      work_end: schedule.work_end,
      work_days: schedule.work_days,
      work_window_sec: workWin,
    },
    days,
    total_inside_sec: totalInside,
    total_outside_sec: totalOutside,
    dias_laborables: workdays.length,
    dias_con_actividad: diasConActividad,
    dias_ausente: workdays.length - diasConActividad,
  };
}

module.exports = {
  asistenciaDia,
  historialEmpleado,
  salidasPorMotivo,
  horasDentroFuera,
  horasDentroFueraEmpleado,
};
