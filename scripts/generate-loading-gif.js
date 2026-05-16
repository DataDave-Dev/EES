// Genera src/assets/logo/installer-splash.gif a partir del logo.
//
// Squirrel.Windows muestra este GIF de 640x400 durante la primera
// instalación. Usamos PowerShell + System.Drawing (sin nuevas
// dependencias npm) porque el pipeline de make-squirrel sólo corre
// en Windows; en otras plataformas el script se autosalta.

const fs   = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT     = path.join(__dirname, '..');
const SRC_PNG  = path.join(ROOT, 'src', 'assets', 'logo', 'logo.png');
const OUT_GIF  = path.join(ROOT, 'src', 'assets', 'logo', 'installer-splash.gif');

const WIDTH    = 640;
const HEIGHT   = 400;
const BG_HEX   = '#eeece6'; // mismo color que el window backgroundColor de la app
const ACCENT   = '#2b2b2b'; // texto sobre el splash
const APP_NAME = 'Onix';
const TAGLINE  = 'Instalando la aplicacion...';

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return { r: 255, g: 255, b: 255 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function main() {
  if (process.platform !== 'win32') {
    console.log('[generate-loading-gif] omitido (solo Windows).');
    return;
  }
  if (!fs.existsSync(SRC_PNG)) {
    console.warn(`[generate-loading-gif] no se encontro ${SRC_PNG}; omitido.`);
    return;
  }

  const bg = hexToRgb(BG_HEX);
  const fg = hexToRgb(ACCENT);

  // Tamano maximo del logo dentro del splash (40% del alto, deja espacio para texto).
  const logoBox = Math.round(HEIGHT * 0.42);

  const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile('${SRC_PNG.replace(/\\/g, '\\\\')}')
$bmp = New-Object System.Drawing.Bitmap ${WIDTH}, ${HEIGHT}
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.TextRenderingHint  = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

$bgColor = [System.Drawing.Color]::FromArgb(${bg.r}, ${bg.g}, ${bg.b})
$g.Clear($bgColor)

# Calculo del bounding box manteniendo aspect ratio
$srcW = $src.Width
$srcH = $src.Height
$maxSide = ${logoBox}
if ($srcW -ge $srcH) {
  $newW = $maxSide
  $newH = [int]([math]::Round($srcH * $maxSide / $srcW))
} else {
  $newH = $maxSide
  $newW = [int]([math]::Round($srcW * $maxSide / $srcH))
}

$logoY = [int](${HEIGHT} * 0.22)
$logoX = [int]((${WIDTH} - $newW) / 2)
$g.DrawImage($src, $logoX, $logoY, $newW, $newH)

# Titulo de la app
$titleFont   = New-Object System.Drawing.Font('Segoe UI Semibold', 28, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$titleBrush  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(${fg.r}, ${fg.g}, ${fg.b}))
$titleSize   = $g.MeasureString('${APP_NAME}', $titleFont)
$titleX      = (${WIDTH} - $titleSize.Width) / 2
$titleY      = $logoY + $newH + 18
$g.DrawString('${APP_NAME}', $titleFont, $titleBrush, $titleX, $titleY)

# Tagline
$tagFont   = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$tagBrush  = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(150, ${fg.r}, ${fg.g}, ${fg.b}))
$tagSize   = $g.MeasureString('${TAGLINE}', $tagFont)
$tagX      = (${WIDTH} - $tagSize.Width) / 2
$tagY      = $titleY + $titleSize.Height + 4
$g.DrawString('${TAGLINE}', $tagFont, $tagBrush, $tagX, $tagY)

$bmp.Save('${OUT_GIF.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Gif)

$src.Dispose()
$g.Dispose()
$bmp.Dispose()
`;

  const res = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (res.status !== 0) {
    console.error('[generate-loading-gif] falló la generación:');
    if (res.stderr) console.error(res.stderr.toString());
    // No detenemos el build: el instalador funciona aún sin loadingGif.
    return;
  }
  const stat = fs.statSync(OUT_GIF);
  console.log(`[generate-loading-gif] wrote ${OUT_GIF} (${stat.size} bytes)`);
}

main();
