const { ipcMain, BrowserWindow } = require('electron');
const auth = require('./auth');
const empleados = require('./empleados');
const registro = require('./registro');
const catalogos = require('./catalogos');
const reportes = require('./reportes');
const exportsLib = require('./exports');
const dashboardLib = require('./dashboard');

const VIEW_SIZES = {
  login: { width: 460, height: 640, resizable: false },
  setup: { width: 560, height: 680, resizable: true },
  dashboard: { width: 1280, height: 800, resizable: true, maximize: true },
};

function safe(fn) {
  return async (event, ...args) => {
    try {
      return await fn(event, ...args);
    } catch (err) {
      console.error('[ipc] error:', err);
      return { ok: false, error: 'Error interno' };
    }
  };
}

function requirePerm(perm, fn) {
  return safe(async (event, ...args) => {
    const u = auth.getCurrentUser();
    if (!u) return { ok: false, error: 'No autenticado' };
    if (!auth.hasPermission(u.id, perm)) return { ok: false, error: 'Sin permisos' };
    return fn(event, ...args);
  });
}

// Wrap a handler with perm + extra password re-check against the current user.
// The first argument of the payload must contain a `password` field.
function requirePermAndPassword(perm, fn) {
  return safe(async (event, payload, ...rest) => {
    const u = auth.getCurrentUser();
    if (!u) return { ok: false, error: 'No autenticado' };
    if (!auth.hasPermission(u.id, perm)) return { ok: false, error: 'Sin permisos' };
    const password = (payload && payload.password) || '';
    const ok = await auth.verifyPassword(u.id, password);
    if (!ok) return { ok: false, error: 'Contraseña incorrecta' };
    // Strip password before passing through.
    const { password: _drop, ...rest1 } = payload || {};
    return fn(event, rest1, ...rest);
  });
}

function setView(event, view) {
  const size = VIEW_SIZES[view];
  if (!size) return { ok: false, error: 'Vista desconocida' };
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { ok: false, error: 'Ventana no disponible' };

  if (win.isMaximized() && !size.maximize) {
    win.unmaximize();
  }

  win.setResizable(true);
  win.setMaximizable(size.resizable);
  win.setContentSize(size.width, size.height);

  if (size.maximize) {
    win.maximize();
  } else {
    win.center();
    win.setResizable(size.resizable);
  }

  return { ok: true };
}

function registerIpc() {
  ipcMain.handle('auth:hasUsers', safe(async () => auth.hasUsers()));

  ipcMain.handle(
    'auth:createInitialUser',
    safe(async (_e, payload) => auth.createInitialUser(payload || {}))
  );

  ipcMain.handle(
    'auth:login',
    safe(async (_e, { username, password }) => auth.login(username, password))
  );

  ipcMain.handle('auth:logout', safe(async () => {
    auth.logout();
    return { ok: true };
  }));

  ipcMain.handle('auth:getCurrentUser', safe(async () => auth.getCurrentUser()));

  ipcMain.handle('auth:getLastUser', safe(async () => auth.getLastUser()));

  ipcMain.handle(
    'users:list',
    requirePerm('usuarios', async () => ({ ok: true, users: auth.listUsers() }))
  );

  ipcMain.handle(
    'users:create',
    requirePerm('usuarios', async (_e, payload) => auth.createUser(payload || {}))
  );

  ipcMain.handle(
    'users:update',
    requirePerm('usuarios', async (_e, payload) => {
      const { id, ...rest } = payload || {};
      return auth.updateUser(id, rest);
    })
  );

  ipcMain.handle(
    'users:setEstatus',
    requirePerm('usuarios', async (_e, { id, estatus } = {}) => auth.setUserEstatus(id, estatus))
  );

  ipcMain.handle(
    'permissions:listUsers',
    requirePerm('accesos', async () => ({ ok: true, users: auth.listUsers() }))
  );

  ipcMain.handle(
    'permissions:setForUser',
    requirePerm('accesos', async (_e, { id, permissions } = {}) =>
      auth.setUserPermissions(id, permissions)
    )
  );

  ipcMain.handle(
    'settings:set',
    safe(async (_e, payload) => auth.setUserSettings(payload || {}))
  );

  ipcMain.handle(
    'empleados:list',
    requirePerm('empleados', async () => ({ ok: true, empleados: empleados.listEmpleados() }))
  );

  ipcMain.handle(
    'empleados:searchActive',
    requirePerm('registro', async (_e, { query, limit } = {}) => ({
      ok: true,
      empleados: empleados.searchActiveEmpleados(query, limit),
    }))
  );

  ipcMain.handle(
    'empleados:create',
    requirePerm('empleados', async (_e, payload) => empleados.createEmpleado(payload || {}))
  );

  // Quick-add desde la pantalla de Registro: requiere solo permiso de 'registro'.
  ipcMain.handle(
    'empleados:quickCreate',
    requirePerm('registro', async (_e, payload) => empleados.createEmpleado(payload || {}))
  );

  ipcMain.handle(
    'empleados:update',
    requirePerm('empleados', async (_e, payload) => {
      const { id, ...rest } = payload || {};
      return empleados.updateEmpleado(id, rest);
    })
  );

  ipcMain.handle(
    'empleados:setEstatus',
    requirePerm('empleados', async (_e, { id, estatus } = {}) =>
      empleados.setEmpleadoEstatus(id, estatus)
    )
  );

  ipcMain.handle(
    'registro:getEmpleadoStatus',
    requirePerm('registro', async (_e, { id } = {}) => registro.getEmpleadoStatus(id))
  );

  ipcMain.handle(
    'registro:markEvent',
    requirePerm('registro', async (_e, { id, tipo, salida } = {}) => {
      const u = auth.getCurrentUser();
      return registro.markEvent(id, u.id, tipo, salida);
    })
  );

  ipcMain.handle(
    'registro:listToday',
    requirePerm('registro', async () => ({ ok: true, eventos: registro.listTodayEvents() }))
  );

  ipcMain.handle(
    'registro:updateEvent',
    requirePermAndPassword('registro', async (_e, { id, payload } = {}) =>
      registro.updateEvent(id, payload || {})
    )
  );

  ipcMain.handle(
    'registro:deleteEvent',
    requirePermAndPassword('registro', async (_e, { id } = {}) =>
      registro.deleteEvent(id)
    )
  );

  ipcMain.handle(
    'catalogos:list',
    requirePerm('registro', async (_e, { catalogo, activeOnly } = {}) => ({
      ok: true,
      items: catalogos.listItems(catalogo, { activeOnly: activeOnly !== false }),
    }))
  );

  ipcMain.handle(
    'catalogos:addItem',
    requirePerm('registro', async (_e, { catalogo, valor } = {}) =>
      catalogos.addItem(catalogo, valor)
    )
  );

  ipcMain.handle(
    'catalogos:listAll',
    requirePerm('catalogos', async (_e, { catalogo } = {}) => ({
      ok: true,
      items: catalogos.listItems(catalogo, { activeOnly: false }),
    }))
  );

  ipcMain.handle(
    'catalogos:updateItem',
    requirePerm('catalogos', async (_e, { id, valor } = {}) =>
      catalogos.updateItem(id, valor)
    )
  );

  ipcMain.handle(
    'catalogos:setItemEstatus',
    requirePerm('catalogos', async (_e, { id, estatus } = {}) =>
      catalogos.setItemEstatus(id, estatus)
    )
  );

  ipcMain.handle(
    'catalogos:deleteItem',
    requirePerm('catalogos', async (_e, { id } = {}) => catalogos.deleteItem(id))
  );

  ipcMain.handle(
    'reportes:asistenciaDia',
    requirePerm('reportes', async (_e, { fecha } = {}) => ({
      ok: true,
      eventos: reportes.asistenciaDia(fecha),
    }))
  );

  ipcMain.handle(
    'reportes:historial',
    requirePerm('reportes', async (_e, { empleadoId, ini, fin } = {}) =>
      reportes.historialEmpleado(empleadoId, ini, fin)
    )
  );

  ipcMain.handle(
    'reportes:salidasMotivo',
    requirePerm('reportes', async (_e, { ini, fin } = {}) =>
      reportes.salidasPorMotivo(ini, fin)
    )
  );

  ipcMain.handle(
    'reportes:exportExcel',
    requirePerm('reportes', async (event, payload) =>
      exportsLib.exportExcel(event.sender, payload || {})
    )
  );

  ipcMain.handle(
    'reportes:exportPdf',
    requirePerm('reportes', async (event, payload) =>
      exportsLib.exportPdf(event.sender, payload || {})
    )
  );

  // Listar empleados activos para selector de reportes (no requiere CRUD).
  ipcMain.handle(
    'reportes:listEmpleados',
    requirePerm('reportes', async () => ({
      ok: true,
      empleados: empleados.listEmpleados().filter((e) => e.estatus === 'activo'),
    }))
  );

  ipcMain.handle(
    'dashboard:stats',
    safe(async () => {
      const u = auth.getCurrentUser();
      if (!u) return { ok: false, error: 'No autenticado' };
      return { ok: true, stats: dashboardLib.getStats() };
    })
  );

  ipcMain.handle('window:setView', safe(async (event, view) => setView(event, view)));
}

module.exports = { registerIpc, VIEW_SIZES };
