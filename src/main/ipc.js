const { ipcMain, BrowserWindow } = require('electron');
const auth = require('./auth');
const empleados = require('./empleados');
const registro = require('./registro');
const catalogos = require('./catalogos');
const reportes = require('./reportes');
const exportsLib = require('./exports');
const dashboardLib = require('./dashboard');
const configuracionLib = require('./configuracion');
const auditLib = require('./audit');
const logger = require('./logger');
const updater = require('./updater');

// Convenience: append an audit entry tagged with the current user as actor.
function auditAction(action, info = {}) {
  const u = auth.getCurrentUser();
  auditLib.log({
    user_id: u?.id ?? null,
    username: u?.username || 'anon',
    action,
    ...info,
  });
}

const VIEW_SIZES = {
  login: { width: 460, height: 640, resizable: false },
  setup: { width: 560, height: 680, resizable: true, minWidth: 480, minHeight: 600 },
  dashboard: { width: 1280, height: 800, resizable: true, maximize: true, minWidth: 800, minHeight: 600 },
};

function safe(fn) {
  return async (event, ...args) => {
    try {
      return await fn(event, ...args);
    } catch (err) {
      logger.error('ipc', err);
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
    if (!ok) {
      auditAction('auth.reauth_fail', {
        entity_type: 'user',
        entity_id: u.id,
        details: { perm },
      });
      return { ok: false, error: 'Contraseña incorrecta' };
    }
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
  // Ajustar el mínimo antes del setContentSize para que la nueva vista
  // no quede bloqueada por el mínimo de la vista previa.
  win.setMinimumSize(size.minWidth ?? size.width, size.minHeight ?? size.height);
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
    safe(async (_e, payload) => {
      const r = await auth.createInitialUser(payload || {});
      if (r?.ok && r.user) {
        // 'auditAction' would use current user but currentUser is now this new one.
        auditLib.log({
          user_id: r.user.id,
          username: r.user.username,
          action: 'auth.setup_initial_user',
          entity_type: 'user',
          entity_id: r.user.id,
          entity_label: `${r.user.username} (${r.user.nombre} ${r.user.apellidos})`,
        });
      }
      return r;
    })
  );

  ipcMain.handle(
    'auth:login',
    safe(async (_e, { username, password } = {}) => {
      const r = await auth.login(username, password);
      if (r?.ok && r.user) {
        auditLib.log({
          user_id: r.user.id,
          username: r.user.username,
          action: 'auth.login',
          entity_type: 'user',
          entity_id: r.user.id,
        });
      } else {
        const attempted = String(username || '').trim() || 'anon';
        auditLib.log({
          user_id: null,
          username: attempted,
          action: 'auth.login_fail',
          details: { attempted_username: attempted, reason: r?.error || 'unknown' },
        });
      }
      return r;
    })
  );

  ipcMain.handle('auth:logout', safe(async () => {
    const before = auth.getCurrentUser();
    if (before) {
      auditLib.log({
        user_id: before.id,
        username: before.username,
        action: 'auth.logout',
        entity_type: 'user',
        entity_id: before.id,
      });
    }
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
    requirePerm('usuarios', async (_e, payload) => {
      const r = await auth.createUser(payload || {});
      if (r?.ok && r.user) {
        auditAction('user.create', {
          entity_type: 'user',
          entity_id: r.user.id,
          entity_label: `${r.user.username} (${r.user.nombre} ${r.user.apellidos})`,
          details: {
            username: r.user.username, nombre: r.user.nombre, apellidos: r.user.apellidos,
          },
        });
      }
      return r;
    })
  );

  ipcMain.handle(
    'users:update',
    requirePerm('usuarios', async (_e, payload) => {
      const { id, ...rest } = payload || {};
      const r = await auth.updateUser(id, rest);
      if (r?.ok && r.user) {
        auditAction('user.update', {
          entity_type: 'user',
          entity_id: r.user.id,
          entity_label: `${r.user.username} (${r.user.nombre} ${r.user.apellidos})`,
          details: {
            username: r.user.username,
            nombre: r.user.nombre,
            apellidos: r.user.apellidos,
            password_changed: Boolean(rest?.password),
          },
        });
      }
      return r;
    })
  );

  ipcMain.handle(
    'users:setEstatus',
    requirePerm('usuarios', async (_e, { id, estatus } = {}) => {
      const r = auth.setUserEstatus(id, estatus);
      if (r?.ok && r.user) {
        auditAction('user.estatus_change', {
          entity_type: 'user',
          entity_id: r.user.id,
          entity_label: r.user.username,
          details: { estatus: r.user.estatus },
        });
      }
      return r;
    })
  );

  ipcMain.handle(
    'permissions:listUsers',
    requirePerm('accesos', async () => ({ ok: true, users: auth.listUsers() }))
  );

  ipcMain.handle(
    'permissions:setForUser',
    requirePerm('accesos', async (_e, { id, permissions } = {}) => {
      const r = auth.setUserPermissions(id, permissions);
      if (r?.ok && r.user) {
        auditAction('user.permissions_change', {
          entity_type: 'user',
          entity_id: r.user.id,
          entity_label: r.user.username,
          details: { permissions: r.user.permissions },
        });
      }
      return r;
    })
  );

  ipcMain.handle(
    'settings:set',
    safe(async (_e, payload) => {
      const r = auth.setUserSettings(payload || {});
      if (r?.ok && r.user) {
        auditAction('user.settings_change', {
          entity_type: 'user',
          entity_id: r.user.id,
          entity_label: r.user.username,
          details: { theme: r.user.theme, accent: r.user.accent },
        });
      }
      return r;
    })
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
    requirePerm('empleados', async (_e, payload) => {
      const r = empleados.createEmpleado(payload || {});
      if (r?.ok && r.empleado) {
        const e = r.empleado;
        auditAction('empleado.create', {
          entity_type: 'empleado',
          entity_id: e.id,
          entity_label: `#${e.numero_empleado} ${e.nombre} ${e.apellidos}`,
          details: {
            numero: e.numero_empleado, nombre: e.nombre, apellidos: e.apellidos,
            puesto: e.puesto, departamento: e.departamento,
          },
        });
      }
      return r;
    })
  );

  // Quick-add desde la pantalla de Registro: requiere solo permiso de 'registro'.
  ipcMain.handle(
    'empleados:quickCreate',
    requirePerm('registro', async (_e, payload) => {
      const r = empleados.createEmpleado(payload || {});
      if (r?.ok && r.empleado) {
        const e = r.empleado;
        auditAction('empleado.create', {
          entity_type: 'empleado',
          entity_id: e.id,
          entity_label: `#${e.numero_empleado} ${e.nombre} ${e.apellidos}`,
          details: { quick: true, numero: e.numero_empleado, nombre: e.nombre, apellidos: e.apellidos },
        });
      }
      return r;
    })
  );

  ipcMain.handle(
    'empleados:update',
    requirePerm('empleados', async (_e, payload) => {
      const { id, ...rest } = payload || {};
      const r = empleados.updateEmpleado(id, rest);
      if (r?.ok && r.empleado) {
        const e = r.empleado;
        auditAction('empleado.update', {
          entity_type: 'empleado',
          entity_id: e.id,
          entity_label: `#${e.numero_empleado} ${e.nombre} ${e.apellidos}`,
          details: {
            numero: e.numero_empleado, nombre: e.nombre, apellidos: e.apellidos,
            puesto: e.puesto, departamento: e.departamento,
          },
        });
      }
      return r;
    })
  );

  ipcMain.handle(
    'empleados:setEstatus',
    requirePerm('empleados', async (_e, { id, estatus } = {}) => {
      const r = empleados.setEmpleadoEstatus(id, estatus);
      if (r?.ok && r.empleado) {
        const e = r.empleado;
        auditAction('empleado.estatus_change', {
          entity_type: 'empleado',
          entity_id: e.id,
          entity_label: `#${e.numero_empleado} ${e.nombre} ${e.apellidos}`,
          details: { estatus: e.estatus },
        });
      }
      return r;
    })
  );

  ipcMain.handle(
    'registro:getEmpleadoStatus',
    requirePerm('registro', async (_e, { id } = {}) => registro.getEmpleadoStatus(id))
  );

  ipcMain.handle(
    'registro:markEvent',
    requirePerm('registro', async (_e, { id, tipo, salida, timestamp } = {}) => {
      const u = auth.getCurrentUser();
      const r = registro.markEvent(id, u.id, tipo, salida, timestamp);
      if (r?.ok && r.evento) {
        const ev = r.evento;
        const emp = r.empleado;
        auditAction('evento.create', {
          entity_type: 'evento',
          entity_id: ev.id,
          entity_label: `${ev.tipo} #${emp?.numero_empleado || ev.empleado_id}`,
          details: {
            empleado_id: ev.empleado_id,
            empleado: emp ? `${emp.nombre} ${emp.apellidos}` : null,
            tipo: ev.tipo,
            timestamp: ev.timestamp,
            motivo_tipo: ev.motivo_tipo,
            motivo_detalle: ev.motivo_detalle,
          },
        });
      }
      return r;
    })
  );

  ipcMain.handle(
    'registro:listToday',
    requirePerm('registro', async () => ({ ok: true, eventos: registro.listTodayEvents() }))
  );

  ipcMain.handle(
    'registro:updateEvent',
    requirePermAndPassword('registro', async (_e, { id, payload } = {}) => {
      const before = registro.findEventById(id);
      const r = registro.updateEvent(id, payload || {});
      if (r?.ok && r.evento) {
        const after = r.evento;
        auditAction('evento.update', {
          entity_type: 'evento',
          entity_id: after.id,
          entity_label: `${after.tipo} · empleado #${after.empleado_id}`,
          details: {
            before: before ? {
              tipo: before.tipo, timestamp: before.timestamp,
              motivo_tipo: before.motivo_tipo, motivo_detalle: before.motivo_detalle,
            } : null,
            after: {
              tipo: after.tipo, timestamp: after.timestamp,
              motivo_tipo: after.motivo_tipo, motivo_detalle: after.motivo_detalle,
            },
          },
        });
      }
      return r;
    })
  );

  ipcMain.handle(
    'registro:deleteEvent',
    requirePermAndPassword('registro', async (_e, { id } = {}) => {
      const before = registro.findEventById(id);
      const r = registro.deleteEvent(id);
      if (r?.ok && before) {
        auditAction('evento.delete', {
          entity_type: 'evento',
          entity_id: before.id,
          entity_label: `${before.tipo} · empleado #${before.empleado_id}`,
          details: {
            empleado_id: before.empleado_id,
            tipo: before.tipo,
            timestamp: before.timestamp,
            motivo_tipo: before.motivo_tipo,
            motivo_detalle: before.motivo_detalle,
          },
        });
      }
      return r;
    })
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
    requirePerm('registro', async (_e, { catalogo, valor } = {}) => {
      const r = catalogos.addItem(catalogo, valor);
      if (r?.ok && r.item) {
        auditAction('catalogo.create', {
          entity_type: 'catalogo',
          entity_id: r.item.id,
          entity_label: `${catalogo}:${r.item.valor}`,
          details: { catalogo, valor: r.item.valor, from_registro_quick_add: true },
        });
      }
      return r;
    })
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
    requirePerm('catalogos', async (_e, { id, valor } = {}) => {
      const before = catalogos.findItemById(id);
      const r = catalogos.updateItem(id, valor);
      if (r?.ok && r.item) {
        auditAction('catalogo.update', {
          entity_type: 'catalogo',
          entity_id: r.item.id,
          entity_label: `${r.item.catalogo}:${r.item.valor}`,
          details: {
            catalogo: r.item.catalogo,
            before: before?.valor || null,
            after: r.item.valor,
          },
        });
      }
      return r;
    })
  );

  ipcMain.handle(
    'catalogos:setItemEstatus',
    requirePerm('catalogos', async (_e, { id, estatus } = {}) => {
      const r = catalogos.setItemEstatus(id, estatus);
      if (r?.ok && r.item) {
        auditAction('catalogo.estatus_change', {
          entity_type: 'catalogo',
          entity_id: r.item.id,
          entity_label: `${r.item.catalogo}:${r.item.valor}`,
          details: { estatus: r.item.estatus },
        });
      }
      return r;
    })
  );

  ipcMain.handle(
    'catalogos:deleteItem',
    requirePerm('catalogos', async (_e, { id } = {}) => {
      const before = catalogos.findItemById(id);
      const r = catalogos.deleteItem(id);
      if (r?.ok && before) {
        auditAction('catalogo.delete', {
          entity_type: 'catalogo',
          entity_id: before.id,
          entity_label: `${before.catalogo}:${before.valor}`,
          details: { catalogo: before.catalogo, valor: before.valor },
        });
      }
      return r;
    })
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
    'reportes:horasDentroFuera',
    requirePerm('reportes', async (_e, { ini, fin } = {}) =>
      reportes.horasDentroFuera(ini, fin)
    )
  );

  ipcMain.handle(
    'reportes:horasDentroFueraEmpleado',
    requirePerm('reportes', async (_e, { empleadoId, ini, fin } = {}) =>
      reportes.horasDentroFueraEmpleado(empleadoId, ini, fin)
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
    safe(async (_e, { range } = {}) => {
      const u = auth.getCurrentUser();
      if (!u) return { ok: false, error: 'No autenticado' };
      return { ok: true, stats: dashboardLib.getStats(range) };
    })
  );

  // Configuración general (horario laboral)
  // Anyone authenticated can READ the work schedule (needed by reports).
  ipcMain.handle(
    'configuracion:getWorkSchedule',
    safe(async () => {
      const u = auth.getCurrentUser();
      if (!u) return { ok: false, error: 'No autenticado' };
      return { ok: true, schedule: configuracionLib.getWorkSchedule() };
    })
  );
  // Only admins (usuarios permission) can change it.
  ipcMain.handle(
    'configuracion:setWorkSchedule',
    requirePerm('usuarios', async (_e, payload) => {
      const before = configuracionLib.getWorkSchedule();
      const r = configuracionLib.setWorkSchedule(payload || {});
      if (r?.ok && r.schedule) {
        auditAction('config.work_schedule_update', {
          entity_type: 'app_settings',
          entity_label: 'work_schedule',
          details: { before, after: r.schedule },
        });
      }
      return r;
    })
  );

  // Company name: read is public (login/setup screens need it pre-auth);
  // write requires admin (usuarios permission).
  ipcMain.handle(
    'configuracion:getCompanyName',
    safe(async () => ({ ok: true, ...configuracionLib.getCompanyNameInfo() }))
  );
  ipcMain.handle(
    'configuracion:setCompanyName',
    requirePerm('usuarios', async (_e, { name } = {}) => {
      const before = configuracionLib.getCompanyName();
      const r = configuracionLib.setCompanyName(name);
      if (r?.ok) {
        auditAction('config.company_name_update', {
          entity_type: 'app_settings',
          entity_label: 'company_name',
          details: { before, after: r.name, customized: r.customized },
        });
      }
      return r;
    })
  );

  // Company logo: read is public (used by login/setup); write/remove are admin.
  ipcMain.handle(
    'configuracion:getCompanyLogo',
    safe(async () => {
      const info = configuracionLib.getCompanyLogoInfo();
      const dataUrl = configuracionLib.getCompanyLogoDataUrl();
      return { ok: true, exists: info.exists, mime: info.mime || null, size: info.size || 0, dataUrl };
    })
  );
  ipcMain.handle(
    'configuracion:setCompanyLogo',
    requirePerm('usuarios', async (_e, payload = {}) => {
      const r = configuracionLib.setCompanyLogo(payload || {});
      if (r?.ok) {
        auditAction('config.company_logo_update', {
          entity_type: 'app_settings',
          entity_label: 'company_logo',
          details: { mime: r.mime, size_bytes: r.size },
        });
      }
      return r;
    })
  );
  ipcMain.handle(
    'configuracion:removeCompanyLogo',
    requirePerm('usuarios', async () => {
      const had = configuracionLib.getCompanyLogoInfo().exists;
      const r = configuracionLib.removeCompanyLogo();
      if (r?.ok && had) {
        auditAction('config.company_logo_remove', {
          entity_type: 'app_settings',
          entity_label: 'company_logo',
        });
      }
      return r;
    })
  );

  // Auditoría
  ipcMain.handle(
    'audit:list',
    requirePerm('auditoria', async (_e, opts = {}) => auditLib.listLog(opts || {}))
  );
  ipcMain.handle(
    'audit:listActions',
    requirePerm('auditoria', async () => ({ ok: true, actions: auditLib.listKnownActions() }))
  );
  ipcMain.handle(
    'audit:listUsers',
    requirePerm('auditoria', async () => ({ ok: true, users: auditLib.listKnownUsers() }))
  );

  ipcMain.handle('window:setView', safe(async (event, view) => setView(event, view)));

  // Información de la app y actualizaciones remotas.
  ipcMain.handle('app:getVersionInfo', safe(async () => ({ ok: true, info: updater.getVersionInfo() })));
  ipcMain.handle('app:checkForUpdates', safe(async () => updater.checkForUpdates()));
  ipcMain.handle('app:getDownloadedUpdate', safe(async () => ({ ok: true, update: updater.getDownloadedUpdate() })));
  ipcMain.handle('app:installUpdate', safe(async () => updater.quitAndInstall()));
}

module.exports = { registerIpc, VIEW_SIZES };
