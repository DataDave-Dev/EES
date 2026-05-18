# Onix

Aplicación de escritorio para control de asistencia. Diseñada para uso interno
de una organización: registro de entradas/salidas, empleados, motivos de
salida, reportes, usuarios y permisos, y bitácora de auditoría.

Construida con **Electron + better-sqlite3 + Tailwind**. La base de datos vive
local (un archivo SQLite por instalación), no requiere servidor.

## Requisitos

- Windows 10/11 (instalador firmado vía Squirrel).
- Node 18+ y npm 9+ para desarrollo.

## Scripts de desarrollo

```bash
npm install                # instala dependencias y aplica fixes de Squirrel
npm run build:css          # compila Tailwind a src/styles/output.css
npm start                  # corre la app en modo dev (recompila CSS antes)
npm run watch:css          # recompila CSS al cambiar input.css
npm run rebuild            # recompila modulos nativos (better-sqlite3, bcrypt)
npm run package            # genera el paquete sin instalador
npm run make               # genera instalador Squirrel para Windows
npm run publish            # publica release en GitHub (requiere GITHUB_TOKEN)
```

## Estructura

```
src/
  index.js               # entrada del proceso main
  preload.js             # bridge contextIsolated entre renderer y main
  main/                  # backend: auth, db, IPC, reportes, exports, updater
  renderer/              # frontend: HTML+JS por vista
    login/               # pantalla de login
    setup/               # asistente de primer arranque
    dashboard/           # panel principal (vistas internas)
    registro-nuevo/      # captura de evento de asistencia
    shared/              # helpers reutilizables (iconos, time, toast, etc.)
  styles/
    input.css            # Tailwind + componentes propios (fuente)
    output.css           # generado por Tailwind (gitignored)
  assets/                # logo, icono, gif de instalador
forge.config.js          # configuración de electron-forge (Squirrel + GitHub)
scripts/                 # generadores de iconos/GIF, fixes de Squirrel
```

## Convenciones

- **Zona horaria**: la BD persiste `TIMESTAMP` en UTC; las consultas que
  comparan "hoy/ayer" usan `date(timestamp, 'localtime')`. Ver comentario al
  inicio de `src/main/db.js`.
- **Formato de hora en UI**: siempre vía `EES_TIME` en `src/renderer/shared/time.js`
  (12 h con `a.m.`/`p.m.` en minúsculas).
- **Errores de UX**: usar `EES_TOAST.error/success/info` (toast no bloqueante)
  en lugar de `alert()`.
- **Logs de error**: `src/main/logger.js` escribe a `<userData>/onix-errors.log`
  con rotación a 512 KB.
- **Auditoría**: cada acción crítica deja rastro en la tabla `audit_log`. Hay
  retención automática a 12 meses al arrancar la app.

## Seguridad

- `contextIsolation: true`, `nodeIntegration: false`, Fuses habilitadas
  (`OnlyLoadAppFromAsar`, `EnableEmbeddedAsarIntegrityValidation`,
  `RunAsNode: false`).
- `sandbox: false` está documentado en `src/index.js` (es necesario porque el
  preload usa módulos nativos).
- Todos los queries SQL usan prepared statements con bindings `?` —
  cero concatenación insegura.
- Contraseñas con `bcrypt` (cost 12). Operaciones sensibles requieren
  re-confirmar contraseña (`requirePermAndPassword`).

## Releases

Releases publicados en GitHub Releases del repo. La app se auto-actualiza vía
`update-electron-app` apuntando al servicio público de Electron.

```bash
# Flujo manual de release
1. Bump version en package.json
2. Commit "chore(release): vX.Y.Z" + tag vX.Y.Z
3. git push origin master && git push origin vX.Y.Z
4. GITHUB_TOKEN=$(gh auth token) npm run publish
5. Editar notas en GitHub con el cambio en lenguaje de usuario
```
