const { getDb } = require('./db');

function normalize(s) {
  return String(s ?? '').trim();
}

function validateNumero(numero) {
  const v = normalize(numero);
  if (!v) return 'El número de empleado es obligatorio';
  if (!/^[a-zA-Z0-9._-]+$/.test(v)) {
    return 'El número solo admite letras, números, punto, guion y guion bajo';
  }
  if (v.length > 32) return 'El número es demasiado largo';
  return null;
}

function findById(id) {
  return getDb().prepare('SELECT * FROM empleados WHERE id = ?').get(id);
}

function findByNumero(numero) {
  return getDb().prepare('SELECT * FROM empleados WHERE numero_empleado = ?').get(numero);
}

function nextNumeroEmpleado() {
  const rows = getDb().prepare('SELECT numero_empleado FROM empleados').all();
  let max = 0;
  for (const r of rows) {
    const v = String(r.numero_empleado);
    if (/^\d+$/.test(v)) {
      const n = parseInt(v, 10);
      if (n > max) max = n;
    }
  }
  return String(max + 1).padStart(3, '0');
}

function publicEmpleado(row) {
  if (!row) return null;
  return {
    id: row.id,
    numero_empleado: row.numero_empleado,
    nombre: row.nombre,
    apellidos: row.apellidos,
    puesto: row.puesto || '',
    departamento: row.departamento || '',
    estatus: row.estatus,
    fecha_creacion: row.fecha_creacion,
    fecha_modificacion: row.fecha_modificacion,
  };
}

function listEmpleados() {
  const rows = getDb()
    .prepare(`
      SELECT * FROM empleados
      ORDER BY estatus ASC, numero_empleado ASC
    `)
    .all();
  return rows.map(publicEmpleado);
}

function searchActiveEmpleados(query, limit = 8) {
  const q = normalize(query);
  if (!q) return [];
  const like = `%${q}%`;
  const rows = getDb()
    .prepare(`
      SELECT * FROM empleados
      WHERE estatus = 'activo'
        AND (
          numero_empleado LIKE ?
          OR (nombre || ' ' || apellidos) LIKE ?
          OR nombre LIKE ?
          OR apellidos LIKE ?
        )
      ORDER BY numero_empleado ASC
      LIMIT ?
    `)
    .all(like, like, like, like, limit);
  return rows.map(publicEmpleado);
}

function createEmpleado({ numero_empleado, nombre, apellidos, puesto, departamento }) {
  // numero_empleado is auto-generated when not provided.
  const numero = normalize(numero_empleado) || nextNumeroEmpleado();
  const nom = normalize(nombre);
  const ape = normalize(apellidos);
  const pue = normalize(puesto);
  const dep = normalize(departamento);

  if (!nom || !ape) {
    return { ok: false, error: 'Nombre y apellidos son obligatorios' };
  }
  const numErr = validateNumero(numero);
  if (numErr) return { ok: false, error: numErr };
  if (findByNumero(numero)) {
    return { ok: false, error: 'Ese número de empleado ya está en uso' };
  }

  const info = getDb()
    .prepare(`
      INSERT INTO empleados (numero_empleado, nombre, apellidos, puesto, departamento, estatus)
      VALUES (?, ?, ?, ?, ?, 'activo')
    `)
    .run(numero, nom, ape, pue, dep);

  return { ok: true, empleado: publicEmpleado(findById(info.lastInsertRowid)) };
}

function updateEmpleado(id, { numero_empleado, nombre, apellidos, puesto, departamento }) {
  const target = findById(id);
  if (!target) return { ok: false, error: 'Empleado no encontrado' };

  const numero = normalize(numero_empleado);
  const nom = normalize(nombre);
  const ape = normalize(apellidos);
  const pue = normalize(puesto);
  const dep = normalize(departamento);

  if (!nom || !ape) {
    return { ok: false, error: 'Nombre y apellidos son obligatorios' };
  }
  const numErr = validateNumero(numero);
  if (numErr) return { ok: false, error: numErr };

  if (numero !== target.numero_empleado) {
    const conflict = findByNumero(numero);
    if (conflict && conflict.id !== target.id) {
      return { ok: false, error: 'Ese número de empleado ya está en uso' };
    }
  }

  getDb()
    .prepare(`
      UPDATE empleados
      SET numero_empleado = ?, nombre = ?, apellidos = ?, puesto = ?, departamento = ?
      WHERE id = ?
    `)
    .run(numero, nom, ape, pue, dep, target.id);

  return { ok: true, empleado: publicEmpleado(findById(target.id)) };
}

function setEmpleadoEstatus(id, estatus) {
  if (estatus !== 'activo' && estatus !== 'inactivo') {
    return { ok: false, error: 'Estatus inválido' };
  }
  const target = findById(id);
  if (!target) return { ok: false, error: 'Empleado no encontrado' };

  getDb().prepare('UPDATE empleados SET estatus = ? WHERE id = ?').run(estatus, target.id);
  return { ok: true, empleado: publicEmpleado(findById(target.id)) };
}

module.exports = {
  listEmpleados,
  searchActiveEmpleados,
  findById,
  createEmpleado,
  updateEmpleado,
  setEmpleadoEstatus,
  publicEmpleado,
  nextNumeroEmpleado,
};
