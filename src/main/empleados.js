const { getDb } = require('./db');

let S = null;
function stmts() {
  if (S) return S;
  const db = getDb();
  S = {
    findById: db.prepare('SELECT * FROM empleados WHERE id = ?'),
    findByNumero: db.prepare('SELECT * FROM empleados WHERE numero_empleado = ?'),
    listNumeros: db.prepare('SELECT numero_empleado FROM empleados'),
    listAll: db.prepare(`
      SELECT * FROM empleados
      ORDER BY estatus ASC, numero_empleado ASC
    `),
    searchActive: db.prepare(`
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
    `),
    insert: db.prepare(`
      INSERT INTO empleados (numero_empleado, nombre, apellidos, puesto, departamento, estatus)
      VALUES (?, ?, ?, ?, ?, 'activo')
    `),
    update: db.prepare(`
      UPDATE empleados
      SET numero_empleado = ?, nombre = ?, apellidos = ?, puesto = ?, departamento = ?
      WHERE id = ?
    `),
    updateEstatus: db.prepare('UPDATE empleados SET estatus = ? WHERE id = ?'),
  };
  return S;
}

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
  return stmts().findById.get(id);
}

function findByNumero(numero) {
  return stmts().findByNumero.get(numero);
}

function nextNumeroEmpleado() {
  const rows = stmts().listNumeros.all();
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
  return stmts().listAll.all().map(publicEmpleado);
}

function searchActiveEmpleados(query, limit = 8) {
  const q = normalize(query);
  if (!q) return [];
  const like = `%${q}%`;
  return stmts().searchActive.all(like, like, like, like, limit).map(publicEmpleado);
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

  const info = stmts().insert.run(numero, nom, ape, pue, dep);

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

  stmts().update.run(numero, nom, ape, pue, dep, target.id);

  return { ok: true, empleado: publicEmpleado(findById(target.id)) };
}

function setEmpleadoEstatus(id, estatus) {
  if (estatus !== 'activo' && estatus !== 'inactivo') {
    return { ok: false, error: 'Estatus inválido' };
  }
  const target = findById(id);
  if (!target) return { ok: false, error: 'Empleado no encontrado' };

  stmts().updateEstatus.run(estatus, target.id);
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
