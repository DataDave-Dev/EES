const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  hasUsers: () => ipcRenderer.invoke('auth:hasUsers'),
  createInitialUser: (payload) => ipcRenderer.invoke('auth:createInitialUser', payload),
  login: (username, password) => ipcRenderer.invoke('auth:login', { username, password }),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getCurrentUser: () => ipcRenderer.invoke('auth:getCurrentUser'),
  getLastUser: () => ipcRenderer.invoke('auth:getLastUser'),
  listUsers: () => ipcRenderer.invoke('users:list'),
  createUser: (payload) => ipcRenderer.invoke('users:create', payload),
  updateUser: (id, payload) => ipcRenderer.invoke('users:update', { id, ...payload }),
  setUserEstatus: (id, estatus) => ipcRenderer.invoke('users:setEstatus', { id, estatus }),
  permissionsListUsers: () => ipcRenderer.invoke('permissions:listUsers'),
  setUserPermissions: (id, permissions) =>
    ipcRenderer.invoke('permissions:setForUser', { id, permissions }),
  setSettings: (payload) => ipcRenderer.invoke('settings:set', payload),

  listEmpleados: () => ipcRenderer.invoke('empleados:list'),
  searchEmpleados: (query, limit) =>
    ipcRenderer.invoke('empleados:searchActive', { query, limit }),
  createEmpleado: (payload) => ipcRenderer.invoke('empleados:create', payload),
  quickCreateEmpleado: (payload) => ipcRenderer.invoke('empleados:quickCreate', payload),
  updateEmpleado: (id, payload) =>
    ipcRenderer.invoke('empleados:update', { id, ...payload }),
  setEmpleadoEstatus: (id, estatus) =>
    ipcRenderer.invoke('empleados:setEstatus', { id, estatus }),

  getEmpleadoStatus: (id) => ipcRenderer.invoke('registro:getEmpleadoStatus', { id }),
  markEvent: (id, tipo, salida) =>
    ipcRenderer.invoke('registro:markEvent', { id, tipo, salida }),
  listTodayEvents: () => ipcRenderer.invoke('registro:listToday'),
  updateEvent: (id, payload, password) =>
    ipcRenderer.invoke('registro:updateEvent', { id, payload, password }),
  deleteEvent: (id, password) =>
    ipcRenderer.invoke('registro:deleteEvent', { id, password }),

  // Dashboard
  getDashboardStats: (range) => ipcRenderer.invoke('dashboard:stats', { range }),

  // Configuración general
  getWorkSchedule: () => ipcRenderer.invoke('configuracion:getWorkSchedule'),
  setWorkSchedule: (payload) => ipcRenderer.invoke('configuracion:setWorkSchedule', payload),
  getCompanyName: () => ipcRenderer.invoke('configuracion:getCompanyName'),
  setCompanyName: (name) => ipcRenderer.invoke('configuracion:setCompanyName', { name }),
  getCompanyLogo: () => ipcRenderer.invoke('configuracion:getCompanyLogo'),
  setCompanyLogo: (payload) => ipcRenderer.invoke('configuracion:setCompanyLogo', payload),
  removeCompanyLogo: () => ipcRenderer.invoke('configuracion:removeCompanyLogo'),

  // Auditoría
  auditList: (opts) => ipcRenderer.invoke('audit:list', opts || {}),
  auditListActions: () => ipcRenderer.invoke('audit:listActions'),
  auditListUsers: () => ipcRenderer.invoke('audit:listUsers'),

  // Reportes
  reporteAsistenciaDia: (fecha) =>
    ipcRenderer.invoke('reportes:asistenciaDia', { fecha }),
  reporteHistorial: (empleadoId, ini, fin) =>
    ipcRenderer.invoke('reportes:historial', { empleadoId, ini, fin }),
  reporteSalidasMotivo: (ini, fin) =>
    ipcRenderer.invoke('reportes:salidasMotivo', { ini, fin }),
  reporteHorasDentroFuera: (ini, fin) =>
    ipcRenderer.invoke('reportes:horasDentroFuera', { ini, fin }),
  reporteHorasDentroFueraEmpleado: (empleadoId, ini, fin) =>
    ipcRenderer.invoke('reportes:horasDentroFueraEmpleado', { empleadoId, ini, fin }),
  reporteListEmpleados: () => ipcRenderer.invoke('reportes:listEmpleados'),
  exportReporteExcel: (payload) => ipcRenderer.invoke('reportes:exportExcel', payload),
  exportReportePdf: (payload) => ipcRenderer.invoke('reportes:exportPdf', payload),

  listCatalogo: (catalogo, opts) =>
    ipcRenderer.invoke('catalogos:list', { catalogo, ...(opts || {}) }),
  addCatalogoItem: (catalogo, valor) =>
    ipcRenderer.invoke('catalogos:addItem', { catalogo, valor }),
  listCatalogoAll: (catalogo) =>
    ipcRenderer.invoke('catalogos:listAll', { catalogo }),
  updateCatalogoItem: (id, valor) =>
    ipcRenderer.invoke('catalogos:updateItem', { id, valor }),
  setCatalogoItemEstatus: (id, estatus) =>
    ipcRenderer.invoke('catalogos:setItemEstatus', { id, estatus }),
  deleteCatalogoItem: (id) =>
    ipcRenderer.invoke('catalogos:deleteItem', { id }),

  setView: (view) => ipcRenderer.invoke('window:setView', view),
});
