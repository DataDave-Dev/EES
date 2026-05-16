const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog, BrowserWindow } = require('electron');
const ExcelJS = require('exceljs');
const configLib = require('./configuracion');

function defaultFilename(base, ext) {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `${base}-${stamp}.${ext}`;
}

// Mismo formato 12h ("2:30 p.m.") que usa la UI, para que la fecha del
// encabezado del PDF se vea consistente con el resto del sistema.
function formatGeneratedAt(d = new Date()) {
  const fecha = d.toLocaleDateString('es-MX', { dateStyle: 'long' });
  const periodo = d.getHours() >= 12 ? 'p.m.' : 'a.m.';
  const h12 = (() => { const x = d.getHours() % 12; return x === 0 ? 12 : x; })();
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${fecha}, ${h12}:${mm} ${periodo}`;
}

// ── Excel ────────────────────────────────────────────────────
// columns: [{ key, header, width? }]
// rows: array of objects keyed by column.key
async function exportExcel(sender, { title, columns, rows, defaultBase = 'reporte' }) {
  const win = BrowserWindow.fromWebContents(sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Exportar a Excel',
    defaultPath: defaultFilename(defaultBase, 'xlsx'),
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  const wb = new ExcelJS.Workbook();
  wb.creator = configLib.getCompanyName();
  wb.created = new Date();
  const ws = wb.addWorksheet(title || 'Reporte');

  // Header row
  ws.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width || 18,
  }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle' };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFF2F4F7' },
  };

  rows.forEach((r) => ws.addRow(r));

  // Borders for data range
  const lastRow = ws.rowCount;
  const lastCol = columns.length;
  for (let r = 1; r <= lastRow; r++) {
    for (let c = 1; c <= lastCol; c++) {
      ws.getCell(r, c).border = {
        top: { style: 'thin', color: { argb: 'FFE4E7EC' } },
        bottom: { style: 'thin', color: { argb: 'FFE4E7EC' } },
        left: { style: 'thin', color: { argb: 'FFE4E7EC' } },
        right: { style: 'thin', color: { argb: 'FFE4E7EC' } },
      };
    }
  }

  await wb.xlsx.writeFile(filePath);
  return { ok: true, filePath };
}

// ── PDF ──────────────────────────────────────────────────────
// Payload shape (preferred):
//   { title, subtitle?, summary?: [{label,value}], headers: [string],
//     rows: [[string|{html}]], defaultBase? }
// Legacy: { title, htmlBody, defaultBase } — used as raw body if rows not provided.
async function exportPdf(sender, payload = {}) {
  const {
    title = 'Reporte',
    subtitle = '',
    summary = [],
    headers = null,
    rows = null,
    htmlBody = '',
    defaultBase = 'reporte',
  } = payload;

  const parentWin = BrowserWindow.fromWebContents(sender);
  const { canceled, filePath } = await dialog.showSaveDialog(parentWin, {
    title: 'Exportar a PDF',
    defaultPath: defaultFilename(defaultBase, 'pdf'),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  const off = new BrowserWindow({
    show: false,
    width: 1024,
    height: 1400,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const summaryHtml = renderSummary(summary);
  const tableHtml = Array.isArray(headers) && Array.isArray(rows)
    ? renderTable(headers, rows)
    : htmlBody;

  const fullHtml = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeForHtml(title)}</title>
<style>
  @page { size: Letter; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    color: #1a1d24;
    font-size: 11.5px;
    line-height: 1.4;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .pdf-page {
    padding: 22mm 16mm 22mm 16mm;
  }
  /* ── Brand header ───────────────────────── */
  .pdf-header {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-bottom: 14px;
    border-bottom: 2px solid #1a1d24;
    margin-bottom: 22px;
  }
  .pdf-brand-mark {
    width: 38px;
    height: 38px;
    border-radius: 9999px;
    background: #d97757;
    color: #ffffff;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 18px;
    letter-spacing: -0.5px;
    flex-shrink: 0;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.2);
  }
  .pdf-brand-text {
    display: flex;
    flex-direction: column;
    line-height: 1.2;
  }
  .pdf-brand-name {
    font-weight: 700;
    font-size: 14px;
    letter-spacing: 0.3px;
  }
  .pdf-brand-tag {
    font-size: 10.5px;
    color: #6b7280;
    letter-spacing: 0.2px;
  }
  .pdf-header-right {
    margin-left: auto;
    text-align: right;
    font-size: 10px;
    color: #6b7280;
    line-height: 1.4;
  }
  .pdf-header-right-label {
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-weight: 600;
    color: #475467;
  }

  /* ── Report title ───────────────────────── */
  .pdf-title-block { margin-bottom: 18px; }
  h1 {
    font-size: 22px;
    margin: 0 0 2px;
    letter-spacing: -0.5px;
    font-weight: 700;
    color: #101828;
  }
  .pdf-subtitle {
    color: #475467;
    font-size: 12.5px;
    margin: 0;
  }

  /* ── Summary stats ──────────────────────── */
  .pdf-summary {
    display: flex;
    gap: 0;
    margin-bottom: 22px;
    border: 1px solid #eaecf0;
    border-radius: 8px;
    overflow: hidden;
    background: #fafbfc;
  }
  .pdf-stat {
    flex: 1;
    padding: 12px 16px;
    border-right: 1px solid #eaecf0;
  }
  .pdf-stat:last-child { border-right: 0; }
  .pdf-stat-label {
    font-size: 9.5px;
    font-weight: 600;
    color: #6b7280;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    display: block;
    margin-bottom: 4px;
  }
  .pdf-stat-value {
    font-size: 18px;
    font-weight: 700;
    color: #101828;
    letter-spacing: -0.3px;
    line-height: 1;
  }

  /* ── Table ─────────────────────────────── */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
    page-break-inside: auto;
  }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; page-break-after: auto; }
  thead th {
    text-align: left;
    background: #1a1d24;
    color: #ffffff;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.7px;
    text-transform: uppercase;
    padding: 9px 12px;
    border-right: 1px solid rgba(255,255,255,0.08);
  }
  thead th:last-child { border-right: 0; }
  tbody td {
    padding: 8px 12px;
    border-bottom: 1px solid #eaecf0;
    vertical-align: top;
    color: #1a1d24;
  }
  tbody tr:nth-child(even) td { background: #f9fafb; }
  tbody tr:last-child td { border-bottom: 0; }
  tbody tr:hover td { background: inherit; }
  .pdf-num {
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }
  .pdf-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 9999px;
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }
  .pdf-badge--in {
    background: rgba(46, 166, 108, 0.14);
    color: #1f7a4f;
  }
  .pdf-badge--out {
    background: rgba(229, 72, 77, 0.14);
    color: #b42318;
  }
  .pdf-bar-cell {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .pdf-bar {
    flex: 1;
    height: 6px;
    background: #eaecf0;
    border-radius: 3px;
    overflow: hidden;
  }
  .pdf-bar-fill {
    display: block;
    height: 100%;
    background: #d97757;
  }
  .pdf-bar-num {
    font-family: 'SFMono-Regular', Consolas, monospace;
    font-weight: 700;
    min-width: 36px;
    text-align: right;
  }
</style>
</head>
<body>
<div class="pdf-page">

  <header class="pdf-header">
    <div class="pdf-brand-mark">O</div>
    <div class="pdf-brand-text">
      <span class="pdf-brand-name">ONIX</span>
      <span class="pdf-brand-tag">Control de asistencia</span>
    </div>
    <div class="pdf-header-right">
      <div class="pdf-header-right-label">Generado</div>
      <div>${escapeForHtml(formatGeneratedAt())}</div>
    </div>
  </header>

  <div class="pdf-title-block">
    <h1>${escapeForHtml(title)}</h1>
    ${subtitle ? `<p class="pdf-subtitle">${escapeForHtml(subtitle)}</p>` : ''}
  </div>

  ${summaryHtml}
  ${tableHtml}

</div>
</body>
</html>`;

  try {
    await off.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(fullHtml));
    const brandFooter = escapeForHtml(configLib.getCompanyName());
    const buf = await off.webContents.printToPDF({
      pageSize: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="font-size:8.5px; width:100%; padding:0 16mm; color:#6b7280; display:flex; justify-content:space-between; align-items:center; font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
          <span>${brandFooter} · Control de asistencia</span>
          <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
        </div>`,
    });
    await fs.writeFile(filePath, buf);
  } finally {
    off.close();
  }
  return { ok: true, filePath };
}

function renderSummary(summary) {
  if (!Array.isArray(summary) || summary.length === 0) return '';
  const items = summary.map((s) => `
    <div class="pdf-stat">
      <span class="pdf-stat-label">${escapeForHtml(s.label)}</span>
      <span class="pdf-stat-value">${escapeForHtml(String(s.value))}</span>
    </div>
  `).join('');
  return `<div class="pdf-summary">${items}</div>`;
}

function renderTable(headers, rows) {
  const head = headers.map((h) => `<th>${escapeForHtml(h)}</th>`).join('');
  const body = rows.map((cells) => {
    const tds = cells.map((c) => {
      if (c && typeof c === 'object' && typeof c.html === 'string') {
        return `<td>${c.html}</td>`;
      }
      return `<td>${escapeForHtml(c ?? '')}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function escapeForHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = { exportExcel, exportPdf, escapeForHtml };
