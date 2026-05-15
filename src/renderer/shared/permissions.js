window.EES_PERMISSIONS = (() => {
  // Keep keys in sync with ALL_MODULES in src/main/db.js.
  const MODULES = [
    { key: 'registro',  label: 'Registro' },
    { key: 'empleados', label: 'Empleados' },
    { key: 'catalogos', label: 'Catálogos' },
    { key: 'reportes',  label: 'Reportes' },
    { key: 'usuarios',  label: 'Usuarios' },
    { key: 'accesos',   label: 'Accesos' },
    { key: 'auditoria', label: 'Auditoría' },
  ];

  const ALWAYS_VISIBLE = new Set(['dashboard', 'apariencia']);

  // Sub-views that inherit permission from a parent module.
  const VIEW_TO_PERM = {
    'tipos-salida': 'catalogos',
    'rep-asistencia-dia': 'reportes',
    'rep-historial': 'reportes',
    'rep-salidas-motivo': 'reportes',
    'rep-horas-dentro-fuera': 'reportes',
    'configuracion-general': 'usuarios',
  };

  function has(user, perm) {
    if (!user) return false;
    return Array.isArray(user.permissions) && user.permissions.includes(perm);
  }

  function canSee(user, viewKey) {
    if (ALWAYS_VISIBLE.has(viewKey)) return true;
    const perm = VIEW_TO_PERM[viewKey] || viewKey;
    return has(user, perm);
  }

  return { MODULES, ALWAYS_VISIBLE, VIEW_TO_PERM, has, canSee };
})();
