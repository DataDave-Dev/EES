const I = window.EES_ICONS;
const T = window.EES_THEME;
const P = window.EES_PASSWORD;
const PERMS = window.EES_PERMISSIONS;

window.api.setView('dashboard');

// ── Icons ─────────────────────────────────────────────────────
document.getElementById('icon-logout').innerHTML = I.logout(15);
document.getElementById('icon-menu').innerHTML = I.menu(18);
document.getElementById('nav-icon-dashboard').innerHTML = I.dashboard(17);
document.getElementById('nav-icon-registro').innerHTML = I.registro(17);
document.getElementById('nav-icon-empleados').innerHTML = I.empleados(17);
document.getElementById('nav-icon-catalogos').innerHTML = I.catalogos(17);
document.getElementById('nav-icon-configuracion').innerHTML = I.settings(17);
document.getElementById('nav-icon-chevron').innerHTML = I.chevron(13);
document.getElementById('nav-icon-usuarios').innerHTML = I.user(15);
document.getElementById('nav-icon-accesos').innerHTML = I.shield(15);
document.getElementById('nav-icon-auditoria').innerHTML = I.clipboard(15);
document.getElementById('nav-icon-apariencia').innerHTML = I.palette(15);

let currentUser = null;

// ── Hydrate user info ─────────────────────────────────────────
async function loadUser() {
  const user = await window.api.getCurrentUser();
  if (!user) { window.location.href = '../login/login.html'; return; }
  currentUser = user;
  T.applyFromUser(user);

  document.getElementById('user-fullname').textContent = `${user.nombre} ${user.apellidos}`;
  document.getElementById('user-username').textContent = `@${user.username}`;
  document.getElementById('user-avatar').textContent =
    (user.nombre?.[0] || '').toUpperCase() + (user.apellidos?.[0] || '').toUpperCase();
  document.getElementById('greeting').textContent = `Hola, ${user.nombre}`;

  applyPermissionGating();
  renderPills();
  renderSwatches();

  // Honor #view-key hash on load (e.g. when returning from registro-nuevo).
  const hash = (window.location.hash || '').replace('#', '').trim();
  if (hash) switchView(hash);
  else startDashboardAutoRefresh();
}

function applyPermissionGating() {
  document.querySelectorAll('#sidebar-nav .nav-item[data-view]').forEach((btn) => {
    const view = btn.dataset.view;
    const visible = PERMS.canSee(currentUser, view);
    btn.classList.toggle('hidden', !visible);
  });
  // Hide the Catálogos group toggle entirely if user lacks the catalogos perm.
  const hasCatalogos = PERMS.has(currentUser, 'catalogos');
  catalogosGroup.classList.toggle('hidden', !hasCatalogos);
  const hasReportes = PERMS.has(currentUser, 'reportes');
  reportesGroup.classList.toggle('hidden', !hasReportes);
  // If active view is now forbidden, fall back to dashboard
  const active = document.querySelector('.view.is-active');
  if (active && !PERMS.canSee(currentUser, active.dataset.view)) {
    switchView('dashboard');
  }
}

loadUser();

// ── Dashboard view ────────────────────────────────────────────
const dashKpiActivos = document.getElementById('dash-kpi-activos');
const dashKpiPresentes = document.getElementById('dash-kpi-presentes');
const dashKpiEntradas = document.getElementById('dash-kpi-entradas');
const dashKpiSalidas = document.getElementById('dash-kpi-salidas');
const dashKpiTotal = document.getElementById('dash-kpi-total');
const dashActividad = document.getElementById('dash-actividad');
const dashMotivos = document.getElementById('dash-motivos');
const dashMotivosSub = document.getElementById('dash-motivos-sub');
const dashPresentes = document.getElementById('dash-presentes');
const dashPresentesCount = document.getElementById('dash-presentes-count');
const dashHourly = document.getElementById('dash-hourly');
const dashHourlyLegend = document.getElementById('dash-hourly-legend');
const dashHourlyTitle = document.getElementById('dash-hourly-title');
const dashHourlySub = document.getElementById('dash-hourly-sub');
const dashRange = document.getElementById('dash-range');

let dashRefreshInterval = null;
const dashState = {
  range: 'today',
  hiddenSeries: new Set(),
  lastStats: null,
};

const RANGE_TITLES = {
  today: { title: 'Actividad por hora', sub: 'entradas y salidas registradas hoy', motSub: 'salidas de hoy' },
  '7d':  { title: 'Actividad diaria',   sub: 'entradas y salidas, últimos 7 días', motSub: 'últimos 7 días' },
  '30d': { title: 'Actividad diaria',   sub: 'entradas y salidas, últimos 30 días', motSub: 'últimos 30 días' },
};

function dashFmtTime(iso) {
  if (!iso) return '—';
  const utcIso = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// ── Chart helpers (SVG, no external libs) ─────────────────────
const CHART_PALETTE = [
  '#d97757', // accent (terracotta)
  '#4f8df7', // blue
  '#2ea66c', // green
  '#f3bc4b', // amber
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
  '#94a3b8', // slate
];
function chartColor(i) { return CHART_PALETTE[i % CHART_PALETTE.length]; }

function polarToCartesian(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}
function donutArcPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
  // Close-to-full ring: SVG arcs can't represent 360°, split into two halves.
  if (endAngle - startAngle >= 359.999) {
    const half = startAngle + 180;
    return donutArcPath(cx, cy, rOuter, rInner, startAngle, half) + ' ' +
           donutArcPath(cx, cy, rOuter, rInner, half, endAngle);
  }
  const startOuter = polarToCartesian(cx, cy, rOuter, endAngle);
  const endOuter   = polarToCartesian(cx, cy, rOuter, startAngle);
  const startInner = polarToCartesian(cx, cy, rInner, endAngle);
  const endInner   = polarToCartesian(cx, cy, rInner, startAngle);
  const largeArc   = endAngle - startAngle > 180 ? 1 : 0;
  return [
    'M', startOuter.x.toFixed(2), startOuter.y.toFixed(2),
    'A', rOuter, rOuter, 0, largeArc, 0, endOuter.x.toFixed(2), endOuter.y.toFixed(2),
    'L', endInner.x.toFixed(2), endInner.y.toFixed(2),
    'A', rInner, rInner, 0, largeArc, 1, startInner.x.toFixed(2), startInner.y.toFixed(2),
    'Z',
  ].join(' ');
}

// items: [{ label, value, color?, key? }]
// opts: { size = 180, thickness = 18, centerTop, centerBottom, interactive: bool, dataAttr: string }
function donutSVG(items, opts = {}) {
  const size = opts.size || 180;
  const thickness = opts.thickness || 18;
  const cx = size / 2, cy = size / 2;
  const rOuter = size / 2 - 1;
  const rInner = rOuter - thickness;
  const total = items.reduce((s, it) => s + (it.value || 0), 0);

  // Background ring
  const bgPath = donutArcPath(cx, cy, rOuter, rInner, 0, 360);
  let segs = `<path d="${bgPath}" fill="var(--surface-2-strong, rgba(148,163,184,0.18))" />`;

  if (total > 0) {
    let accDeg = 0;
    items.forEach((it, i) => {
      const v = Math.max(0, it.value || 0);
      if (v <= 0) return;
      const sweep = (v / total) * 360;
      const start = accDeg;
      const end = accDeg + sweep;
      const color = it.color || chartColor(i);
      const cls = opts.interactive ? 'donut-seg donut-seg--interactive' : 'donut-seg';
      const dataAttrs = opts.interactive
        ? ` data-key="${escapeHtml(it.key ?? it.label ?? String(i))}" data-index="${i}" tabindex="0" role="button" aria-label="${escapeHtml(it.label)}: ${v}"`
        : '';
      segs += `<path class="${cls}" d="${donutArcPath(cx, cy, rOuter, rInner, start, end)}" fill="${color}"${dataAttrs} />`;
      accDeg = end;
    });
  }

  const ct = opts.centerTop ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" class="donut-center-top">${escapeHtml(opts.centerTop)}</text>` : '';
  const cb = opts.centerBottom ? `<text x="${cx}" y="${cy + 18}" text-anchor="middle" class="donut-center-bot">${escapeHtml(opts.centerBottom)}</text>` : '';
  return `<svg class="donut-svg" viewBox="0 0 ${size} ${size}" role="img" aria-hidden="false">
    ${segs}
    ${ct}${cb}
  </svg>`;
}

// items: [{ label, value, color }]
function donutLegend(items, total, clickable) {
  if (!items.length) return '';
  const t = total || items.reduce((s, it) => s + (it.value || 0), 0) || 1;
  const liClass = clickable ? 'donut-legend-item donut-legend-item--clickable' : 'donut-legend-item';
  const liExtra = clickable ? ' role="button" tabindex="0"' : '';
  return `<ul class="donut-legend">${items.map((it, i) => {
    const color = it.color || chartColor(i);
    const pct = Math.round(((it.value || 0) / t) * 100);
    return `<li class="${liClass}" data-index="${i}"${liExtra}>
      <span class="donut-legend-dot" style="background:${color}"></span>
      <span class="donut-legend-label">${escapeHtml(it.label)}</span>
      <span class="donut-legend-value">${it.value}</span>
      <span class="donut-legend-pct">${pct}%</span>
    </li>`;
  }).join('')}</ul>`;
}

// series: [{ label, color, points: number[] }]
// opts: { xLabels: string[], hidden?: Set<number> }
function lineSVG(series, opts = {}) {
  const w = 720, h = 200;
  const padL = 36, padR = 12, padT = 10, padB = 28;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const n = series[0]?.points?.length || 1;
  const hidden = opts.hidden || new Set();

  let yMax = 0;
  series.forEach((s, idx) => {
    if (hidden.has(idx)) return;
    s.points.forEach((v) => { if (v > yMax) yMax = v; });
  });
  yMax = Math.max(4, Math.ceil(yMax * 1.2));
  const niceStep = yMax <= 8 ? 1 : yMax <= 20 ? 2 : yMax <= 50 ? 5 : 10;
  yMax = Math.ceil(yMax / niceStep) * niceStep;

  const x = (i) => padL + (n <= 1 ? plotW / 2 : (plotW * i) / (n - 1));
  const y = (v) => padT + plotH - (plotH * v) / yMax;

  const ySteps = 4;
  let grid = '';
  for (let i = 0; i <= ySteps; i++) {
    const yy = padT + (plotH * i) / ySteps;
    const label = Math.round(yMax * (1 - i / ySteps));
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${w - padR}" y2="${yy.toFixed(1)}" class="chart-grid" />`;
    grid += `<text x="${padL - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" class="chart-axis">${label}</text>`;
  }

  let xLabels = '';
  if (opts.xLabels?.length) {
    opts.xLabels.forEach((lab, i) => {
      if (lab) xLabels += `<text x="${x(i).toFixed(1)}" y="${h - 8}" text-anchor="middle" class="chart-axis">${escapeHtml(lab)}</text>`;
    });
  }

  let paths = '';
  let dots = '';
  series.forEach((s, idx) => {
    if (hidden.has(idx)) return;
    const pts = s.points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    if (pts.length < 2) return;
    const linePath = `M ${pts.join(' L ')}`;
    const areaPath = `M ${padL},${y(0).toFixed(1)} L ${pts.join(' L ')} L ${x(n - 1).toFixed(1)},${y(0).toFixed(1)} Z`;
    paths += `<path d="${areaPath}" fill="${s.color}" opacity="0.12" />`;
    paths += `<path d="${linePath}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`;
    s.points.forEach((v, i) => {
      dots += `<circle class="line-dot" data-series="${idx}" data-index="${i}" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${s.color}" />`;
    });
  });

  // Hover indicator line (vertical, hidden by default)
  const hoverLine = `<line class="line-hover-cursor" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" />`;

  // Hover bands per bucket — drawn last so they sit on top and capture pointer events
  let bands = '';
  const bandW = n > 1 ? plotW / (n - 1) : plotW;
  for (let i = 0; i < n; i++) {
    const center = x(i);
    const bx = Math.max(padL, center - bandW / 2);
    const bw = Math.min(w - padR - bx, bandW);
    bands += `<rect class="line-band" x="${bx.toFixed(1)}" y="${padT}" width="${bw.toFixed(1)}" height="${plotH}" data-index="${i}" />`;
  }

  return `<svg class="line-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img" aria-hidden="false">
    ${grid}
    ${paths}
    ${dots}
    ${hoverLine}
    ${xLabels}
    ${bands}
  </svg>`;
}

function chartLegendInline(series, hidden) {
  const h = hidden || new Set();
  return `<div class="chart-legend-inline">${series.map((s, i) => `
    <button type="button" class="chart-legend-pill ${h.has(i) ? 'is-hidden' : ''}" data-index="${i}" title="Click para ocultar/mostrar">
      <span class="chart-legend-dot" style="background:${s.color}"></span>
      <span>${escapeHtml(s.label)}</span>
    </button>
  `).join('')}</div>`;
}

// ── Tooltip (singleton) ───────────────────────────────────────
function ensureChartTooltip() {
  let el = document.getElementById('chart-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chart-tooltip';
    el.className = 'chart-tooltip hidden';
    document.body.appendChild(el);
  }
  return el;
}
function showChartTooltip(html, clientX, clientY) {
  const el = ensureChartTooltip();
  if (typeof html === 'string') el.innerHTML = html;
  el.classList.remove('hidden');
  const rect = el.getBoundingClientRect();
  const margin = 12;
  let left = clientX + 14;
  let top = clientY - rect.height - 12;
  if (left + rect.width > window.innerWidth - margin) left = clientX - rect.width - 14;
  if (top < margin) top = clientY + 16;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}
function hideChartTooltip() {
  const el = document.getElementById('chart-tooltip');
  if (el) el.classList.add('hidden');
}

function renderDashboard(stats) {
  dashState.lastStats = stats;
  const { kpis, actividad, motivos, presentes, actividadSerie } = stats;

  dashKpiActivos.textContent = kpis.empleadosActivos;
  dashKpiPresentes.textContent = `${kpis.presentes} presentes ahora`;
  dashKpiEntradas.textContent = kpis.entradasHoy;
  dashKpiSalidas.textContent = kpis.salidasHoy;
  dashKpiTotal.textContent = kpis.eventosHoy;

  // Update titles based on range
  const t = RANGE_TITLES[stats.range] || RANGE_TITLES.today;
  dashHourlyTitle.textContent = t.title;
  dashHourlySub.textContent = t.sub;
  dashMotivosSub.textContent = t.motSub;

  renderActivityChart();
  renderMotivos();

  // Actividad reciente (siempre hoy)
  if (!actividad.length) {
    dashActividad.innerHTML = '<li class="dash-activity-empty">Sin actividad hoy.</li>';
  } else {
    dashActividad.innerHTML = actividad.map((ev) => {
      const isIn = ev.tipo === 'entrada';
      const badge = isIn
        ? '<span class="reg-tipo-badge reg-tipo-badge--in">Entrada</span>'
        : '<span class="reg-tipo-badge reg-tipo-badge--out">Salida</span>';
      const motivoStr = ev.motivo_tipo ? ` · ${escapeHtml(ev.motivo_tipo)}` : '';
      return `
        <li class="dash-activity-item">
          <span class="dash-activity-time">${dashFmtTime(ev.timestamp)}</span>
          <div class="dash-activity-body">
            <span class="dash-activity-name">${escapeHtml(ev.emp_nombre)} ${escapeHtml(ev.emp_apellidos)}</span>
            <span class="dash-activity-meta">#${escapeHtml(ev.numero_empleado)}${motivoStr}</span>
          </div>
          ${badge}
        </li>
      `;
    }).join('');
  }

  // Presentes
  dashPresentesCount.textContent = `${presentes.length} ${presentes.length === 1 ? 'persona' : 'personas'}`;
  if (!presentes.length) {
    dashPresentes.innerHTML = '<div class="dash-presentes-empty">Nadie ha registrado entrada hoy.</div>';
  } else {
    dashPresentes.innerHTML = presentes.map((p) => `
      <button type="button" class="dash-presente-card dash-presente-card--clickable" data-empleado-id="${p.empleado_id}" title="Ver historial de ${escapeHtml(p.nombre)} ${escapeHtml(p.apellidos)}">
        <span class="dash-presente-dot"></span>
        <div class="dash-presente-info">
          <span class="dash-presente-name">${escapeHtml(p.nombre)} ${escapeHtml(p.apellidos)}</span>
          <span class="dash-presente-meta">#${escapeHtml(p.numero_empleado)} · entró ${dashFmtTime(p.ultimo_ts)}</span>
        </div>
      </button>
    `).join('');
    // Listener is delegated once below (see dashPresentes.addEventListener),
    // so no per-element wiring needed here.
  }
}
// Delegated click handler: attached once, survives every re-render.
dashPresentes.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-empleado-id]');
  if (btn && dashPresentes.contains(btn)) {
    navigateToHistorial(+btn.dataset.empleadoId);
  }
});

// Delegated legend toggle (entradas/salidas): attached once.
dashHourlyLegend.addEventListener('click', (e) => {
  const btn = e.target.closest('.chart-legend-pill');
  if (!btn) return;
  const idx = +btn.dataset.index;
  if (!Number.isFinite(idx)) return;
  const seriesCount = dashState.seriesCount || 2;
  if (dashState.hiddenSeries.has(idx)) {
    dashState.hiddenSeries.delete(idx);
  } else {
    if (dashState.hiddenSeries.size >= seriesCount - 1) return;
    dashState.hiddenSeries.add(idx);
  }
  renderActivityChart();
});

// ── Render: actividad chart (line) ────────────────────────────
function renderActivityChart() {
  const stats = dashState.lastStats;
  if (!stats) return;
  const serie = stats.actividadSerie;
  const buckets = serie?.buckets || [];
  const seriesForSvg = [
    { label: 'Entradas', color: '#2ea66c', points: buckets.map((b) => b.entradas) },
    { label: 'Salidas',  color: '#e5484d', points: buckets.map((b) => b.salidas) },
  ];
  const total = seriesForSvg.reduce((s, ser) => s + ser.points.reduce((a, b) => a + b, 0), 0);
  if (total === 0) {
    dashHourly.innerHTML = '<div class="dash-hourly-empty">Sin eventos en este rango.</div>';
    dashHourlyLegend.innerHTML = '';
    return;
  }
  const xLabels = buckets.map((b) => b.shortLabel || '');
  dashHourly.innerHTML = lineSVG(seriesForSvg, { xLabels, hidden: dashState.hiddenSeries });
  dashHourlyLegend.innerHTML = chartLegendInline(seriesForSvg, dashState.hiddenSeries);
  // Series count is needed by the delegated legend click handler.
  dashState.seriesCount = seriesForSvg.length;

  // Wire tooltip on hover bands
  const svg = dashHourly.querySelector('svg');
  if (!svg) return;
  const cursor = svg.querySelector('.line-hover-cursor');
  svg.querySelectorAll('.line-band').forEach((band) => {
    band.addEventListener('mouseenter', (e) => {
      const i = +band.dataset.index;
      const b = buckets[i];
      if (!b) return;
      const rows = seriesForSvg.map((s, idx) => {
        if (dashState.hiddenSeries.has(idx)) return '';
        return `<div class="ct-row">
          <span class="ct-dot" style="background:${s.color}"></span>
          <span class="ct-label">${escapeHtml(s.label)}</span>
          <span class="ct-value">${s.points[i]}</span>
        </div>`;
      }).join('');
      const totalRow = `<div class="ct-row ct-row--total">
        <span class="ct-label">Total</span>
        <span class="ct-value">${b.entradas + b.salidas}</span>
      </div>`;
      showChartTooltip(`<div class="ct-title">${escapeHtml(b.label)}</div>${rows}${totalRow}`, e.clientX, e.clientY);
      if (cursor) {
        const cx = band.x.baseVal.value + band.width.baseVal.value / 2;
        cursor.setAttribute('x1', cx);
        cursor.setAttribute('x2', cx);
        cursor.classList.add('is-visible');
      }
    });
    band.addEventListener('mousemove', (e) => showChartTooltip(undefined, e.clientX, e.clientY));
    band.addEventListener('mouseleave', () => {
      hideChartTooltip();
      if (cursor) cursor.classList.remove('is-visible');
    });
  });
}

// ── Render: motivos (donut, interactivo) ──────────────────────
function renderMotivos() {
  const stats = dashState.lastStats;
  const motivos = stats?.motivos || [];
  if (!motivos.length) {
    dashMotivos.innerHTML = '<div class="dash-motivos-empty">Sin salidas en el rango.</div>';
    return;
  }
  const totalMot = motivos.reduce((s, m) => s + m.total, 0);
  const items = motivos.map((m, i) => ({
    label: m.motivo,
    value: m.total,
    color: chartColor(i),
    key: m.motivo,
  }));
  dashMotivos.innerHTML = `
    <div class="donut-wrap donut-wrap--compact">
      ${donutSVG(items, { size: 160, thickness: 18, centerTop: String(totalMot), centerBottom: 'salidas', interactive: true })}
      ${donutLegend(items, totalMot, true)}
    </div>
  `;

  // Wire segment hover (tooltip) + click (navigate)
  const svg = dashMotivos.querySelector('svg');
  if (svg) {
    svg.querySelectorAll('.donut-seg--interactive').forEach((seg, idx) => {
      seg.addEventListener('mouseenter', (e) => showMotivoTooltip(idx, items, totalMot, e.clientX, e.clientY));
      seg.addEventListener('mousemove', (e) => showChartTooltip(undefined, e.clientX, e.clientY));
      seg.addEventListener('mouseleave', hideChartTooltip);
      seg.addEventListener('click', () => navigateToMotivosReport());
    });
  }
  // Wire legend items
  dashMotivos.querySelectorAll('.donut-legend-item--clickable').forEach((li, idx) => {
    li.addEventListener('mouseenter', (e) => showMotivoTooltip(idx, items, totalMot, e.clientX, e.clientY));
    li.addEventListener('mousemove', (e) => showChartTooltip(undefined, e.clientX, e.clientY));
    li.addEventListener('mouseleave', hideChartTooltip);
    li.addEventListener('click', () => navigateToMotivosReport());
  });
}

function showMotivoTooltip(idx, items, total, x, y) {
  const it = items[idx];
  if (!it) return;
  const pct = total > 0 ? ((it.value / total) * 100).toFixed(1) : '0';
  showChartTooltip(
    `<div class="ct-title">
       <span class="ct-dot" style="background:${it.color}"></span>${escapeHtml(it.label)}
     </div>
     <div class="ct-row"><span class="ct-label">Total</span><span class="ct-value">${it.value}</span></div>
     <div class="ct-row"><span class="ct-label">%</span><span class="ct-value">${pct}%</span></div>
     <div class="ct-hint">Click para abrir el reporte</div>`,
    x, y
  );
}

// ── Navigation helpers ────────────────────────────────────────
function navigateToMotivosReport() {
  const stats = dashState.lastStats;
  if (!stats) return;
  switchView('rep-salidas-motivo');
  // Pre-fill dates from current range and generate
  const repIni = document.getElementById('rep-sm-ini');
  const repFin = document.getElementById('rep-sm-fin');
  if (repIni && repFin) {
    repIni.value = stats.rangeIni;
    repFin.value = stats.rangeFin;
    if (typeof repSmGenerar === 'function') repSmGenerar();
  }
}

function navigateToHistorial(empleadoId) {
  if (!empleadoId) return;
  switchView('rep-historial');
  const sel = document.getElementById('rep-hi-empleado');
  const ini = document.getElementById('rep-hi-ini');
  const fin = document.getElementById('rep-hi-fin');
  const trigger = () => {
    if (!sel) return;
    const value = String(empleadoId);
    if ([...sel.options].some((o) => o.value === value)) {
      sel.value = value;
      // Default range: last 30 days
      const today = new Date();
      const past = new Date(today); past.setDate(past.getDate() - 29);
      const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (ini) ini.value = fmt(past);
      if (fin) fin.value = fmt(today);
      const btn = document.getElementById('rep-hi-buscar');
      if (btn) btn.click();
      return true;
    }
    return false;
  };
  // The empleado select may not be populated yet; retry briefly.
  if (!trigger()) {
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (trigger() || tries > 20) clearInterval(iv);
    }, 100);
  }
}

async function loadDashboardStats() {
  const res = await window.api.getDashboardStats(dashState.range);
  if (!res?.ok) return;
  renderDashboard(res.stats);
}

function startDashboardAutoRefresh() {
  stopDashboardAutoRefresh();
  loadDashboardStats();
  // 5 min: el botón 'Actualizar' del header está disponible para refresh
  // inmediato; el auto solo cubre el caso de tener la vista abierta pasivamente.
  dashRefreshInterval = setInterval(loadDashboardStats, 300000);
}
function stopDashboardAutoRefresh() {
  if (dashRefreshInterval) { clearInterval(dashRefreshInterval); dashRefreshInterval = null; }
}

document.getElementById('dash-refresh').addEventListener('click', loadDashboardStats);

// Range pills
dashRange.querySelectorAll('.dash-range-pill').forEach((btn) => {
  btn.addEventListener('click', () => {
    const newRange = btn.dataset.range;
    if (!newRange || newRange === dashState.range) return;
    dashState.range = newRange;
    dashState.hiddenSeries = new Set(); // reset toggles when range changes
    dashRange.querySelectorAll('.dash-range-pill').forEach((b) => {
      const active = b.dataset.range === newRange;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    loadDashboardStats();
  });
});

// Hide tooltip when leaving the dashboard view
document.addEventListener('mousedown', (e) => {
  if (e.target.closest('.line-band, .donut-seg--interactive, .donut-legend-item--clickable')) return;
  hideChartTooltip();
}, true);

// ── Usuarios view ─────────────────────────────────────────────
const usersTbody = document.getElementById('users-tbody');
const usersCount = document.getElementById('users-count');
let usersLoaded = false;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function initials(nombre, apellidos) {
  return ((nombre?.[0] || '') + (apellidos?.[0] || '')).toUpperCase() || '·';
}
function fmtRelative(iso) {
  if (!iso) return '<span class="users-muted">Sin conexión</span>';
  const utcIso = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return escapeHtml(iso);
  const diffMs = Date.now() - d.getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return 'hace instantes';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `hace ${days} d`;
  return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtShortDate(iso) {
  if (!iso) return '—';
  const utcIso = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

let usersCache = [];

function renderUsersRows(users) {
  if (!users.length) {
    usersTbody.innerHTML = '<tr class="users-empty-row"><td colspan="5">No hay usuarios registrados.</td></tr>';
    return;
  }
  usersTbody.innerHTML = users.map((u) => {
    const isSelf = currentUser && currentUser.id === u.id;
    const isActive = u.estatus === 'activo';
    const status = isActive
      ? '<span class="badge badge-success">Activo</span>'
      : '<span class="badge badge-muted">Inactivo</span>';

    const toggleDisabled = isSelf && isActive;
    const toggleTitle = toggleDisabled
      ? 'No puedes inactivar tu propia cuenta'
      : (isActive ? 'Inactivar' : 'Reactivar');
    const toggleIcon = isActive ? I.ban(15) : I.refresh(15);
    const toggleClass = isActive ? 'row-icon-btn--danger' : 'row-icon-btn--success';

    return `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-cell-avatar">${escapeHtml(initials(u.nombre, u.apellidos))}</div>
            <div class="user-cell-text">
              <div class="user-cell-name">${escapeHtml(u.nombre)} ${escapeHtml(u.apellidos)}</div>
              <div class="user-cell-handle">@${escapeHtml(u.username)}</div>
            </div>
          </div>
        </td>
        <td>${status}</td>
        <td>${fmtRelative(u.fecha_ultima_conexion)}</td>
        <td>${escapeHtml(fmtShortDate(u.fecha_creacion))}</td>
        <td>
          <div class="users-row-actions">
            <button type="button" class="row-icon-btn" data-action="edit" data-id="${u.id}" title="Editar" aria-label="Editar">${I.edit(15)}</button>
            <button type="button" class="row-icon-btn ${toggleClass}" data-action="toggle" data-id="${u.id}" title="${toggleTitle}" aria-label="${toggleTitle}" ${toggleDisabled ? 'disabled' : ''}>${toggleIcon}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadUsers() {
  usersTbody.innerHTML = '<tr class="users-empty-row"><td colspan="5">Cargando…</td></tr>';
  usersCount.textContent = '—';
  const res = await window.api.listUsers();
  if (!res?.ok) {
    usersTbody.innerHTML = `<tr class="users-empty-row"><td colspan="5">No se pudieron cargar los usuarios.</td></tr>`;
    return;
  }
  usersCache = res.users;
  usersCount.textContent = String(res.users.length);
  renderUsersRows(res.users);
  usersLoaded = true;
}

document.getElementById('users-refresh').addEventListener('click', loadUsers);

// ── User modal: create + edit ──────────────────────────────────
const userModal = document.getElementById('user-modal');
const userForm = document.getElementById('user-form');
const umTitle = document.getElementById('user-modal-title');
const umNombre = document.getElementById('um-nombre');
const umApellidos = document.getElementById('um-apellidos');
const umUsername = document.getElementById('um-username');
const umUsernameHint = document.getElementById('um-username-hint');
const umPassword = document.getElementById('um-password');
const umPasswordLabel = document.getElementById('um-password-label');
const umPasswordHint = document.getElementById('um-password-hint');
const umPassword2 = document.getElementById('um-password2');
const umPassword2Label = document.getElementById('um-password2-label');
const umPassword2Shell = document.getElementById('um-password2-shell');
const umPassword2Error = document.getElementById('um-password2-error');
const umError = document.getElementById('um-error');
const umSubmit = document.getElementById('um-submit');
const umPwRules = document.getElementById('um-pw-rules');
const umPermsNote = document.getElementById('um-perms-note');
document.getElementById('um-perms-note-icon').innerHTML = I.alert(13);

let editingId = null;
let submitToken = 0;

function renderPwRules() {
  const pw = umPassword.value;
  if (!pw) {
    umPwRules.classList.add('hidden');
    umPwRules.innerHTML = '';
    return;
  }
  const { rules } = P.check(pw);
  umPwRules.classList.remove('hidden');
  umPwRules.innerHTML = rules.map((r) =>
    `<li class="${r.ok ? 'is-ok' : ''}">${r.label}</li>`
  ).join('');
}
function renderPw2Match() {
  const pw = umPassword.value;
  const pw2 = umPassword2.value;
  const mismatch = pw && pw2 && pw !== pw2;
  umPassword2Error.classList.toggle('hidden', !mismatch);
  umPassword2Shell.classList.toggle('is-error', !!mismatch);
  umPassword2Label.classList.toggle('is-error', !!mismatch);
  if (mismatch) umPassword2Error.textContent = 'Las contraseñas no coinciden.';
  else umPassword2Error.textContent = '';
}
umPassword.addEventListener('input', () => { renderPwRules(); renderPw2Match(); });
umPassword2.addEventListener('input', renderPw2Match);
document.getElementById('icon-users-new').innerHTML = I.plus(12);
document.getElementById('icon-modal-close').innerHTML = I.close(16);

function openUserModal(user = null) {
  editingId = user?.id ?? null;
  umError.classList.add('hidden');
  umError.textContent = '';

  if (user) {
    umTitle.textContent = 'Editar usuario';
    umNombre.value = user.nombre || '';
    umApellidos.value = user.apellidos || '';
    umUsername.value = user.username || '';
    umPassword.value = '';
    umPassword2.value = '';
    umPasswordLabel.textContent = 'Nueva contraseña (opcional)';
    umPasswordHint.textContent = 'Dejar en blanco para conservar la actual.';
    umPassword2Label.textContent = 'Confirmar nueva contraseña';

    const isSelf = currentUser && currentUser.id === user.id;
    umUsername.disabled = isSelf;
    umUsernameHint.textContent = isSelf
      ? 'No puedes cambiar tu propio usuario.'
      : 'Mínimo 2 caracteres. Letras, números, punto, guion.';
    umPermsNote.classList.add('hidden');
  } else {
    umTitle.textContent = 'Nuevo usuario';
    umNombre.value = '';
    umApellidos.value = '';
    umUsername.value = '';
    umPassword.value = '';
    umPassword2.value = '';
    umPasswordLabel.textContent = 'Contraseña';
    umPasswordHint.textContent = 'Debe cumplir los criterios siguientes.';
    umPassword2Label.textContent = 'Confirmar contraseña';
    umUsername.disabled = false;
    umUsernameHint.textContent = 'Mínimo 2 caracteres. Letras, números, punto, guion.';
    umPermsNote.classList.remove('hidden');
  }

  renderPwRules();
  renderPw2Match();
  userModal.classList.remove('hidden');
  setTimeout(() => umNombre.focus(), 30);
}

function closeUserModal() {
  userModal.classList.add('hidden');
  editingId = null;
  submitToken++;
}

userModal.addEventListener('click', (e) => {
  if (e.target === userModal || e.target.closest('[data-modal-close]')) {
    closeUserModal();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !userModal.classList.contains('hidden')) closeUserModal();
});

document.getElementById('users-new-btn').addEventListener('click', () => openUserModal(null));

userForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  umError.classList.add('hidden');
  umError.textContent = '';

  const payload = {
    nombre: umNombre.value,
    apellidos: umApellidos.value,
    username: umUsername.value,
    password: umPassword.value,
  };

  const passwordRequired = !editingId;
  const isChangingPassword = passwordRequired || !!payload.password || !!umPassword2.value;
  if (isChangingPassword) {
    const pw = P.check(payload.password);
    if (!pw.ok) {
      umError.textContent = pw.firstError;
      umError.classList.remove('hidden');
      return;
    }
    if (!umPassword2.value) {
      umError.textContent = 'Confirma la contraseña.';
      umError.classList.remove('hidden');
      return;
    }
    if (payload.password !== umPassword2.value) {
      umError.textContent = 'Las contraseñas no coinciden.';
      umError.classList.remove('hidden');
      return;
    }
  }

  const myToken = ++submitToken;
  umSubmit.disabled = true;
  const prevLabel = umSubmit.textContent;
  umSubmit.textContent = editingId ? 'Guardando…' : 'Creando…';

  const res = editingId
    ? await window.api.updateUser(editingId, payload)
    : await window.api.createUser(payload);

  // Stale response (modal was closed/reopened mid-flight): drop it silently.
  if (myToken !== submitToken) return;

  umSubmit.disabled = false;
  umSubmit.textContent = prevLabel;

  if (!res?.ok) {
    umError.textContent = res?.error || 'No se pudo guardar';
    umError.classList.remove('hidden');
    return;
  }

  if (editingId && currentUser && currentUser.id === editingId) {
    const fresh = await window.api.getCurrentUser();
    if (fresh) currentUser = fresh;
  }

  permsLoaded = false;
  closeUserModal();
  await loadUsers();
});

// ── Row actions: edit + toggle estatus ────────────────────────
usersTbody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const user = usersCache.find((u) => u.id === id);
  if (!user) return;

  if (btn.dataset.action === 'edit') {
    openUserModal(user);
    return;
  }

  if (btn.dataset.action === 'toggle') {
    const next = user.estatus === 'activo' ? 'inactivo' : 'activo';
    const verb = next === 'inactivo' ? 'inactivar' : 'reactivar';
    const ok = window.confirm(`¿Seguro que quieres ${verb} a @${user.username}?`);
    if (!ok) return;

    btn.disabled = true;
    const res = await window.api.setUserEstatus(id, next);
    if (!res?.ok) {
      alert(res?.error || 'No se pudo cambiar el estatus');
      btn.disabled = false;
      return;
    }
    permsLoaded = false;
    await loadUsers();
  }
});

// ── Empleados view ────────────────────────────────────────────
const empleadosTbody = document.getElementById('empleados-tbody');
const empleadosCount = document.getElementById('empleados-count');
let empleadosCache = [];
let empleadosLoaded = false;

function renderEmpleadosRows(list) {
  if (!list.length) {
    empleadosTbody.innerHTML = '<tr class="users-empty-row"><td colspan="6">No hay empleados registrados.</td></tr>';
    return;
  }
  empleadosTbody.innerHTML = list.map((e) => {
    const isActive = e.estatus === 'activo';
    const status = isActive
      ? '<span class="badge badge-success">Activo</span>'
      : '<span class="badge badge-muted">Inactivo</span>';
    const toggleTitle = isActive ? 'Inactivar' : 'Reactivar';
    const toggleIcon = isActive ? I.ban(15) : I.refresh(15);
    const toggleClass = isActive ? 'row-icon-btn--danger' : 'row-icon-btn--success';
    return `
      <tr>
        <td><span class="user-cell-handle">${escapeHtml(e.numero_empleado)}</span></td>
        <td>
          <div class="user-cell">
            <div class="user-cell-avatar">${escapeHtml(initials(e.nombre, e.apellidos))}</div>
            <div class="user-cell-text">
              <div class="user-cell-name">${escapeHtml(e.nombre)} ${escapeHtml(e.apellidos)}</div>
            </div>
          </div>
        </td>
        <td>${escapeHtml(e.puesto || '—')}</td>
        <td>${escapeHtml(e.departamento || '—')}</td>
        <td>${status}</td>
        <td>
          <div class="users-row-actions">
            <button type="button" class="row-icon-btn" data-emp-action="edit" data-id="${e.id}" title="Editar" aria-label="Editar">${I.edit(15)}</button>
            <button type="button" class="row-icon-btn ${toggleClass}" data-emp-action="toggle" data-id="${e.id}" title="${toggleTitle}" aria-label="${toggleTitle}">${toggleIcon}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadEmpleados() {
  empleadosTbody.innerHTML = '<tr class="users-empty-row"><td colspan="6">Cargando…</td></tr>';
  empleadosCount.textContent = '—';
  const res = await window.api.listEmpleados();
  if (!res?.ok) {
    empleadosTbody.innerHTML = `<tr class="users-empty-row"><td colspan="6">${escapeHtml(res?.error || 'No se pudieron cargar los empleados.')}</td></tr>`;
    return;
  }
  empleadosCache = res.empleados;
  empleadosCount.textContent = String(res.empleados.length);
  renderEmpleadosRows(res.empleados);
  empleadosLoaded = true;
}

document.getElementById('empleados-refresh').addEventListener('click', loadEmpleados);

// ── Empleado modal: create + edit ──────────────────────────────
const empleadoModal = document.getElementById('empleado-modal');
const empleadoForm = document.getElementById('empleado-form');
const emTitle = document.getElementById('empleado-modal-title');
const emNumero = document.getElementById('em-numero');
const emNombre = document.getElementById('em-nombre');
const emApellidos = document.getElementById('em-apellidos');
const emPuesto = document.getElementById('em-puesto');
const emDepartamento = document.getElementById('em-departamento');
const emError = document.getElementById('em-error');
const emSubmit = document.getElementById('em-submit');
const emNumeroField = document.getElementById('em-numero-field');
const emAutoNumeroHint = document.getElementById('em-auto-numero');

let empEditingId = null;
let empSubmitToken = 0;
let empCreatedCallback = null;

document.getElementById('icon-empleados-new').innerHTML = I.plus(12);
document.getElementById('icon-empmodal-close').innerHTML = I.close(16);

function openEmpleadoModal(emp = null, onCreated = null) {
  empEditingId = emp?.id ?? null;
  empCreatedCallback = onCreated;
  emError.classList.add('hidden');
  emError.textContent = '';

  if (emp) {
    emTitle.textContent = 'Editar empleado';
    emNumero.value = emp.numero_empleado || '';
    emNombre.value = emp.nombre || '';
    emApellidos.value = emp.apellidos || '';
    emPuesto.value = emp.puesto || '';
    emDepartamento.value = emp.departamento || '';
    emNumeroField.classList.remove('hidden');
    emAutoNumeroHint.classList.add('hidden');
  } else {
    emTitle.textContent = 'Nuevo empleado';
    emNumero.value = '';
    emNombre.value = '';
    emApellidos.value = '';
    emPuesto.value = '';
    emDepartamento.value = '';
    // Auto-generated: hide the field, show a hint instead.
    emNumeroField.classList.add('hidden');
    emAutoNumeroHint.classList.remove('hidden');
  }

  empleadoModal.classList.remove('hidden');
  setTimeout(() => (emp ? emNumero : emNombre).focus(), 30);
}

function closeEmpleadoModal() {
  empleadoModal.classList.add('hidden');
  empEditingId = null;
  empCreatedCallback = null;
  empSubmitToken++;
}

empleadoModal.addEventListener('click', (e) => {
  if (e.target === empleadoModal || e.target.closest('[data-empmodal-close]')) {
    closeEmpleadoModal();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !empleadoModal.classList.contains('hidden')) closeEmpleadoModal();
});

document.getElementById('empleados-new-btn').addEventListener('click', () => openEmpleadoModal(null));

empleadoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  emError.classList.add('hidden');
  emError.textContent = '';

  const payload = {
    numero_empleado: emNumero.value,
    nombre: emNombre.value,
    apellidos: emApellidos.value,
    puesto: emPuesto.value,
    departamento: emDepartamento.value,
  };

  const myToken = ++empSubmitToken;
  emSubmit.disabled = true;
  const prevLabel = emSubmit.textContent;
  emSubmit.textContent = empEditingId ? 'Guardando…' : 'Creando…';

  const res = empEditingId
    ? await window.api.updateEmpleado(empEditingId, payload)
    : await window.api.createEmpleado(payload);

  if (myToken !== empSubmitToken) return;

  emSubmit.disabled = false;
  emSubmit.textContent = prevLabel;

  if (!res?.ok) {
    emError.textContent = res?.error || 'No se pudo guardar';
    emError.classList.remove('hidden');
    return;
  }

  const cb = empCreatedCallback;
  const wasCreating = !empEditingId;
  closeEmpleadoModal();
  await loadEmpleados();
  if (wasCreating && cb && res.empleado) cb(res.empleado);
});

empleadosTbody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-emp-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const emp = empleadosCache.find((x) => x.id === id);
  if (!emp) return;

  if (btn.dataset.empAction === 'edit') {
    openEmpleadoModal(emp);
    return;
  }

  if (btn.dataset.empAction === 'toggle') {
    const next = emp.estatus === 'activo' ? 'inactivo' : 'activo';
    const verb = next === 'inactivo' ? 'inactivar' : 'reactivar';
    const ok = window.confirm(`¿Seguro que quieres ${verb} a ${emp.nombre} ${emp.apellidos}?`);
    if (!ok) return;

    btn.disabled = true;
    const res = await window.api.setEmpleadoEstatus(id, next);
    if (!res?.ok) {
      alert(res?.error || 'No se pudo cambiar el estatus');
      btn.disabled = false;
      return;
    }
    await loadEmpleados();
  }
});

// ── Motivos (sub-vista de Catálogos) ──────────────────────────
const tiposTbody = document.getElementById('tipos-tbody');
const tiposCount = document.getElementById('tipos-count');
const tipoModal = document.getElementById('tipo-modal');
const tipoForm = document.getElementById('tipo-form');
const tipoModalTitle = document.getElementById('tipo-modal-title');
const tipoValor = document.getElementById('tipo-valor');
const tipoError = document.getElementById('tipo-error');
const tipoSubmit = document.getElementById('tipo-submit');
let tiposCache = [];
let tipoEditingId = null;
let tipoSubmitToken = 0;

document.getElementById('icon-tipos-new').innerHTML = I.plus(12);
document.getElementById('icon-tipomodal-close').innerHTML = I.close(16);

function renderTiposRows(list) {
  if (!list.length) {
    tiposTbody.innerHTML = '<tr class="users-empty-row"><td colspan="2">No hay tipos registrados.</td></tr>';
    return;
  }
  tiposTbody.innerHTML = list.map((t) => `
    <tr>
      <td><div class="user-cell-name">${escapeHtml(t.valor)}</div></td>
      <td>
        <div class="users-row-actions">
          <button type="button" class="row-icon-btn" data-tipo-action="edit" data-id="${t.id}" title="Editar" aria-label="Editar">${I.edit(15)}</button>
          <button type="button" class="row-icon-btn row-icon-btn--danger" data-tipo-action="delete" data-id="${t.id}" title="Eliminar" aria-label="Eliminar">${I.trash(15)}</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function loadTiposAll() {
  tiposTbody.innerHTML = '<tr class="users-empty-row"><td colspan="2">Cargando…</td></tr>';
  tiposCount.textContent = '—';
  const res = await window.api.listCatalogoAll('motivos');
  if (!res?.ok) {
    tiposTbody.innerHTML = `<tr class="users-empty-row"><td colspan="2">${escapeHtml(res?.error || 'No se pudieron cargar los tipos.')}</td></tr>`;
    return;
  }
  tiposCache = res.items;
  tiposCount.textContent = String(res.items.length);
  renderTiposRows(res.items);
}

function openTipoModal(item = null) {
  tipoEditingId = item?.id ?? null;
  tipoError.classList.add('hidden');
  tipoError.textContent = '';
  if (item) {
    tipoModalTitle.textContent = 'Editar motivo';
    tipoValor.value = item.valor || '';
  } else {
    tipoModalTitle.textContent = 'Nuevo motivo';
    tipoValor.value = '';
  }
  tipoModal.classList.remove('hidden');
  setTimeout(() => tipoValor.focus(), 30);
}

function closeTipoModal() {
  tipoModal.classList.add('hidden');
  tipoEditingId = null;
  tipoSubmitToken++;
}

tipoModal.addEventListener('click', (e) => {
  if (e.target === tipoModal || e.target.closest('[data-tipomodal-close]')) {
    closeTipoModal();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !tipoModal.classList.contains('hidden')) closeTipoModal();
});

document.getElementById('tipos-new-btn').addEventListener('click', () => openTipoModal(null));
document.getElementById('tipos-refresh').addEventListener('click', loadTiposAll);

tipoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  tipoError.classList.add('hidden');
  tipoError.textContent = '';
  const valor = tipoValor.value.trim();
  if (!valor) {
    tipoError.textContent = 'Escribe un nombre.';
    tipoError.classList.remove('hidden');
    return;
  }

  const myToken = ++tipoSubmitToken;
  tipoSubmit.disabled = true;
  const prevLabel = tipoSubmit.textContent;
  tipoSubmit.textContent = tipoEditingId ? 'Guardando…' : 'Creando…';

  const res = tipoEditingId
    ? await window.api.updateCatalogoItem(tipoEditingId, valor)
    : await window.api.addCatalogoItem('motivos', valor);

  if (myToken !== tipoSubmitToken) return;

  tipoSubmit.disabled = false;
  tipoSubmit.textContent = prevLabel;

  if (!res?.ok) {
    tipoError.textContent = res?.error || 'No se pudo guardar';
    tipoError.classList.remove('hidden');
    return;
  }

  closeTipoModal();
  await loadTiposAll();
});

tiposTbody.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-tipo-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const item = tiposCache.find((x) => x.id === id);
  if (!item) return;

  if (btn.dataset.tipoAction === 'edit') {
    openTipoModal(item);
    return;
  }

  if (btn.dataset.tipoAction === 'delete') {
    const ok = window.confirm(
      `¿Eliminar permanentemente "${item.valor}"?\n\nLos eventos pasados que lo usaron conservarán el nombre en el histórico, pero ya no podrá seleccionarse para nuevos registros.`
    );
    if (!ok) return;
    btn.disabled = true;
    const res = await window.api.deleteCatalogoItem(id);
    if (!res?.ok) {
      alert(res?.error || 'No se pudo eliminar');
      btn.disabled = false;
      return;
    }
    await loadTiposAll();
  }
});

// ── Registro view (solo histórico + botón a la página) ────────
const regLogTbody = document.getElementById('reg-log-tbody');
const regLogCount = document.getElementById('reg-log-count');
document.getElementById('icon-reg-new').innerHTML = I.plus(12);

document.getElementById('reg-open-new').addEventListener('click', () => {
  window.location.href = '../registro-nuevo/registro-nuevo.html';
});

function fmtTime(iso) {
  if (!iso) return '—';
  const utcIso = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const utcIso = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-MX', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function tipoBadge(tipo) {
  const cls = tipo === 'entrada' ? 'reg-tipo-badge--in' : 'reg-tipo-badge--out';
  const label = tipo === 'entrada' ? 'Entrada' : 'Salida';
  return `<span class="reg-tipo-badge ${cls}">${label}</span>`;
}

function renderMotivo(ev) {
  if (!ev.motivo_tipo && !ev.motivo_detalle) return '<span class="users-muted">—</span>';
  const tipo = ev.motivo_tipo
    ? `<div>${escapeHtml(ev.motivo_tipo)}</div>`
    : '';
  const detalle = ev.motivo_detalle
    ? `<div class="user-cell-handle">${escapeHtml(ev.motivo_detalle)}</div>`
    : '';
  return `<div class="user-cell-text">${tipo}${detalle}</div>`;
}

let todayEventsCache = [];

function renderTodayEvents(eventos) {
  if (!eventos.length) {
    regLogTbody.innerHTML = '<tr class="users-empty-row"><td colspan="6">Sin eventos hoy.</td></tr>';
    regLogCount.textContent = '0';
    return;
  }
  regLogCount.textContent = String(eventos.length);
  regLogTbody.innerHTML = eventos.map((ev) => `
    <tr>
      <td><span class="user-cell-handle">${escapeHtml(fmtDateTime(ev.timestamp))}</span></td>
      <td>
        <div class="user-cell">
          <div class="user-cell-text">
            <div class="user-cell-name">${escapeHtml(ev.emp_nombre)} ${escapeHtml(ev.emp_apellidos)}</div>
            <div class="user-cell-handle">#${escapeHtml(ev.numero_empleado)}</div>
          </div>
        </div>
      </td>
      <td>${tipoBadge(ev.tipo)}</td>
      <td>${renderMotivo(ev)}</td>
      <td><span class="users-muted">@${escapeHtml(ev.registrado_por_username)}</span></td>
      <td>
        <div class="users-row-actions">
          <button type="button" class="row-icon-btn" data-evt-action="edit" data-id="${ev.id}" title="Editar" aria-label="Editar">${I.edit(15)}</button>
          <button type="button" class="row-icon-btn row-icon-btn--danger" data-evt-action="delete" data-id="${ev.id}" title="Eliminar" aria-label="Eliminar">${I.trash(15)}</button>
        </div>
      </td>
    </tr>
  `).join('');
}

async function loadTodayEvents() {
  regLogTbody.innerHTML = '<tr class="users-empty-row"><td colspan="6">Cargando…</td></tr>';
  const res = await window.api.listTodayEvents();
  if (!res?.ok) {
    regLogTbody.innerHTML = `<tr class="users-empty-row"><td colspan="6">${escapeHtml(res?.error || 'No se pudieron cargar los eventos.')}</td></tr>`;
    return;
  }
  todayEventsCache = res.eventos;
  renderTodayEvents(res.eventos);
}

document.getElementById('reg-log-refresh').addEventListener('click', loadTodayEvents);

// ── Edit / Delete event modals ────────────────────────────────
const evtEditModal = document.getElementById('evt-edit-modal');
const evtEditForm = document.getElementById('evt-edit-form');
const evtEditEmpleado = document.getElementById('evt-edit-empleado');
const evtEditTipo = document.getElementById('evt-edit-tipo');
const evtEditTs = document.getElementById('evt-edit-ts');
const evtEditMotivo = document.getElementById('evt-edit-motivo');
const evtEditMotivoReq = document.getElementById('evt-edit-motivo-req');
const evtEditDetalle = document.getElementById('evt-edit-detalle');
const evtEditPw = document.getElementById('evt-edit-pw');
const evtEditError = document.getElementById('evt-edit-error');
const evtEditSubmit = document.getElementById('evt-edit-submit');

const evtDelModal = document.getElementById('evt-del-modal');
const evtDelForm = document.getElementById('evt-del-form');
const evtDelSummary = document.getElementById('evt-del-summary');
const evtDelPw = document.getElementById('evt-del-pw');
const evtDelError = document.getElementById('evt-del-error');
const evtDelSubmit = document.getElementById('evt-del-submit');

document.getElementById('icon-evtmodal-close').innerHTML = I.close(16);
document.getElementById('icon-delmodal-close').innerHTML = I.close(16);

let editingEventId = null;
let deletingEventId = null;

function utcToLocalInput(utcIso) {
  if (!utcIso) return '';
  const withT = utcIso.includes('T') ? utcIso : utcIso.replace(' ', 'T') + 'Z';
  const d = new Date(withT);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

function localInputToUtcSqlite(localValue) {
  if (!localValue) return '';
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function populateMotivoSelect(selectEl, currentValue = '') {
  const res = await window.api.listCatalogo('motivos', { activeOnly: true });
  if (!res?.ok) return;
  const items = res.items.map((i) => i.valor);
  selectEl.innerHTML = ['<option value="">— sin motivo —</option>']
    .concat(items.map((v) => `<option value="${escapeHtml(v)}"${currentValue === v ? ' selected' : ''}>${escapeHtml(v)}</option>`))
    .join('');
}

async function openEvtEditModal(ev) {
  editingEventId = ev.id;
  evtEditError.classList.add('hidden');
  evtEditError.textContent = '';
  evtEditPw.value = '';
  evtEditEmpleado.textContent = `${ev.emp_nombre} ${ev.emp_apellidos} · #${ev.numero_empleado}`;
  evtEditTipo.value = ev.tipo;
  evtEditTs.value = utcToLocalInput(ev.timestamp);
  evtEditDetalle.value = ev.motivo_detalle || '';
  evtEditMotivoReq.textContent = ev.tipo === 'salida' ? '(obligatorio)' : '(opcional)';
  await populateMotivoSelect(evtEditMotivo, ev.motivo_tipo || '');
  evtEditModal.classList.remove('hidden');
  setTimeout(() => evtEditTs.focus(), 30);
}

evtEditTipo.addEventListener('change', () => {
  evtEditMotivoReq.textContent = evtEditTipo.value === 'salida' ? '(obligatorio)' : '(opcional)';
});

function closeEvtEditModal() {
  evtEditModal.classList.add('hidden');
  editingEventId = null;
  evtEditPw.value = '';
}

evtEditModal.addEventListener('click', (e) => {
  if (e.target === evtEditModal || e.target.closest('[data-evtmodal-close]')) {
    closeEvtEditModal();
  }
});

evtEditForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  evtEditError.classList.add('hidden');
  evtEditError.textContent = '';
  const newTipo = evtEditTipo.value;
  const newMotivo = evtEditMotivo.value;
  if (newTipo === 'salida' && !newMotivo) {
    evtEditError.textContent = 'Selecciona el motivo de la salida.';
    evtEditError.classList.remove('hidden');
    return;
  }
  if (!evtEditPw.value) {
    evtEditError.textContent = 'Ingresa tu contraseña para confirmar.';
    evtEditError.classList.remove('hidden');
    return;
  }
  evtEditSubmit.disabled = true;
  const prev = evtEditSubmit.textContent;
  evtEditSubmit.textContent = 'Guardando…';

  const res = await window.api.updateEvent(
    editingEventId,
    {
      tipo: newTipo,
      timestamp: localInputToUtcSqlite(evtEditTs.value),
      motivoTipo: newMotivo,
      motivoDetalle: evtEditDetalle.value,
    },
    evtEditPw.value
  );

  evtEditSubmit.disabled = false;
  evtEditSubmit.textContent = prev;

  if (!res?.ok) {
    evtEditError.textContent = res?.error || 'No se pudo guardar';
    evtEditError.classList.remove('hidden');
    return;
  }
  closeEvtEditModal();
  await loadTodayEvents();
});

function openEvtDelModal(ev) {
  deletingEventId = ev.id;
  evtDelError.classList.add('hidden');
  evtDelError.textContent = '';
  evtDelPw.value = '';
  const motivoBit = ev.motivo_tipo ? ` · ${ev.motivo_tipo}` : '';
  evtDelSummary.innerHTML = `
    <div><b>${escapeHtml(ev.emp_nombre)} ${escapeHtml(ev.emp_apellidos)}</b> · #${escapeHtml(ev.numero_empleado)}</div>
    <div class="users-muted">${fmtTime(ev.timestamp)} · ${escapeHtml(ev.tipo)}${escapeHtml(motivoBit)}</div>
  `;
  evtDelModal.classList.remove('hidden');
  setTimeout(() => evtDelPw.focus(), 30);
}

function closeEvtDelModal() {
  evtDelModal.classList.add('hidden');
  deletingEventId = null;
  evtDelPw.value = '';
}

evtDelModal.addEventListener('click', (e) => {
  if (e.target === evtDelModal || e.target.closest('[data-delmodal-close]')) {
    closeEvtDelModal();
  }
});

evtDelForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  evtDelError.classList.add('hidden');
  evtDelError.textContent = '';
  if (!evtDelPw.value) {
    evtDelError.textContent = 'Ingresa tu contraseña para confirmar.';
    evtDelError.classList.remove('hidden');
    return;
  }
  evtDelSubmit.disabled = true;
  const prev = evtDelSubmit.textContent;
  evtDelSubmit.textContent = 'Eliminando…';

  const res = await window.api.deleteEvent(deletingEventId, evtDelPw.value);

  evtDelSubmit.disabled = false;
  evtDelSubmit.textContent = prev;

  if (!res?.ok) {
    evtDelError.textContent = res?.error || 'No se pudo eliminar';
    evtDelError.classList.remove('hidden');
    return;
  }
  closeEvtDelModal();
  await loadTodayEvents();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!evtEditModal.classList.contains('hidden')) closeEvtEditModal();
  else if (!evtDelModal.classList.contains('hidden')) closeEvtDelModal();
});

regLogTbody.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-evt-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const ev = todayEventsCache.find((x) => x.id === id);
  if (!ev) return;
  if (btn.dataset.evtAction === 'edit') openEvtEditModal(ev);
  else if (btn.dataset.evtAction === 'delete') openEvtDelModal(ev);
});

// ── Sidebar navigation ────────────────────────────────────────
const VIEWS = {
  dashboard:                { eyebrow: 'Panel',         title: 'Dashboard' },
  registro:                 { eyebrow: 'Asistencia',    title: 'Registro' },
  empleados:                { eyebrow: 'Personal',      title: 'Empleados' },
  'tipos-salida':           { eyebrow: 'Catálogos',     title: 'Motivos' },
  'rep-asistencia-dia':     { eyebrow: 'Reportes',      title: 'Asistencia del día' },
  'rep-historial':          { eyebrow: 'Reportes',      title: 'Historial por empleado' },
  'rep-salidas-motivo':     { eyebrow: 'Reportes',      title: 'Salidas por motivo' },
  'rep-horas-dentro-fuera': { eyebrow: 'Reportes',      title: 'Horas dentro/fuera' },
  'configuracion-general':  { eyebrow: 'Configuración', title: 'General' },
  usuarios:                 { eyebrow: 'Configuración', title: 'Usuarios' },
  accesos:                  { eyebrow: 'Configuración', title: 'Accesos' },
  auditoria:                { eyebrow: 'Configuración', title: 'Auditoría' },
  apariencia:               { eyebrow: 'Configuración', title: 'Apariencia' },
};
const CONFIG_VIEWS = new Set(['configuracion-general', 'usuarios', 'accesos', 'auditoria', 'apariencia']);
const CATALOGOS_VIEWS = new Set(['tipos-salida']);
const REPORTES_VIEWS = new Set(['rep-asistencia-dia', 'rep-historial', 'rep-salidas-motivo', 'rep-horas-dentro-fuera']);

const navItems = document.querySelectorAll('#sidebar-nav .nav-item[data-view]');
const viewEls = document.querySelectorAll('.view');
const eyebrowEl = document.getElementById('view-eyebrow');
const titleEl = document.getElementById('view-title');
const configGroup = document.getElementById('nav-group-config');
const configToggle = configGroup.querySelector('.nav-group-toggle');
const catalogosGroup = document.getElementById('nav-group-catalogos');
const catalogosToggle = catalogosGroup.querySelector('.nav-group-toggle');
const reportesGroup = document.getElementById('nav-group-reportes');
const reportesToggle = reportesGroup.querySelector('.nav-group-toggle');
document.getElementById('nav-icon-chevron-catalogos').innerHTML = I.chevron(13);
document.getElementById('nav-icon-tipos-salida').innerHTML = I.clipboard(15);
document.getElementById('nav-icon-reportes').innerHTML = I.clipboard(17);
document.getElementById('nav-icon-chevron-reportes').innerHTML = I.chevron(13);
document.getElementById('nav-icon-rep-asistencia').innerHTML = I.registro(15);
document.getElementById('nav-icon-rep-historial').innerHTML = I.user(15);
document.getElementById('nav-icon-rep-salidas').innerHTML = I.exit(15);
document.getElementById('nav-icon-rep-horas').innerHTML = I.clipboard(15);
document.getElementById('nav-icon-configuracion-general').innerHTML = I.settings(15);

function setGroupOpen(open) {
  configGroup.classList.toggle('is-open', open);
  configToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function setCatalogosGroupOpen(open) {
  catalogosGroup.classList.toggle('is-open', open);
  catalogosToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}
function setReportesGroupOpen(open) {
  reportesGroup.classList.toggle('is-open', open);
  reportesToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function switchView(key) {
  if (!VIEWS[key]) return;
  if (!PERMS.canSee(currentUser, key)) return;
  navItems.forEach((b) => b.classList.toggle('is-active', b.dataset.view === key));
  viewEls.forEach((v) => v.classList.toggle('is-active', v.dataset.view === key));
  eyebrowEl.textContent = VIEWS[key].eyebrow;
  titleEl.textContent = VIEWS[key].title;
  configToggle.classList.toggle('is-active-parent', CONFIG_VIEWS.has(key));
  catalogosToggle.classList.toggle('is-active-parent', CATALOGOS_VIEWS.has(key));
  reportesToggle.classList.toggle('is-active-parent', REPORTES_VIEWS.has(key));
  if (CONFIG_VIEWS.has(key)) setGroupOpen(true);
  if (CATALOGOS_VIEWS.has(key)) setCatalogosGroupOpen(true);
  if (REPORTES_VIEWS.has(key)) setReportesGroupOpen(true);
  if (key === 'usuarios' && !usersLoaded) loadUsers();
  if (key === 'accesos' && !permsLoaded) loadPerms();
  if (key === 'empleados' && !empleadosLoaded) loadEmpleados();
  if (key === 'registro') loadTodayEvents();
  if (key === 'rep-historial') loadRepHiEmpleados();
  if (key === 'rep-horas-dentro-fuera') refreshHdScheduleNote();
  if (key === 'configuracion-general' && !cfgLoaded) loadCfgSchedule();
  if (key === 'auditoria') { loadAuditFilters().then(loadAuditLog); }
  if (key === 'dashboard') startDashboardAutoRefresh();
  else stopDashboardAutoRefresh();
  if (key === 'tipos-salida') loadTiposAll();
}
navItems.forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// Toggle expand/collapse for Configuración group
configToggle.addEventListener('click', () => {
  setGroupOpen(!configGroup.classList.contains('is-open'));
});
catalogosToggle.addEventListener('click', () => {
  setCatalogosGroupOpen(!catalogosGroup.classList.contains('is-open'));
});
reportesToggle.addEventListener('click', () => {
  setReportesGroupOpen(!reportesGroup.classList.contains('is-open'));
});

// ── Sidebar toggle (narrow widths) ────────────────────────────
const sidebar = document.getElementById('sidebar');
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  sidebar.classList.toggle('is-collapsed');
});

// ── Accesos view ──────────────────────────────────────────────
const permsTbody = document.getElementById('perms-tbody');
const permsHead = document.getElementById('perms-head');
const permsSaveBtn = document.getElementById('perms-save-btn');
const permsDirtyTag = document.getElementById('perms-dirty-tag');
let permsLoaded = false;
let permsState = []; // { id, username, nombre, apellidos, original: Set, current: Set }

function permsIsDirty() {
  return permsState.some((row) => {
    if (row.original.size !== row.current.size) return true;
    for (const p of row.current) if (!row.original.has(p)) return true;
    return false;
  });
}

function renderPermsDirty() {
  const dirty = permsIsDirty();
  permsSaveBtn.disabled = !dirty;
  permsDirtyTag.classList.toggle('hidden', !dirty);
}

function renderPermsHead() {
  const cols = PERMS.MODULES.map(
    (m) => `<th class="perms-col">${escapeHtml(m.label)}</th>`
  ).join('');
  permsHead.innerHTML = `<th style="width: 28%;">Usuario</th>${cols}`;
}

function renderPermsRows() {
  if (!permsState.length) {
    permsTbody.innerHTML = `<tr class="users-empty-row"><td colspan="${PERMS.MODULES.length + 1}">No hay usuarios.</td></tr>`;
    return;
  }
  permsTbody.innerHTML = permsState.map((row) => {
    const isSelf = currentUser && currentUser.id === row.id;
    const cells = PERMS.MODULES.map((m) => {
      const checked = row.current.has(m.key);
      const lockSelfAccesos = isSelf && m.key === 'accesos';
      return `
        <td class="perms-cell">
          <input type="checkbox" class="perms-checkbox"
            data-user-id="${row.id}" data-perm="${m.key}"
            ${checked ? 'checked' : ''}
            ${lockSelfAccesos ? 'disabled title="No puedes quitarte el permiso de Accesos"' : ''}
          />
        </td>
      `;
    }).join('');
    return `
      <tr>
        <td>
          <div class="user-cell">
            <div class="user-cell-avatar">${escapeHtml(initials(row.nombre, row.apellidos))}</div>
            <div class="user-cell-text">
              <div class="user-cell-name">${escapeHtml(row.nombre)} ${escapeHtml(row.apellidos)}</div>
              <div class="user-cell-handle">@${escapeHtml(row.username)}</div>
            </div>
          </div>
        </td>
        ${cells}
      </tr>
    `;
  }).join('');
}

async function loadPerms() {
  renderPermsHead();
  permsTbody.innerHTML = `<tr class="users-empty-row"><td colspan="${PERMS.MODULES.length + 1}">Cargando…</td></tr>`;
  const res = await window.api.permissionsListUsers();
  if (!res?.ok) {
    permsTbody.innerHTML = `<tr class="users-empty-row"><td colspan="${PERMS.MODULES.length + 1}">${escapeHtml(res?.error || 'No se pudieron cargar los permisos.')}</td></tr>`;
    return;
  }
  permsState = res.users.map((u) => ({
    id: u.id,
    username: u.username,
    nombre: u.nombre,
    apellidos: u.apellidos,
    original: new Set(u.permissions || []),
    current: new Set(u.permissions || []),
  }));
  permsLoaded = true;
  renderPermsRows();
  renderPermsDirty();
}

permsTbody.addEventListener('change', (e) => {
  const cb = e.target.closest('input.perms-checkbox');
  if (!cb) return;
  const id = Number(cb.dataset.userId);
  const perm = cb.dataset.perm;
  const row = permsState.find((r) => r.id === id);
  if (!row) return;
  if (cb.checked) row.current.add(perm);
  else row.current.delete(perm);
  renderPermsDirty();
});

permsSaveBtn.addEventListener('click', async () => {
  const changed = permsState.filter((row) => {
    if (row.original.size !== row.current.size) return true;
    for (const p of row.current) if (!row.original.has(p)) return true;
    return false;
  });
  if (!changed.length) return;

  permsSaveBtn.disabled = true;
  const prevLabel = permsSaveBtn.innerHTML;
  permsSaveBtn.innerHTML = '<span>Guardando…</span>';

  const errors = [];
  for (const row of changed) {
    const res = await window.api.setUserPermissions(row.id, [...row.current]);
    if (!res?.ok) {
      errors.push(`@${row.username}: ${res?.error || 'error'}`);
      // Revert in-memory so user sees the actual server state
      row.current = new Set(row.original);
    } else {
      row.original = new Set(row.current);
    }
  }

  permsSaveBtn.innerHTML = prevLabel;

  if (errors.length) {
    alert(`Algunos cambios no se guardaron:\n\n${errors.join('\n')}`);
  }

  // If we edited ourselves, refresh currentUser so sidebar reflects new perms
  const self = permsState.find((r) => currentUser && r.id === currentUser.id);
  if (self) {
    const fresh = await window.api.getCurrentUser();
    if (fresh) {
      currentUser = fresh;
      applyPermissionGating();
    }
  }

  renderPermsRows();
  renderPermsDirty();
});

// ── Reportes ──────────────────────────────────────────────────
[
  'rep-ad-xlsx-icon', 'rep-hi-xlsx-icon', 'rep-sm-xlsx-icon',
].forEach((id) => { document.getElementById(id).innerHTML = I.fileSpreadsheet(14); });
[
  'rep-ad-pdf-icon', 'rep-hi-pdf-icon', 'rep-sm-pdf-icon',
].forEach((id) => { document.getElementById(id).innerHTML = I.filePdf(14); });

function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// PDF cell helpers — produce { html } objects to bypass escaping for badges/bars.
function pdfTipoBadge(tipo) {
  const cls = tipo === 'entrada' ? 'pdf-badge--in' : 'pdf-badge--out';
  const label = tipo === 'entrada' ? 'Entrada' : 'Salida';
  return { html: `<span class="pdf-badge ${cls}">${label}</span>` };
}
function pdfMono(s) {
  return { html: `<span class="pdf-num">${escapeHtml(s ?? '')}</span>` };
}
function fmtDateLong(iso) {
  if (!iso) return '';
  // iso is YYYY-MM-DD; treat as local
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

async function handleExport(action, payload) {
  const fn = action === 'xlsx' ? window.api.exportReporteExcel : window.api.exportReportePdf;
  const res = await fn(payload);
  if (!res?.ok) {
    if (!res?.canceled) alert(res?.error || 'No se pudo exportar');
  }
}

// ── Reporte 1: Asistencia del día ─────────────────────────────
const repAdFecha = document.getElementById('rep-ad-fecha');
const repAdTbody = document.getElementById('rep-ad-tbody');
const repAdBuscar = document.getElementById('rep-ad-buscar');
const repAdXlsx = document.getElementById('rep-ad-xlsx');
const repAdPdf = document.getElementById('rep-ad-pdf');
let repAdRows = [];

repAdFecha.value = todayLocalISO();

async function repAdGenerar() {
  repAdTbody.innerHTML = '<tr class="users-empty-row"><td colspan="5">Cargando…</td></tr>';
  const res = await window.api.reporteAsistenciaDia(repAdFecha.value);
  if (!res?.ok) {
    repAdTbody.innerHTML = `<tr class="users-empty-row"><td colspan="5">${escapeHtml(res?.error || 'Error')}</td></tr>`;
    repAdXlsx.disabled = true; repAdPdf.disabled = true;
    return;
  }
  repAdRows = res.eventos;
  if (!repAdRows.length) {
    repAdTbody.innerHTML = '<tr class="users-empty-row"><td colspan="5">Sin eventos en esa fecha.</td></tr>';
    repAdXlsx.disabled = true; repAdPdf.disabled = true;
    return;
  }
  repAdTbody.innerHTML = repAdRows.map((ev) => `
    <tr>
      <td><span class="user-cell-handle">${fmtDateTime(ev.timestamp)}</span></td>
      <td>
        <div class="user-cell">
          <div class="user-cell-text">
            <div class="user-cell-name">${escapeHtml(ev.emp_nombre)} ${escapeHtml(ev.emp_apellidos)}</div>
            <div class="user-cell-handle">#${escapeHtml(ev.numero_empleado)}</div>
          </div>
        </div>
      </td>
      <td>${tipoBadge(ev.tipo)}</td>
      <td>${renderMotivo(ev)}</td>
      <td><span class="users-muted">@${escapeHtml(ev.registrado_por_username)}</span></td>
    </tr>
  `).join('');
  repAdXlsx.disabled = false; repAdPdf.disabled = false;
}

repAdBuscar.addEventListener('click', repAdGenerar);

function repAdExportPayload(format) {
  const fecha = repAdFecha.value || todayLocalISO();
  const columns = [
    { key: 'fechaHora', header: 'Fecha y hora', width: 22 },
    { key: 'numero',    header: 'Número',       width: 12 },
    { key: 'nombre',    header: 'Empleado',     width: 30 },
    { key: 'tipo',      header: 'Tipo',         width: 10 },
    { key: 'motivo',    header: 'Motivo',       width: 18 },
    { key: 'detalle',   header: 'Detalle',      width: 28 },
    { key: 'usuario',   header: 'Registró',     width: 16 },
  ];
  const data = repAdRows.map((ev) => ({
    fechaHora: fmtDateTime(ev.timestamp),
    numero: ev.numero_empleado,
    nombre: `${ev.emp_nombre} ${ev.emp_apellidos}`,
    tipo: ev.tipo,
    motivo: ev.motivo_tipo || '',
    detalle: ev.motivo_detalle || '',
    usuario: `@${ev.registrado_por_username}`,
  }));
  if (format === 'xlsx') {
    return {
      title: `Asistencia del día · ${fecha}`,
      columns, rows: data, defaultBase: `asistencia-${fecha}`,
    };
  }
  const entradas = repAdRows.filter((e) => e.tipo === 'entrada').length;
  const salidas = repAdRows.filter((e) => e.tipo === 'salida').length;
  const rowsHtml = data.map((r) => [
    pdfMono(r.fechaHora),
    pdfMono('#' + r.numero),
    r.nombre,
    pdfTipoBadge(r.tipo),
    r.motivo,
    r.detalle,
    { html: `<span class="pdf-num">@${escapeHtml(r.usuario.slice(1))}</span>` },
  ]);
  return {
    title: 'Asistencia del día',
    subtitle: fmtDateLong(fecha),
    summary: [
      { label: 'Total eventos', value: repAdRows.length },
      { label: 'Entradas',      value: entradas },
      { label: 'Salidas',       value: salidas },
    ],
    headers: ['Fecha y hora', 'Número', 'Empleado', 'Tipo', 'Motivo', 'Detalle', 'Registró'],
    rows: rowsHtml,
    defaultBase: `asistencia-${fecha}`,
  };
}

repAdXlsx.addEventListener('click', () => handleExport('xlsx', repAdExportPayload('xlsx')));
repAdPdf .addEventListener('click', () => handleExport('pdf',  repAdExportPayload('pdf')));

// ── Reporte 2: Historial por empleado ─────────────────────────
const repHiEmpleado = document.getElementById('rep-hi-empleado');
const repHiIni = document.getElementById('rep-hi-ini');
const repHiFin = document.getElementById('rep-hi-fin');
const repHiTbody = document.getElementById('rep-hi-tbody');
const repHiSummary = document.getElementById('rep-hi-summary');
const repHiBuscar = document.getElementById('rep-hi-buscar');
const repHiXlsx = document.getElementById('rep-hi-xlsx');
const repHiPdf = document.getElementById('rep-hi-pdf');
let repHiData = null;
let repHiEmpleadosLoaded = false;

// Default range: last 30 days
(function initRepHiDates() {
  const today = new Date();
  const past = new Date(today); past.setDate(past.getDate() - 30);
  repHiIni.value = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`;
  repHiFin.value = todayLocalISO();
})();

async function loadRepHiEmpleados() {
  if (repHiEmpleadosLoaded) return;
  const res = await window.api.reporteListEmpleados();
  if (!res?.ok) return;
  const opts = ['<option value="">Selecciona…</option>'].concat(
    res.empleados.map((e) =>
      `<option value="${e.id}">#${escapeHtml(e.numero_empleado)} · ${escapeHtml(e.nombre)} ${escapeHtml(e.apellidos)}</option>`
    )
  ).join('');
  repHiEmpleado.innerHTML = opts;
  repHiEmpleadosLoaded = true;
}

async function repHiGenerar() {
  const id = Number(repHiEmpleado.value);
  if (!id) { alert('Selecciona un empleado.'); return; }
  repHiTbody.innerHTML = '<tr class="users-empty-row"><td colspan="4">Cargando…</td></tr>';
  repHiSummary.classList.add('hidden');
  const res = await window.api.reporteHistorial(id, repHiIni.value, repHiFin.value);
  if (!res?.ok) {
    repHiTbody.innerHTML = `<tr class="users-empty-row"><td colspan="4">${escapeHtml(res?.error || 'Error')}</td></tr>`;
    repHiXlsx.disabled = true; repHiPdf.disabled = true;
    return;
  }
  repHiData = res;
  const emp = res.empleado;
  const meta = [emp.puesto, emp.departamento].filter(Boolean).join(' · ');
  repHiSummary.innerHTML = `
    <div class="rep-summary-item">
      <span class="rep-summary-label">Empleado</span>
      <span class="rep-summary-value">${escapeHtml(emp.nombre)} ${escapeHtml(emp.apellidos)}</span>
      <span class="users-muted" style="font-size: 12px;">#${escapeHtml(emp.numero_empleado)}${meta ? ' · ' + escapeHtml(meta) : ''}</span>
    </div>
    <div class="rep-summary-item">
      <span class="rep-summary-label">Rango</span>
      <span class="rep-summary-value">${escapeHtml(res.rango.ini)} → ${escapeHtml(res.rango.fin)}</span>
    </div>
    <div class="rep-summary-item">
      <span class="rep-summary-label">Días asistidos</span>
      <span class="rep-summary-value">${res.diasAsistidos}</span>
    </div>
    <div class="rep-summary-item">
      <span class="rep-summary-label">Eventos</span>
      <span class="rep-summary-value">${res.eventos.length}</span>
    </div>
  `;
  repHiSummary.classList.remove('hidden');

  if (!res.eventos.length) {
    repHiTbody.innerHTML = '<tr class="users-empty-row"><td colspan="4">Sin eventos en el rango.</td></tr>';
    repHiXlsx.disabled = true; repHiPdf.disabled = true;
    return;
  }

  repHiTbody.innerHTML = res.eventos.map((ev) => `
    <tr>
      <td><span class="user-cell-handle">${escapeHtml(fmtDateTime(ev.timestamp))}</span></td>
      <td>${tipoBadge(ev.tipo)}</td>
      <td>${renderMotivo(ev)}</td>
      <td><span class="users-muted">@${escapeHtml(ev.registrado_por_username)}</span></td>
    </tr>
  `).join('');
  repHiXlsx.disabled = false; repHiPdf.disabled = false;
}

repHiBuscar.addEventListener('click', repHiGenerar);

function repHiExportPayload(format) {
  if (!repHiData) return null;
  const emp = repHiData.empleado;
  const r = repHiData.rango;
  const columns = [
    { key: 'fecha',   header: 'Fecha y hora', width: 22 },
    { key: 'tipo',    header: 'Tipo',         width: 10 },
    { key: 'motivo',  header: 'Motivo',       width: 18 },
    { key: 'detalle', header: 'Detalle',      width: 28 },
    { key: 'usuario', header: 'Registró',     width: 16 },
  ];
  const data = repHiData.eventos.map((ev) => ({
    fecha: fmtDateTime(ev.timestamp),
    tipo: ev.tipo,
    motivo: ev.motivo_tipo || '',
    detalle: ev.motivo_detalle || '',
    usuario: `@${ev.registrado_por_username}`,
  }));
  if (format === 'xlsx') {
    return {
      title: `Historial · ${emp.nombre} ${emp.apellidos} (#${emp.numero_empleado})`,
      columns, rows: data,
      defaultBase: `historial-${emp.numero_empleado}-${r.ini}_${r.fin}`,
    };
  }
  const metaParts = [];
  if (emp.puesto) metaParts.push(emp.puesto);
  if (emp.departamento) metaParts.push(emp.departamento);
  const subtitle = `#${emp.numero_empleado} · ${emp.nombre} ${emp.apellidos}` +
    (metaParts.length ? ` — ${metaParts.join(' · ')}` : '');
  const rowsHtml = data.map((row) => [
    pdfMono(row.fecha),
    pdfTipoBadge(row.tipo),
    row.motivo,
    row.detalle,
    { html: `<span class="pdf-num">${escapeHtml(row.usuario)}</span>` },
  ]);
  return {
    title: 'Historial por empleado',
    subtitle,
    summary: [
      { label: 'Desde',          value: fmtDateLong(r.ini) },
      { label: 'Hasta',          value: fmtDateLong(r.fin) },
      { label: 'Días asistidos', value: repHiData.diasAsistidos },
      { label: 'Eventos',        value: repHiData.eventos.length },
    ],
    headers: ['Fecha y hora', 'Tipo', 'Motivo', 'Detalle', 'Registró'],
    rows: rowsHtml,
    defaultBase: `historial-${emp.numero_empleado}-${r.ini}_${r.fin}`,
  };
}

repHiXlsx.addEventListener('click', () => { const p = repHiExportPayload('xlsx'); if (p) handleExport('xlsx', p); });
repHiPdf .addEventListener('click', () => { const p = repHiExportPayload('pdf');  if (p) handleExport('pdf',  p); });

// ── Reporte 3: Salidas por motivo ─────────────────────────────
const repSmIni = document.getElementById('rep-sm-ini');
const repSmFin = document.getElementById('rep-sm-fin');
const repSmTbody = document.getElementById('rep-sm-tbody');
const repSmSummary = document.getElementById('rep-sm-summary');
const repSmBuscar = document.getElementById('rep-sm-buscar');
const repSmXlsx = document.getElementById('rep-sm-xlsx');
const repSmPdf = document.getElementById('rep-sm-pdf');
const repSmChart = document.getElementById('rep-sm-chart');
const repSmChartBody = document.getElementById('rep-sm-chart-body');
const repSmChartSub = document.getElementById('rep-sm-chart-sub');
let repSmData = null;

function repSmDaysBetween(iniIso, finIso) {
  const a = new Date(iniIso + 'T00:00:00');
  const b = new Date(finIso + 'T00:00:00');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1;
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

(function initRepSmDates() {
  const today = new Date();
  const past = new Date(today); past.setDate(past.getDate() - 30);
  repSmIni.value = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-${String(past.getDate()).padStart(2, '0')}`;
  repSmFin.value = todayLocalISO();
})();

async function repSmGenerar() {
  repSmTbody.innerHTML = '<tr class="users-empty-row"><td colspan="4">Cargando…</td></tr>';
  repSmSummary.classList.add('hidden');
  repSmChart.classList.add('hidden');
  const res = await window.api.reporteSalidasMotivo(repSmIni.value, repSmFin.value);
  if (!res?.ok) {
    repSmTbody.innerHTML = `<tr class="users-empty-row"><td colspan="4">${escapeHtml(res?.error || 'Error')}</td></tr>`;
    repSmXlsx.disabled = true; repSmPdf.disabled = true;
    return;
  }
  repSmData = res;

  const days = repSmDaysBetween(res.rango.ini, res.rango.fin);
  const promedio = (res.total / days).toFixed(1);
  const topMotivo = res.rows[0]?.motivo || '—';
  const topTotal = res.rows[0]?.total || 0;
  const topPct = res.total > 0 ? Math.round((topTotal / res.total) * 100) : 0;

  repSmSummary.innerHTML = `
    <div class="rep-summary-card">
      <span class="rep-summary-label">Total salidas</span>
      <span class="rep-summary-value rep-summary-value--xl">${res.total}</span>
      <span class="rep-summary-sub">${days} ${days === 1 ? 'día' : 'días'}</span>
    </div>
    <div class="rep-summary-card">
      <span class="rep-summary-label">Promedio diario</span>
      <span class="rep-summary-value rep-summary-value--xl">${promedio}</span>
      <span class="rep-summary-sub">salidas/día</span>
    </div>
    <div class="rep-summary-card">
      <span class="rep-summary-label">Motivo principal</span>
      <span class="rep-summary-value rep-summary-value--md">${escapeHtml(topMotivo)}</span>
      <span class="rep-summary-sub">${topTotal} · ${topPct}%</span>
    </div>
    <div class="rep-summary-card">
      <span class="rep-summary-label">Tipos de motivo</span>
      <span class="rep-summary-value rep-summary-value--xl">${res.rows.length}</span>
      <span class="rep-summary-sub">${escapeHtml(res.rango.ini)} → ${escapeHtml(res.rango.fin)}</span>
    </div>
  `;
  repSmSummary.classList.remove('hidden');

  if (!res.rows.length) {
    repSmTbody.innerHTML = '<tr class="users-empty-row"><td colspan="4">Sin salidas en el rango.</td></tr>';
    repSmXlsx.disabled = true; repSmPdf.disabled = true;
    return;
  }

  const items = res.rows.map((r, i) => ({
    label: r.motivo,
    value: r.total,
    color: chartColor(i),
  }));

  repSmChartSub.textContent = `${res.rows.length} ${res.rows.length === 1 ? 'motivo' : 'motivos'} · ${res.total} salidas`;
  repSmChartBody.innerHTML = `
    <div class="donut-wrap donut-wrap--large">
      ${donutSVG(items, { size: 220, thickness: 26, centerTop: String(res.total), centerBottom: 'salidas' })}
      ${donutLegend(items, res.total)}
    </div>
  `;
  repSmChart.classList.remove('hidden');

  repSmTbody.innerHTML = res.rows.map((r, i) => {
    const pct = res.total > 0 ? (r.total / res.total) * 100 : 0;
    const widthPct = Math.max(4, pct);
    const color = chartColor(i);
    return `
      <tr>
        <td>
          <div class="rep-sm-motivo-cell">
            <span class="rep-sm-motivo-dot" style="background:${color}"></span>
            <span>${escapeHtml(r.motivo)}</span>
          </div>
        </td>
        <td>
          <div class="rep-bar-cell">
            <span class="rep-bar" style="width: ${widthPct}%; background: ${color};"></span>
          </div>
        </td>
        <td style="text-align: right;"><span class="rep-bar-num">${r.total}</span></td>
        <td style="text-align: right;"><span class="rep-bar-num">${pct.toFixed(1)}%</span></td>
      </tr>
    `;
  }).join('');
  repSmXlsx.disabled = false; repSmPdf.disabled = false;
}

repSmBuscar.addEventListener('click', repSmGenerar);

function repSmExportPayload(format) {
  if (!repSmData) return null;
  const r = repSmData.rango;
  const columns = [
    { key: 'motivo', header: 'Motivo', width: 30 },
    { key: 'total',  header: 'Total',  width: 12 },
  ];
  const data = repSmData.rows.map((row) => ({ motivo: row.motivo, total: row.total }));
  if (format === 'xlsx') {
    return {
      title: `Salidas por motivo · ${r.ini} al ${r.fin}`,
      columns, rows: data,
      defaultBase: `salidas-motivo-${r.ini}_${r.fin}`,
    };
  }
  const max = repSmData.rows[0]?.total || 1;
  const rowsHtml = repSmData.rows.map((row) => {
    const pct = Math.max(4, Math.round((row.total / max) * 100));
    return [
      row.motivo,
      {
        html: `<div class="pdf-bar-cell">
          <div class="pdf-bar"><span class="pdf-bar-fill" style="width:${pct}%"></span></div>
          <span class="pdf-bar-num">${row.total}</span>
        </div>`,
      },
    ];
  });
  return {
    title: 'Salidas por motivo',
    subtitle: `Del ${fmtDateLong(r.ini)} al ${fmtDateLong(r.fin)}`,
    summary: [
      { label: 'Desde',         value: fmtDateLong(r.ini) },
      { label: 'Hasta',         value: fmtDateLong(r.fin) },
      { label: 'Total salidas', value: repSmData.total },
      { label: 'Tipos',         value: repSmData.rows.length },
    ],
    headers: ['Motivo', 'Total'],
    rows: rowsHtml,
    defaultBase: `salidas-motivo-${r.ini}_${r.fin}`,
  };
}

repSmXlsx.addEventListener('click', () => { const p = repSmExportPayload('xlsx'); if (p) handleExport('xlsx', p); });
repSmPdf .addEventListener('click', () => { const p = repSmExportPayload('pdf');  if (p) handleExport('pdf',  p); });

// ── Configuración general (logo + empresa + horario laboral) ─
const cfgLogoPreview    = document.getElementById('cfg-logo-preview');
const cfgLogoFileInput  = document.getElementById('cfg-logo-file');
const cfgLogoRemoveBtn  = document.getElementById('cfg-logo-remove-btn');
const cfgLogoError      = document.getElementById('cfg-logo-error');
const cfgLogoSuccess    = document.getElementById('cfg-logo-success');
const cfgCompanyName     = document.getElementById('cfg-company-name');
const cfgCompanySaveBtn  = document.getElementById('cfg-company-save-btn');
const cfgCompanyError    = document.getElementById('cfg-company-error');
const cfgCompanySuccess  = document.getElementById('cfg-company-success');
const cfgWorkStart = document.getElementById('cfg-work-start');
const cfgWorkEnd   = document.getElementById('cfg-work-end');
const cfgWeekdays  = document.getElementById('cfg-weekdays');
const cfgSaveBtn   = document.getElementById('cfg-save-btn');
const cfgError     = document.getElementById('cfg-error');
const cfgSuccess   = document.getElementById('cfg-success');

const WEEKDAY_LABELS = [
  { iso: 1, short: 'L', long: 'Lunes' },
  { iso: 2, short: 'M', long: 'Martes' },
  { iso: 3, short: 'X', long: 'Miércoles' },
  { iso: 4, short: 'J', long: 'Jueves' },
  { iso: 5, short: 'V', long: 'Viernes' },
  { iso: 6, short: 'S', long: 'Sábado' },
  { iso: 7, short: 'D', long: 'Domingo' },
];

let cfgScheduleCache = null;
let cfgLoaded = false;

function renderWeekdayPills(selectedSet) {
  cfgWeekdays.innerHTML = WEEKDAY_LABELS.map((w) => `
    <button type="button" class="cfg-weekday ${selectedSet.has(w.iso) ? 'is-active' : ''}" data-iso="${w.iso}" title="${w.long}" aria-pressed="${selectedSet.has(w.iso) ? 'true' : 'false'}">
      ${w.short}
    </button>
  `).join('');
  cfgWeekdays.querySelectorAll('.cfg-weekday').forEach((btn) => {
    btn.addEventListener('click', () => {
      const iso = +btn.dataset.iso;
      if (selectedSet.has(iso)) selectedSet.delete(iso); else selectedSet.add(iso);
      btn.classList.toggle('is-active');
      btn.setAttribute('aria-pressed', btn.classList.contains('is-active') ? 'true' : 'false');
    });
  });
}

let cfgSelectedDays = new Set();

async function loadCfgSchedule() {
  cfgError.classList.add('hidden');
  cfgSuccess.classList.add('hidden');
  cfgCompanyError.classList.add('hidden');
  cfgCompanySuccess.classList.add('hidden');
  cfgLogoError.classList.add('hidden');
  cfgLogoSuccess.classList.add('hidden');

  const [schedRes, nameRes, logoRes] = await Promise.all([
    window.api.getWorkSchedule(),
    window.api.getCompanyName(),
    window.api.getCompanyLogo(),
  ]);

  refreshCfgLogoPreview(logoRes);

  if (!schedRes?.ok) {
    cfgError.textContent = schedRes?.error || 'No se pudo cargar el horario';
    cfgError.classList.remove('hidden');
    return;
  }
  cfgScheduleCache = schedRes.schedule;
  cfgWorkStart.value = schedRes.schedule.work_start;
  cfgWorkEnd.value   = schedRes.schedule.work_end;
  cfgSelectedDays = new Set(schedRes.schedule.work_days);
  renderWeekdayPills(cfgSelectedDays);

  // Show the stored value (input stays empty when default is being used,
  // so the placeholder hints the fallback).
  if (nameRes?.ok) {
    cfgCompanyName.value = nameRes.customized ? (nameRes.stored || '') : '';
  }

  cfgLoaded = true;
}

function refreshCfgLogoPreview(res) {
  // Reset the preview to placeholder letter or show the image.
  const hasLogo = !!(res?.ok && res.dataUrl);
  cfgLogoPreview.querySelectorAll(':scope > img').forEach((n) => n.remove());
  if (hasLogo) {
    const ph = document.getElementById('cfg-logo-placeholder');
    if (ph) ph.style.display = 'none';
    const img = document.createElement('img');
    img.src = res.dataUrl;
    img.alt = 'Logo de la empresa';
    img.draggable = false;
    cfgLogoPreview.appendChild(img);
    cfgLogoRemoveBtn.classList.remove('hidden');
  } else {
    const ph = document.getElementById('cfg-logo-placeholder');
    if (ph) ph.style.display = '';
    cfgLogoRemoveBtn.classList.add('hidden');
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.onload = () => {
      const result = String(reader.result || '');
      // result is "data:<mime>;base64,<b64>". Strip the prefix.
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

cfgLogoFileInput.addEventListener('change', async (e) => {
  cfgLogoError.classList.add('hidden');
  cfgLogoSuccess.classList.add('hidden');
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  // Client-side guard (backend also validates)
  const MAX = 2 * 1024 * 1024;
  if (file.size > MAX) {
    cfgLogoError.textContent = 'La imagen supera el máximo de 2 MB';
    cfgLogoError.classList.remove('hidden');
    cfgLogoFileInput.value = '';
    return;
  }
  const mime = (file.type || '').toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'].includes(mime)) {
    cfgLogoError.textContent = 'Formato no soportado. Usa PNG, JPG, SVG o WebP.';
    cfgLogoError.classList.remove('hidden');
    cfgLogoFileInput.value = '';
    return;
  }

  try {
    const base64 = await readFileAsBase64(file);
    const res = await window.api.setCompanyLogo({ data: base64, mime });
    if (!res?.ok) {
      cfgLogoError.textContent = res?.error || 'No se pudo guardar el logo';
      cfgLogoError.classList.remove('hidden');
      return;
    }
    cfgLogoSuccess.classList.remove('hidden');
    setTimeout(() => cfgLogoSuccess.classList.add('hidden'), 2500);
    const logoRes = await window.api.getCompanyLogo();
    refreshCfgLogoPreview(logoRes);
    if (window.EES_BRAND?.applyAll) await window.EES_BRAND.applyAll({ force: true });
  } catch (err) {
    cfgLogoError.textContent = err?.message || 'Error al leer el archivo';
    cfgLogoError.classList.remove('hidden');
  } finally {
    cfgLogoFileInput.value = '';
  }
});

cfgLogoRemoveBtn.addEventListener('click', async () => {
  cfgLogoError.classList.add('hidden');
  cfgLogoSuccess.classList.add('hidden');
  const ok = confirm('¿Quitar el logo actual? Se volverá a mostrar la inicial.');
  if (!ok) return;
  cfgLogoRemoveBtn.disabled = true;
  const res = await window.api.removeCompanyLogo();
  cfgLogoRemoveBtn.disabled = false;
  if (!res?.ok) {
    cfgLogoError.textContent = res?.error || 'No se pudo quitar';
    cfgLogoError.classList.remove('hidden');
    return;
  }
  refreshCfgLogoPreview({ ok: true, dataUrl: null });
  if (window.EES_BRAND?.applyAll) await window.EES_BRAND.applyAll({ force: true });
});

cfgCompanySaveBtn.addEventListener('click', async () => {
  cfgCompanyError.classList.add('hidden');
  cfgCompanySuccess.classList.add('hidden');
  cfgCompanySaveBtn.disabled = true;
  const res = await window.api.setCompanyName(cfgCompanyName.value);
  cfgCompanySaveBtn.disabled = false;
  if (!res?.ok) {
    cfgCompanyError.textContent = res?.error || 'No se pudo guardar';
    cfgCompanyError.classList.remove('hidden');
    return;
  }
  cfgCompanySuccess.classList.remove('hidden');
  setTimeout(() => cfgCompanySuccess.classList.add('hidden'), 2500);
  // Refresh brand display across the open window immediately.
  if (window.EES_BRAND?.applyAll) {
    await window.EES_BRAND.applyAll({ force: true });
  }
});

cfgSaveBtn.addEventListener('click', async () => {
  cfgError.classList.add('hidden');
  cfgSuccess.classList.add('hidden');
  cfgSaveBtn.disabled = true;
  const payload = {
    work_start: cfgWorkStart.value,
    work_end:   cfgWorkEnd.value,
    work_days:  Array.from(cfgSelectedDays),
  };
  const res = await window.api.setWorkSchedule(payload);
  cfgSaveBtn.disabled = false;
  if (!res?.ok) {
    cfgError.textContent = res?.error || 'No se pudo guardar';
    cfgError.classList.remove('hidden');
    return;
  }
  cfgScheduleCache = res.schedule;
  cfgSuccess.classList.remove('hidden');
  setTimeout(() => cfgSuccess.classList.add('hidden'), 2500);
});

// ── Reporte 4: Horas dentro/fuera ─────────────────────────────
const repHdIni     = document.getElementById('rep-hd-ini');
const repHdFin     = document.getElementById('rep-hd-fin');
const repHdTbody   = document.getElementById('rep-hd-tbody');
const repHdSummary = document.getElementById('rep-hd-summary');
const repHdBuscar  = document.getElementById('rep-hd-buscar');
const repHdXlsx    = document.getElementById('rep-hd-xlsx');
const repHdPdf     = document.getElementById('rep-hd-pdf');
const repHdScheduleNote = document.getElementById('rep-hd-schedule');
document.getElementById('rep-hd-xlsx-icon').innerHTML = I.fileSpreadsheet(14);
document.getElementById('rep-hd-pdf-icon').innerHTML = I.filePdf(14);
let repHdData = null;

(function initRepHdDates() {
  const today = new Date();
  const past = new Date(today); past.setDate(past.getDate() - 29);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  repHdIni.value = fmt(past);
  repHdFin.value = fmt(today);
})();

function fmtSecondsHM(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
function fmtPct(pct) {
  if (!Number.isFinite(pct)) return '0%';
  return `${pct.toFixed(1)}%`;
}
function weekdayShortFromIso(iso) {
  const w = WEEKDAY_LABELS.find((x) => x.iso === iso);
  return w ? w.short : '?';
}

async function refreshHdScheduleNote() {
  const res = await window.api.getWorkSchedule();
  if (!res?.ok) { repHdScheduleNote.textContent = ''; return; }
  const days = res.schedule.work_days.map(weekdayShortFromIso).join(' ');
  repHdScheduleNote.textContent = ` · Horario: ${res.schedule.work_start}–${res.schedule.work_end} (${days})`;
}

async function repHdGenerar() {
  repHdTbody.innerHTML = '<tr class="users-empty-row"><td colspan="6">Cargando…</td></tr>';
  repHdSummary.classList.add('hidden');
  repHdXlsx.disabled = true; repHdPdf.disabled = true;

  const res = await window.api.reporteHorasDentroFuera(repHdIni.value, repHdFin.value);
  if (!res?.ok) {
    repHdTbody.innerHTML = `<tr class="users-empty-row"><td colspan="6">${escapeHtml(res?.error || 'Error')}</td></tr>`;
    return;
  }
  repHdData = res;

  const totalInside  = res.rows.reduce((s, r) => s + r.inside_sec, 0);
  const totalOutside = res.rows.reduce((s, r) => s + r.outside_sec, 0);
  const totalDenom   = totalInside + totalOutside;
  const promCumpl    = totalDenom > 0 ? (totalInside / totalDenom) * 100 : 0;
  const activosTotal = res.rows.length;
  const activosConActividad = res.rows.filter((r) => r.dias_con_actividad > 0).length;

  repHdSummary.innerHTML = `
    <div class="rep-summary-card">
      <span class="rep-summary-label">Días laborables</span>
      <span class="rep-summary-value rep-summary-value--xl">${res.dias_laborables}</span>
      <span class="rep-summary-sub">${escapeHtml(res.rango.ini)} → ${escapeHtml(res.rango.fin)}</span>
    </div>
    <div class="rep-summary-card">
      <span class="rep-summary-label">Total dentro</span>
      <span class="rep-summary-value rep-summary-value--xl">${fmtSecondsHM(totalInside)}</span>
      <span class="rep-summary-sub">acumulado de empleados</span>
    </div>
    <div class="rep-summary-card">
      <span class="rep-summary-label">Total fuera en horario</span>
      <span class="rep-summary-value rep-summary-value--xl">${fmtSecondsHM(totalOutside)}</span>
      <span class="rep-summary-sub">incluye llegadas tarde y salidas tempranas</span>
    </div>
    <div class="rep-summary-card">
      <span class="rep-summary-label">Cumplimiento promedio</span>
      <span class="rep-summary-value rep-summary-value--xl">${fmtPct(promCumpl)}</span>
      <span class="rep-summary-sub">${activosConActividad}/${activosTotal} empleados con actividad</span>
    </div>
  `;
  repHdSummary.classList.remove('hidden');

  if (!res.rows.length) {
    repHdTbody.innerHTML = '<tr class="users-empty-row"><td colspan="6">No hay empleados activos.</td></tr>';
    return;
  }

  repHdTbody.innerHTML = res.rows.map((r) => {
    const pct = Math.max(0, Math.min(100, r.pct_cumplimiento));
    const barColor = pct >= 85 ? 'var(--success)' : pct >= 60 ? '#f3bc4b' : 'var(--error)';
    const sinAct = r.dias_con_actividad === 0;
    return `
      <tr class="rep-hd-row ${sinAct ? 'is-muted' : ''}" data-empleado-id="${r.empleado_id}">
        <td>
          <div class="user-cell">
            <div class="user-cell-avatar">${escapeHtml(initials(r.nombre, r.apellidos))}</div>
            <div class="user-cell-text">
              <div class="user-cell-name">${escapeHtml(r.nombre)} ${escapeHtml(r.apellidos)}</div>
              <div class="user-cell-handle">#${escapeHtml(r.numero_empleado)}</div>
            </div>
          </div>
        </td>
        <td style="text-align: right;">
          <span class="rep-bar-num">${r.dias_con_actividad}<span class="users-muted">/${r.dias_laborables}</span></span>
        </td>
        <td style="text-align: right;"><span class="rep-bar-num">${fmtSecondsHM(r.inside_sec)}</span></td>
        <td style="text-align: right;"><span class="rep-bar-num">${fmtSecondsHM(r.outside_sec)}</span></td>
        <td>
          <div class="rep-hd-pct-cell">
            <div class="rep-hd-pct-bar">
              <span class="rep-hd-pct-fill" style="width:${pct}%; background:${barColor};"></span>
            </div>
            <span class="rep-hd-pct-num">${fmtPct(r.pct_cumplimiento)}</span>
          </div>
        </td>
        <td>
          <div class="users-row-actions">
            <button type="button" class="row-icon-btn" data-action="hd-detail" data-id="${r.empleado_id}" title="Ver detalle" aria-label="Ver detalle">${I.eye(15)}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  repHdXlsx.disabled = false; repHdPdf.disabled = false;
}

repHdBuscar.addEventListener('click', repHdGenerar);

// Row click + detail action → open drill-down
repHdTbody.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action="hd-detail"]');
  if (btn) {
    e.stopPropagation();
    openHdDetail(+btn.dataset.id);
    return;
  }
  const row = e.target.closest('tr[data-empleado-id]');
  if (row && !row.classList.contains('users-empty-row')) {
    openHdDetail(+row.dataset.empleadoId);
  }
});

// Export payloads
function repHdExportPayload(format) {
  if (!repHdData) return null;
  const r = repHdData.rango;
  const sched = repHdData.schedule;
  const columns = [
    { key: 'numero',    header: 'Número',         width: 12 },
    { key: 'empleado',  header: 'Empleado',       width: 28 },
    { key: 'dias',      header: 'Días con act.',  width: 14 },
    { key: 'dentro',    header: 'Dentro',         width: 14 },
    { key: 'fuera',     header: 'Fuera (horar.)', width: 14 },
    { key: 'pct',       header: 'Cumplimiento',   width: 14 },
  ];
  const data = repHdData.rows.map((row) => ({
    numero:   row.numero_empleado,
    empleado: `${row.nombre} ${row.apellidos}`,
    dias:     `${row.dias_con_actividad}/${row.dias_laborables}`,
    dentro:   fmtSecondsHM(row.inside_sec),
    fuera:    fmtSecondsHM(row.outside_sec),
    pct:      fmtPct(row.pct_cumplimiento),
  }));
  if (format === 'xlsx') {
    return {
      title: `Horas dentro-fuera · ${r.ini} al ${r.fin}`,
      columns, rows: data,
      defaultBase: `horas-dentro-fuera-${r.ini}_${r.fin}`,
    };
  }
  return {
    title: 'Horas dentro/fuera',
    subtitle: `Del ${fmtDateLong(r.ini)} al ${fmtDateLong(r.fin)} · Horario ${sched.work_start}–${sched.work_end}`,
    summary: [
      { label: 'Desde',           value: fmtDateLong(r.ini) },
      { label: 'Hasta',           value: fmtDateLong(r.fin) },
      { label: 'Días laborables', value: repHdData.dias_laborables },
      { label: 'Empleados',       value: repHdData.rows.length },
    ],
    headers: ['#', 'Empleado', 'Días', 'Dentro', 'Fuera', 'Cumpl.'],
    rows: repHdData.rows.map((row) => [
      row.numero_empleado,
      `${row.nombre} ${row.apellidos}`,
      `${row.dias_con_actividad}/${row.dias_laborables}`,
      fmtSecondsHM(row.inside_sec),
      fmtSecondsHM(row.outside_sec),
      fmtPct(row.pct_cumplimiento),
    ]),
    defaultBase: `horas-dentro-fuera-${r.ini}_${r.fin}`,
  };
}
repHdXlsx.addEventListener('click', () => { const p = repHdExportPayload('xlsx'); if (p) handleExport('xlsx', p); });
repHdPdf .addEventListener('click', () => { const p = repHdExportPayload('pdf');  if (p) handleExport('pdf',  p); });

// ── Drill-down modal ──────────────────────────────────────────
const hdModal = document.getElementById('rep-hd-modal');
const hdModalTitle = document.getElementById('rep-hd-modal-title');
const hdModalSummary = document.getElementById('rep-hd-modal-summary');
const hdModalTbody = document.getElementById('rep-hd-modal-tbody');
document.getElementById('icon-hdmodal-close').innerHTML = I.close(14);

function closeHdModal() { hdModal.classList.add('hidden'); }
hdModal.addEventListener('click', (e) => {
  if (e.target === hdModal || e.target.closest('[data-hdmodal-close]')) closeHdModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !hdModal.classList.contains('hidden')) closeHdModal();
});

async function openHdDetail(empleadoId) {
  if (!empleadoId || !repHdData) return;
  hdModalSummary.innerHTML = '<div class="users-muted" style="padding: 8px;">Cargando…</div>';
  hdModalTbody.innerHTML = '<tr class="users-empty-row"><td colspan="5">Cargando…</td></tr>';
  hdModal.classList.remove('hidden');

  const r = repHdData.rango;
  const res = await window.api.reporteHorasDentroFueraEmpleado(empleadoId, r.ini, r.fin);
  if (!res?.ok) {
    hdModalTitle.textContent = 'Detalle por día';
    hdModalSummary.innerHTML = '';
    hdModalTbody.innerHTML = `<tr class="users-empty-row"><td colspan="5">${escapeHtml(res?.error || 'Error')}</td></tr>`;
    return;
  }

  const emp = res.empleado;
  hdModalTitle.textContent = `Detalle: ${emp.nombre} ${emp.apellidos}`;

  const denom = res.total_inside_sec + res.total_outside_sec;
  const pct = denom > 0 ? (res.total_inside_sec / denom) * 100 : 0;

  hdModalSummary.innerHTML = `
    <div class="rep-summary-card">
      <span class="rep-summary-label">Empleado</span>
      <span class="rep-summary-value rep-summary-value--md">#${escapeHtml(emp.numero_empleado)}</span>
      <span class="rep-summary-sub">${escapeHtml(emp.puesto || '—')}</span>
    </div>
    <div class="rep-summary-card">
      <span class="rep-summary-label">Dentro</span>
      <span class="rep-summary-value rep-summary-value--xl">${fmtSecondsHM(res.total_inside_sec)}</span>
      <span class="rep-summary-sub">${res.dias_con_actividad}/${res.dias_laborables} días</span>
    </div>
    <div class="rep-summary-card">
      <span class="rep-summary-label">Fuera en horario</span>
      <span class="rep-summary-value rep-summary-value--xl">${fmtSecondsHM(res.total_outside_sec)}</span>
      <span class="rep-summary-sub">${res.dias_ausente} días ausente</span>
    </div>
    <div class="rep-summary-card">
      <span class="rep-summary-label">Cumplimiento</span>
      <span class="rep-summary-value rep-summary-value--xl">${fmtPct(pct)}</span>
      <span class="rep-summary-sub">${escapeHtml(res.rango.ini)} → ${escapeHtml(res.rango.fin)}</span>
    </div>
  `;

  if (!res.days.length) {
    hdModalTbody.innerHTML = '<tr class="users-empty-row"><td colspan="5">Sin días laborables en el rango.</td></tr>';
    return;
  }
  hdModalTbody.innerHTML = res.days.map((d) => {
    if (d.ausente) {
      return `
        <tr class="rep-hd-detail-row is-ausente">
          <td>${escapeHtml(fmtDateLong(d.date))}</td>
          <td colspan="4"><span class="badge badge-muted">Ausente</span></td>
        </tr>
      `;
    }
    const pctD = Math.max(0, Math.min(100, d.pct));
    const barColor = pctD >= 85 ? 'var(--success)' : pctD >= 60 ? '#f3bc4b' : 'var(--error)';
    const evs = d.events.map((e) => {
      const cls = e.tipo === 'entrada' ? 'reg-tipo-badge--in' : 'reg-tipo-badge--out';
      const motivo = e.motivo ? ` · ${escapeHtml(e.motivo)}` : '';
      return `<span class="rep-hd-evt"><span class="reg-tipo-badge ${cls}">${e.tipo === 'entrada' ? '↓' : '↑'}</span><span class="rep-hd-evt-time">${escapeHtml(e.time)}</span>${motivo}</span>`;
    }).join('');
    return `
      <tr class="rep-hd-detail-row">
        <td>${escapeHtml(fmtDateLong(d.date))}</td>
        <td style="text-align: right;"><span class="rep-bar-num">${fmtSecondsHM(d.inside_sec)}</span></td>
        <td style="text-align: right;"><span class="rep-bar-num">${fmtSecondsHM(d.outside_sec)}</span></td>
        <td>
          <div class="rep-hd-pct-cell">
            <div class="rep-hd-pct-bar">
              <span class="rep-hd-pct-fill" style="width:${pctD}%; background:${barColor};"></span>
            </div>
            <span class="rep-hd-pct-num">${fmtPct(d.pct)}</span>
          </div>
        </td>
        <td><div class="rep-hd-evts">${evs}</div></td>
      </tr>
    `;
  }).join('');
}

// ── Auditoría ─────────────────────────────────────────────────
const auditIniEl = document.getElementById('audit-ini');
const auditFinEl = document.getElementById('audit-fin');
const auditActionEl = document.getElementById('audit-action');
const auditUserEl = document.getElementById('audit-user');
const auditSearchEl = document.getElementById('audit-search');
const auditTbody = document.getElementById('audit-tbody');
const auditCountEl = document.getElementById('audit-count');
const auditBuscarBtn = document.getElementById('audit-buscar');
const auditRefreshBtn = document.getElementById('audit-refresh');
const auditPager = document.getElementById('audit-pager');
const auditPrev = document.getElementById('audit-prev');
const auditNext = document.getElementById('audit-next');
const auditPageInfo = document.getElementById('audit-page-info');

const AUDIT_PAGE_SIZE = 50;
const auditState = {
  offset: 0,
  total: 0,
  loaded: false,
  filtersLoaded: false,
};

(function initAuditDates() {
  const today = new Date();
  const past = new Date(today); past.setDate(past.getDate() - 6);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  auditIniEl.value = fmt(past);
  auditFinEl.value = fmt(today);
})();

// Labels for action codes (Spanish, friendly).
const AUDIT_ACTION_LABELS = {
  'auth.login':                'Inicio de sesión',
  'auth.login_fail':           'Login fallido',
  'auth.logout':               'Cierre de sesión',
  'auth.setup_initial_user':   'Setup inicial',
  'auth.reauth_fail':          'Reautenticación fallida',
  'user.create':               'Usuario · alta',
  'user.update':               'Usuario · edición',
  'user.estatus_change':       'Usuario · estatus',
  'user.permissions_change':   'Usuario · permisos',
  'user.settings_change':      'Usuario · preferencias',
  'empleado.create':           'Empleado · alta',
  'empleado.update':           'Empleado · edición',
  'empleado.estatus_change':   'Empleado · estatus',
  'evento.create':             'Registro · alta',
  'evento.update':             'Registro · edición',
  'evento.delete':             'Registro · eliminación',
  'catalogo.create':           'Catálogo · alta',
  'catalogo.update':           'Catálogo · edición',
  'catalogo.estatus_change':   'Catálogo · estatus',
  'catalogo.delete':           'Catálogo · eliminación',
  'config.work_schedule_update': 'Horario laboral · cambio',
  'config.company_name_update':  'Nombre empresa · cambio',
  'config.company_logo_update':  'Logo empresa · cambio',
  'config.company_logo_remove':  'Logo empresa · eliminación',
};
function auditActionLabel(code) {
  return AUDIT_ACTION_LABELS[code] || code;
}
function auditActionKind(code) {
  if (!code) return 'neutral';
  if (code.includes('_fail')) return 'danger';
  if (code.endsWith('.delete')) return 'danger';
  if (code.startsWith('auth.')) return 'auth';
  if (code.endsWith('.create')) return 'create';
  if (code.endsWith('.update') || code.endsWith('.estatus_change') || code.endsWith('.permissions_change') || code.endsWith('.settings_change') || code.endsWith('.work_schedule_update')) return 'update';
  return 'neutral';
}

function auditFmtDateTime(iso) {
  if (!iso) return '—';
  const utcIso = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-MX', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

async function loadAuditFilters() {
  if (auditState.filtersLoaded) return;
  const [actRes, userRes] = await Promise.all([
    window.api.auditListActions(),
    window.api.auditListUsers(),
  ]);
  if (actRes?.ok) {
    auditActionEl.innerHTML = '<option value="">Todas</option>' +
      actRes.actions.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(auditActionLabel(a))}</option>`).join('');
  }
  if (userRes?.ok) {
    auditUserEl.innerHTML = '<option value="">Todos</option>' +
      userRes.users.map((u) => `<option value="${u.id}">${escapeHtml(u.username)}</option>`).join('');
  }
  auditState.filtersLoaded = true;
}

function getAuditFilters() {
  return {
    ini: auditIniEl.value,
    fin: auditFinEl.value,
    action: auditActionEl.value,
    userId: auditUserEl.value ? parseInt(auditUserEl.value, 10) : null,
    search: auditSearchEl.value.trim(),
    limit: AUDIT_PAGE_SIZE,
    offset: auditState.offset,
  };
}

async function loadAuditLog() {
  auditTbody.innerHTML = '<tr class="users-empty-row"><td colspan="5">Cargando…</td></tr>';
  auditPager.classList.add('hidden');
  const res = await window.api.auditList(getAuditFilters());
  if (!res?.ok) {
    auditCountEl.textContent = '0';
    auditTbody.innerHTML = `<tr class="users-empty-row"><td colspan="5">${escapeHtml(res?.error || 'Error')}</td></tr>`;
    return;
  }
  auditState.total = res.total;
  auditState.loaded = true;
  auditCountEl.textContent = res.total;

  if (!res.rows.length) {
    auditTbody.innerHTML = '<tr class="users-empty-row"><td colspan="5">Sin eventos en este filtro.</td></tr>';
    return;
  }

  auditTbody.innerHTML = res.rows.map((row) => {
    const kind = auditActionKind(row.action);
    const label = auditActionLabel(row.action);
    const entityLabel = row.entity_label || (row.entity_type ? `${row.entity_type}#${row.entity_id ?? ''}` : '—');
    return `
      <tr class="audit-row" data-id="${row.id}">
        <td><span class="audit-time">${escapeHtml(auditFmtDateTime(row.timestamp))}</span></td>
        <td><span class="audit-user">@${escapeHtml(row.username)}</span></td>
        <td><span class="audit-badge audit-badge--${kind}">${escapeHtml(label)}</span></td>
        <td>
          <div class="audit-entity">
            <span class="audit-entity-label">${escapeHtml(entityLabel)}</span>
            <span class="audit-entity-type">${escapeHtml(row.entity_type || '')}</span>
          </div>
        </td>
        <td style="text-align: right;">
          <button type="button" class="row-icon-btn" data-audit-view="${row.id}" title="Ver detalle" aria-label="Ver detalle">${I.eye(15)}</button>
        </td>
      </tr>
    `;
  }).join('');

  // Pager
  const start = res.offset + 1;
  const end = Math.min(res.offset + res.rows.length, res.total);
  auditPageInfo.textContent = `${start}–${end} de ${res.total}`;
  auditPrev.disabled = res.offset === 0;
  auditNext.disabled = end >= res.total;
  auditPager.classList.remove('hidden');

  // Cache row data for detail modal
  auditState.lastRows = new Map(res.rows.map((r) => [r.id, r]));
}

auditBuscarBtn.addEventListener('click', () => { auditState.offset = 0; loadAuditLog(); });
auditRefreshBtn.addEventListener('click', () => { auditState.offset = 0; loadAuditLog(); });
auditSearchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { auditState.offset = 0; loadAuditLog(); }
});
auditActionEl.addEventListener('change', () => { auditState.offset = 0; loadAuditLog(); });
auditUserEl.addEventListener('change', () => { auditState.offset = 0; loadAuditLog(); });

auditPrev.addEventListener('click', () => {
  if (auditState.offset === 0) return;
  auditState.offset = Math.max(0, auditState.offset - AUDIT_PAGE_SIZE);
  loadAuditLog();
});
auditNext.addEventListener('click', () => {
  if (auditState.offset + AUDIT_PAGE_SIZE >= auditState.total) return;
  auditState.offset += AUDIT_PAGE_SIZE;
  loadAuditLog();
});

// Detail modal
const auditDetailModal = document.getElementById('audit-detail-modal');
const auditDetailMeta = document.getElementById('audit-detail-meta');
const auditDetailJson = document.getElementById('audit-detail-json');
document.getElementById('icon-audmodal-close').innerHTML = I.close(14);

function closeAuditDetail() { auditDetailModal.classList.add('hidden'); }
auditDetailModal.addEventListener('click', (e) => {
  if (e.target === auditDetailModal || e.target.closest('[data-audmodal-close]')) closeAuditDetail();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !auditDetailModal.classList.contains('hidden')) closeAuditDetail();
});

auditTbody.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-audit-view]');
  if (!btn) return;
  const id = parseInt(btn.dataset.auditView, 10);
  const row = auditState.lastRows?.get(id);
  if (!row) return;
  const kind = auditActionKind(row.action);
  auditDetailMeta.innerHTML = `
    <div class="audit-detail-meta-row"><span class="audit-detail-meta-label">Fecha</span><span>${escapeHtml(auditFmtDateTime(row.timestamp))}</span></div>
    <div class="audit-detail-meta-row"><span class="audit-detail-meta-label">Usuario</span><span>@${escapeHtml(row.username)}</span></div>
    <div class="audit-detail-meta-row"><span class="audit-detail-meta-label">Acción</span><span class="audit-badge audit-badge--${kind}">${escapeHtml(auditActionLabel(row.action))}</span></div>
    <div class="audit-detail-meta-row"><span class="audit-detail-meta-label">Entidad</span><span>${escapeHtml(row.entity_label || row.entity_type || '—')}</span></div>
  `;
  auditDetailJson.textContent = row.details ? JSON.stringify(row.details, null, 2) : '(sin datos adicionales)';
  auditDetailModal.classList.remove('hidden');
});

// ── Logout ────────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', async () => {
  await window.api.logout();
  window.location.href = '../login/login.html';
});

// ── Theme pills ───────────────────────────────────────────────
const pillsEl = document.getElementById('theme-pills');
const THEMES = [
  { value: 'claro', label: 'Claro' },
  { value: 'oscuro', label: 'Oscuro' },
];
function renderPills() {
  const active = currentUser?.theme || T.DEFAULTS.theme;
  pillsEl.innerHTML = THEMES.map((th) => `
    <button type="button" data-theme="${th.value}" class="theme-pill ${active === th.value ? 'is-active' : ''}">
      ${th.label}
    </button>
  `).join('');
  pillsEl.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const updated = await T.persist({ theme: btn.dataset.theme });
      if (updated) currentUser = updated;
      renderPills();
    });
  });
}
renderPills();

// ── Accent swatches ───────────────────────────────────────────
const swatchEl = document.getElementById('accent-swatches');
function renderSwatches() {
  const active = currentUser?.accent || T.DEFAULTS.accent;
  const isCustom = T.isHex(active);
  const presets = Object.entries(T.ACCENTS).map(([key, hex]) => `
    <button type="button" data-accent="${key}" class="swatch ${!isCustom && active === key ? 'is-active' : ''}" style="background:${hex};" title="${key}" aria-label="Acento ${key}"></button>
  `).join('');
  // Custom picker value: the current hex if custom, else a sensible starting hex (current named's value).
  const pickerValue = isCustom ? active : T.accentHex(active);
  swatchEl.innerHTML = `
    ${presets}
    <input type="color" id="accent-custom" class="swatch-custom ${isCustom ? 'is-active' : ''}" value="${pickerValue}" title="Color personalizado" aria-label="Color personalizado" />
  `;
  swatchEl.querySelectorAll('button[data-accent]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const updated = await T.persist({ accent: btn.dataset.accent });
      if (updated) currentUser = updated;
      renderSwatches();
    });
  });
  const picker = document.getElementById('accent-custom');
  picker.addEventListener('change', async () => {
    const updated = await T.persist({ accent: picker.value });
    if (updated) currentUser = updated;
    renderSwatches();
  });
}
renderSwatches();
