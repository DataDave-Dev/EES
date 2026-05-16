#!/usr/bin/env node
// Squirrel.Windows (vía electron-winstaller) busca `7z.exe` y `7z.dll` en su
// vendor folder, pero las versiones recientes solo incluyen los binarios
// arquitectura-específicos (`7z-x64.exe`, `7z-x64.dll`). Sin estos aliases,
// `electron-forge make/publish` falla con "The system cannot find the file
// specified" durante el releasify. Este script crea los aliases necesarios.
// Es idempotente y solo actúa en Windows.

const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'win32') {
  process.exit(0);
}

const vendorDir = path.join(
  __dirname,
  '..',
  'node_modules',
  'electron-winstaller',
  'vendor'
);

if (!fs.existsSync(vendorDir)) {
  // electron-winstaller no está instalado; nada que hacer.
  process.exit(0);
}

const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const pairs = [
  [`7z-${arch}.exe`, '7z.exe'],
  [`7z-${arch}.dll`, '7z.dll'],
];

let copied = 0;
for (const [source, target] of pairs) {
  const src = path.join(vendorDir, source);
  const dst = path.join(vendorDir, target);
  if (!fs.existsSync(src)) continue;
  if (fs.existsSync(dst)) continue;
  fs.copyFileSync(src, dst);
  copied += 1;
}

if (copied > 0) {
  console.log(`[fix-squirrel] alias creados: ${copied} archivo(s) en ${vendorDir}`);
}
