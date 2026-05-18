const { getDb } = require('./db');

// Catálogos conocidos. Validamos contra esta lista para impedir que el cliente
// invente nombres arbitrarios de catálogo.
const KNOWN_CATALOGOS = new Set(['motivos', 'inasistencia_motivos']);

let S = null;
function stmts() {
  if (S) return S;
  const db = getDb();
  S = {
    listActive: db.prepare(`
      SELECT id, valor, estatus, orden FROM catalogo_items
      WHERE catalogo = ? AND estatus = 'activo'
      ORDER BY orden ASC, valor ASC
    `),
    listAll: db.prepare(`
      SELECT id, valor, estatus, orden FROM catalogo_items
      WHERE catalogo = ?
      ORDER BY orden ASC, valor ASC
    `),
    findByValor: db.prepare('SELECT * FROM catalogo_items WHERE catalogo = ? AND valor = ?'),
    findById: db.prepare('SELECT * FROM catalogo_items WHERE id = ?'),
    reactivate: db.prepare("UPDATE catalogo_items SET estatus = 'activo' WHERE id = ?"),
    maxOrden: db.prepare('SELECT COALESCE(MAX(orden), -1) AS m FROM catalogo_items WHERE catalogo = ?'),
    insert: db.prepare('INSERT INTO catalogo_items (catalogo, valor, orden) VALUES (?, ?, ?)'),
    selectAfterInsert: db.prepare('SELECT id, valor, estatus, orden FROM catalogo_items WHERE id = ?'),
    updateValor: db.prepare('UPDATE catalogo_items SET valor = ? WHERE id = ?'),
    updateEstatus: db.prepare('UPDATE catalogo_items SET estatus = ? WHERE id = ?'),
    delete: db.prepare('DELETE FROM catalogo_items WHERE id = ?'),
  };
  return S;
}

function normalize(s) {
  return String(s ?? '').trim();
}

function assertCatalogo(catalogo) {
  if (!KNOWN_CATALOGOS.has(catalogo)) {
    return 'Catálogo no válido';
  }
  return null;
}

function listItems(catalogo, { activeOnly = true } = {}) {
  if (assertCatalogo(catalogo)) return [];
  const s = stmts();
  return (activeOnly ? s.listActive : s.listAll).all(catalogo);
}

function findItem(catalogo, valor) {
  if (assertCatalogo(catalogo)) return null;
  return stmts().findByValor.get(catalogo, normalize(valor)) || null;
}

function isActiveValue(catalogo, valor) {
  const row = findItem(catalogo, valor);
  return !!(row && row.estatus === 'activo');
}

function addItem(catalogo, valor) {
  const catErr = assertCatalogo(catalogo);
  if (catErr) return { ok: false, error: catErr };

  const v = normalize(valor);
  if (!v) return { ok: false, error: 'El nombre es obligatorio' };
  if (v.length > 64) return { ok: false, error: 'Nombre demasiado largo (máx 64)' };

  const s = stmts();
  // Reactivate if it exists but is inactive.
  const existing = findItem(catalogo, v);
  if (existing) {
    if (existing.estatus === 'activo') {
      return { ok: false, error: 'Ese valor ya existe' };
    }
    s.reactivate.run(existing.id);
    return { ok: true, item: { ...existing, estatus: 'activo' } };
  }

  // New item: append at the end of order.
  const maxOrden = s.maxOrden.get(catalogo).m;
  const info = s.insert.run(catalogo, v, maxOrden + 1);
  const item = s.selectAfterInsert.get(info.lastInsertRowid);
  return { ok: true, item };
}

function findItemById(id) {
  return stmts().findById.get(id) || null;
}

function updateItem(id, valor) {
  const target = findItemById(id);
  if (!target) return { ok: false, error: 'Elemento no encontrado' };

  const v = normalize(valor);
  if (!v) return { ok: false, error: 'El nombre es obligatorio' };
  if (v.length > 64) return { ok: false, error: 'Nombre demasiado largo (máx 64)' };

  if (v !== target.valor) {
    const conflict = findItem(target.catalogo, v);
    if (conflict && conflict.id !== target.id) {
      return { ok: false, error: 'Ese valor ya existe en el catálogo' };
    }
  }

  stmts().updateValor.run(v, target.id);
  return { ok: true, item: findItemById(target.id) };
}

function setItemEstatus(id, estatus) {
  if (estatus !== 'activo' && estatus !== 'inactivo') {
    return { ok: false, error: 'Estatus inválido' };
  }
  const target = findItemById(id);
  if (!target) return { ok: false, error: 'Elemento no encontrado' };

  stmts().updateEstatus.run(estatus, target.id);
  return { ok: true, item: findItemById(target.id) };
}

function deleteItem(id) {
  const target = findItemById(id);
  if (!target) return { ok: false, error: 'Elemento no encontrado' };
  // Hard delete. Historical references (e.g. registro_eventos.salida_tipo) store
  // the literal text value, not an FK, so deleting doesn't break audit history.
  stmts().delete.run(target.id);
  return { ok: true };
}

module.exports = {
  KNOWN_CATALOGOS,
  listItems,
  findItem,
  findItemById,
  isActiveValue,
  addItem,
  updateItem,
  setItemEstatus,
  deleteItem,
};
