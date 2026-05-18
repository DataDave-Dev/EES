const I = window.EES_ICONS;
const PERMS = window.EES_PERMISSIONS;

// ── Helpers (subset of dashboard.js) ──────────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function initials(nombre, apellidos) {
  return ((nombre?.[0] || '') + (apellidos?.[0] || '')).toUpperCase() || '·';
}
const fmtTime = window.EES_TIME.fmtTime12;

function goBack() {
  window.location.href = '../dashboard/dashboard.html#registro';
}

// ── Auth gate ─────────────────────────────────────────────────
let currentUser = null;
async function bootstrap() {
  currentUser = await window.api.getCurrentUser();
  if (!currentUser) { window.location.href = '../login/login.html'; return; }
  if (!PERMS.has(currentUser, 'registro')) { goBack(); return; }
}
bootstrap();

// ── Static icons ──────────────────────────────────────────────
document.getElementById('regn-back-icon').innerHTML = I.arrowLeft(14);
document.getElementById('reg-search-icon').innerHTML = I.search(16);
document.getElementById('reg-icon-in').innerHTML = I.enter(18);
document.getElementById('reg-icon-out').innerHTML = I.exit(18);
document.getElementById('reg-quick-add-icon').innerHTML = I.plus(13);
document.getElementById('reg-tipo-add-icon').innerHTML = I.plus(13);
document.getElementById('icon-tipomodal-close').innerHTML = I.close(16);
document.getElementById('icon-empmodal-close').innerHTML = I.close(16);
document.getElementById('reg-now-reset-icon').innerHTML = I.refresh(13);

// ── Refs ──────────────────────────────────────────────────────
const regSearchInput = document.getElementById('reg-search');
const regResults = document.getElementById('reg-results');
const regSelected = document.getElementById('reg-selected');
const regBtnIn = document.getElementById('reg-btn-in');
const regBtnOut = document.getElementById('reg-btn-out');
const regNowDate = document.getElementById('reg-now-date');
const regNowTime = document.getElementById('reg-now-time');
const regSalidaFields = document.getElementById('reg-salida-fields');
const regSalidaTipo = document.getElementById('reg-salida-tipo');
const regSalidaDetalle = document.getElementById('reg-salida-detalle');
const regTipoAddBtn = document.getElementById('reg-tipo-add-btn');
const regTipoModal = document.getElementById('reg-tipo-modal');
const regTipoForm = document.getElementById('reg-tipo-form');
const regTipoInput = document.getElementById('reg-tipo-input');
const regTipoSave = document.getElementById('reg-tipo-save');
const regTipoError = document.getElementById('reg-tipo-error');

let regSearchTimer = null;
let regSelectedEmpleado = null;
let regLastEventToday = null;

// ── Live clock (inputs editables) ─────────────────────────────
// Los inputs se autocompletan con la hora actual cada segundo mientras el
// usuario no los haya editado. En cuanto edita uno, se "congela" y deja de
// auto-actualizarse. El botón "Ahora" resincroniza ambos al instante.
const regNowReset = document.getElementById('reg-now-reset');
let regNowEdited = false;

function pad2(n) { return String(n).padStart(2, '0'); }
function localDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function localTimeStr(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fillNowInputs() {
  const now = new Date();
  regNowDate.value = localDateStr(now);
  regNowTime.value = localTimeStr(now);
}

function tick() {
  if (regNowEdited) return;
  fillNowInputs();
}
fillNowInputs();
setInterval(tick, 1000);

regNowDate.addEventListener('input', () => { regNowEdited = true; });
regNowTime.addEventListener('input', () => { regNowEdited = true; });
regNowReset.addEventListener('click', () => {
  regNowEdited = false;
  fillNowInputs();
});

// Construye 'YYYY-MM-DD HH:MM:SS' en UTC a partir de los inputs locales.
// Devuelve null si el usuario no ha editado (para que el backend use el default).
function buildTimestampUtc() {
  if (!regNowEdited) return null;
  const date = regNowDate.value;
  const time = regNowTime.value;
  if (!date || !time) return { error: 'Fecha y hora son requeridas.' };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!m || !t) return { error: 'Fecha y hora no válidas.' };
  const local = new Date(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(t[1]), Number(t[2]), 0, 0
  );
  if (Number.isNaN(local.getTime())) return { error: 'Fecha y hora no válidas.' };
  const u = local;
  return (
    `${u.getUTCFullYear()}-${pad2(u.getUTCMonth() + 1)}-${pad2(u.getUTCDate())} ` +
    `${pad2(u.getUTCHours())}:${pad2(u.getUTCMinutes())}:${pad2(u.getUTCSeconds())}`
  );
}

// ── Salida tipos catalog ──────────────────────────────────────
async function loadSalidaTipos(preselect = null) {
  const res = await window.api.listCatalogo('motivos', { activeOnly: true });
  if (!res?.ok) return;
  const current = preselect ?? regSalidaTipo.value;
  const items = res.items.map((i) => i.valor);
  regSalidaTipo.innerHTML = ['<option value="">Selecciona…</option>']
    .concat(items.map((v) => `<option value="${escapeHtml(v)}"${current === v ? ' selected' : ''}>${escapeHtml(v)}</option>`))
    .join('');
}
loadSalidaTipos();

// ── Modal focus management (a11y) ─────────────────────────────
// rememberFocus guarda el último elemento con foco antes de abrir el modal.
// activateModal habilita el focus-trap (Tab/Shift+Tab circulan dentro).
// restoreFocus libera el trap y devuelve el foco al elemento previo.
const _modalLastFocus = new WeakMap();
const _modalTrapRelease = new WeakMap();
function rememberFocus(modal) {
  const el = document.activeElement;
  if (el && el !== document.body) _modalLastFocus.set(modal, el);
}
function activateModal(modal) {
  const release = window.EES_FOCUS_TRAP.trap(modal);
  _modalTrapRelease.set(modal, release);
}
function restoreFocus(modal) {
  const release = _modalTrapRelease.get(modal);
  if (release) { release(); _modalTrapRelease.delete(modal); }
  const prev = _modalLastFocus.get(modal);
  _modalLastFocus.delete(modal);
  if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
    setTimeout(() => prev.focus(), 0);
  }
}

function openTipoModal() {
  regTipoError.classList.add('hidden');
  regTipoError.textContent = '';
  regTipoInput.value = '';
  rememberFocus(regTipoModal);
  regTipoModal.classList.remove('hidden');
  activateModal(regTipoModal);
  setTimeout(() => regTipoInput.focus(), 30);
}
function closeTipoModal() {
  regTipoModal.classList.add('hidden');
  restoreFocus(regTipoModal);
  regTipoError.classList.add('hidden');
  regTipoError.textContent = '';
  regTipoInput.value = '';
}
regTipoAddBtn.addEventListener('click', openTipoModal);

regTipoModal.addEventListener('click', (e) => {
  if (e.target === regTipoModal || e.target.closest('[data-tipomodal-close]')) {
    closeTipoModal();
  }
});

regTipoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const v = regTipoInput.value.trim();
  if (!v) {
    regTipoError.textContent = 'Escribe un nombre.';
    regTipoError.classList.remove('hidden');
    return;
  }
  regTipoSave.disabled = true;
  const prevLabel = regTipoSave.textContent;
  regTipoSave.textContent = 'Agregando…';
  const res = await window.api.addCatalogoItem('motivos', v);
  regTipoSave.disabled = false;
  regTipoSave.textContent = prevLabel;
  if (!res?.ok) {
    regTipoError.textContent = res?.error || 'No se pudo agregar';
    regTipoError.classList.remove('hidden');
    return;
  }
  await loadSalidaTipos(res.item.valor);
  closeTipoModal();
});

// ── Empleado search + selection ───────────────────────────────
let regComboActive = -1;

function setComboActive(idx) {
  const opts = regResults.querySelectorAll('button.reg-result-card');
  if (!opts.length) {
    regComboActive = -1;
    regSearchInput.removeAttribute('aria-activedescendant');
    return;
  }
  regComboActive = ((idx % opts.length) + opts.length) % opts.length;
  opts.forEach((el, i) => {
    el.classList.toggle('is-active', i === regComboActive);
    el.setAttribute('aria-selected', i === regComboActive ? 'true' : 'false');
  });
  const active = opts[regComboActive];
  if (active) {
    regSearchInput.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }
}

function renderSearchResults(list) {
  if (!list.length) {
    regResults.innerHTML = '<div class="reg-empty" role="status">Sin coincidencias.</div>';
    regResults.classList.remove('hidden');
    regSearchInput.setAttribute('aria-expanded', 'true');
    regSearchInput.removeAttribute('aria-activedescendant');
    regComboActive = -1;
    return;
  }
  regResults.innerHTML = list.map((e, idx) => `
    <button type="button" class="reg-result-card" data-id="${e.id}" id="reg-result-opt-${idx}" role="option" aria-selected="false">
      <span class="reg-result-num">#${escapeHtml(e.numero_empleado)}</span>
      <span>
        <div class="reg-result-name">${escapeHtml(e.nombre)} ${escapeHtml(e.apellidos)}</div>
        ${e.puesto || e.departamento
          ? `<div class="reg-result-sub">${escapeHtml([e.puesto, e.departamento].filter(Boolean).join(' · '))}</div>`
          : ''}
      </span>
    </button>
  `).join('');
  regResults.classList.remove('hidden');
  regSearchInput.setAttribute('aria-expanded', 'true');
  regComboActive = -1;
}

function clearSearchResults() {
  regResults.innerHTML = '';
  regResults.classList.add('hidden');
  regSearchInput.setAttribute('aria-expanded', 'false');
  regSearchInput.removeAttribute('aria-activedescendant');
  regComboActive = -1;
}

function renderSelected() {
  const hint = document.getElementById('reg-actions-hint');
  if (!regSelectedEmpleado) {
    regSelected.classList.add('hidden');
    regSelected.innerHTML = '';
    regSalidaFields.classList.add('reg-step--disabled');
    regBtnIn.disabled = true;
    regBtnOut.disabled = true;
    if (hint) {
      hint.textContent = 'Selecciona un empleado para registrar entrada o salida.';
      hint.classList.remove('hidden');
    }
    return;
  }
  if (hint) hint.classList.add('hidden');
  regSalidaFields.classList.remove('reg-step--disabled');
  const e = regSelectedEmpleado;
  const metaParts = [`#${e.numero_empleado}`];
  if (e.puesto) metaParts.push(e.puesto);
  if (e.departamento) metaParts.push(e.departamento);
  const lastTxt = regLastEventToday
    ? `<b>${fmtTime(regLastEventToday.timestamp)} · ${regLastEventToday.tipo}</b>`
    : 'sin eventos hoy';
  regSelected.innerHTML = `
    <div class="reg-selected-info">
      <div class="reg-selected-name">${escapeHtml(e.nombre)} ${escapeHtml(e.apellidos)}</div>
      <div class="reg-selected-meta">${escapeHtml(metaParts.join(' · '))}</div>
    </div>
    <div class="reg-selected-last">${lastTxt}</div>
    <button type="button" class="reg-selected-clear" id="reg-selected-clear" title="Quitar selección" aria-label="Quitar selección">${I.close(14)}</button>
  `;
  regSelected.classList.remove('hidden');
  regBtnIn.disabled = false;
  regBtnOut.disabled = false;
  document.getElementById('reg-selected-clear').addEventListener('click', clearSelected);
}

function clearSelected() {
  regSelectedEmpleado = null;
  regLastEventToday = null;
  regSalidaTipo.value = '';
  regSalidaDetalle.value = '';
  closeTipoModal();
  renderSelected();
}

async function selectEmpleado(id) {
  clearSearchResults();
  regSearchInput.value = '';
  const res = await window.api.getEmpleadoStatus(id);
  if (!res?.ok) {
    EES_TOAST.error(res?.error || 'No se pudo cargar el empleado.');
    return;
  }
  regSelectedEmpleado = res.empleado;
  regLastEventToday = res.lastEvent;
  renderSelected();
}

const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_RESULT_LIMIT = 8;
regSearchInput.addEventListener('input', () => {
  const q = regSearchInput.value.trim();
  if (regSearchTimer) clearTimeout(regSearchTimer);
  if (!q) { clearSearchResults(); return; }
  regSearchTimer = setTimeout(async () => {
    const res = await window.api.searchEmpleados(q, SEARCH_RESULT_LIMIT);
    if (!res?.ok) { clearSearchResults(); return; }
    renderSearchResults(res.empleados);
  }, SEARCH_DEBOUNCE_MS);
});

regResults.addEventListener('click', (e) => {
  const btn = e.target.closest('button.reg-result-card');
  if (!btn) return;
  selectEmpleado(Number(btn.dataset.id));
});

regSearchInput.addEventListener('keydown', (e) => {
  const open = !regResults.classList.contains('hidden');
  const opts = regResults.querySelectorAll('button.reg-result-card');
  if (e.key === 'ArrowDown') {
    if (!open || !opts.length) return;
    e.preventDefault();
    setComboActive(regComboActive < 0 ? 0 : regComboActive + 1);
  } else if (e.key === 'ArrowUp') {
    if (!open || !opts.length) return;
    e.preventDefault();
    setComboActive(regComboActive < 0 ? opts.length - 1 : regComboActive - 1);
  } else if (e.key === 'Enter') {
    if (!open || regComboActive < 0 || !opts.length) return;
    e.preventDefault();
    selectEmpleado(Number(opts[regComboActive].dataset.id));
  } else if (e.key === 'Escape') {
    if (open) {
      e.preventDefault();
      e.stopPropagation();
      clearSearchResults();
    }
  } else if (e.key === 'Home' && open && opts.length) {
    e.preventDefault();
    setComboActive(0);
  } else if (e.key === 'End' && open && opts.length) {
    e.preventDefault();
    setComboActive(opts.length - 1);
  }
});

document.addEventListener('click', (e) => {
  if (!regResults.classList.contains('hidden')) {
    if (!e.target.closest('#reg-results') && !e.target.closest('#reg-search')) {
      clearSearchResults();
    }
  }
});

// ── Mark event ────────────────────────────────────────────────
async function markRegistro(tipo) {
  // Defensa: bootstrap() es async; si el usuario logra clickar antes de que
  // termine de hidratarse currentUser, evitamos enviar un evento sin sesion.
  if (!currentUser) return;
  if (!regSelectedEmpleado) return;
  const t = regSalidaTipo.value;
  const d = regSalidaDetalle.value.trim();

  if (tipo === 'salida' && !t) {
    EES_TOAST.error('Selecciona el motivo de la salida.');
    regSalidaTipo.focus();
    return;
  }
  // motivo + detalle aplican a ambos tipos; vacíos = no se registra motivo.
  const motivo = (t || d) ? { tipo: t, detalle: d } : null;

  const ts = buildTimestampUtc();
  if (ts && typeof ts === 'object' && ts.error) {
    EES_TOAST.error(ts.error);
    return;
  }

  regBtnIn.disabled = true;
  regBtnOut.disabled = true;
  const res = await window.api.markEvent(regSelectedEmpleado.id, tipo, motivo, ts || undefined);
  if (!res?.ok) {
    EES_TOAST.error(res?.error || 'No se pudo registrar el evento');
    regBtnIn.disabled = false;
    regBtnOut.disabled = false;
    return;
  }
  goBack();
}
regBtnIn.addEventListener('click', () => markRegistro('entrada'));
regBtnOut.addEventListener('click', () => markRegistro('salida'));

// ── Back / cancel ─────────────────────────────────────────────
document.getElementById('regn-back').addEventListener('click', goBack);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Modals trap their own Escape (close the modal). If any modal is open, do nothing here.
  if (!regTipoModal.classList.contains('hidden')) { closeTipoModal(); return; }
  if (!document.getElementById('empleado-modal').classList.contains('hidden')) return;
  goBack();
});

// ── Quick-add empleado modal ──────────────────────────────────
const empleadoModal = document.getElementById('empleado-modal');
const empleadoForm = document.getElementById('empleado-form');
const emNombre = document.getElementById('em-nombre');
const emApellidos = document.getElementById('em-apellidos');
const emPuesto = document.getElementById('em-puesto');
const emDepartamento = document.getElementById('em-departamento');
const emError = document.getElementById('em-error');
const emSubmit = document.getElementById('em-submit');

function openEmpleadoModal() {
  emNombre.value = '';
  emApellidos.value = '';
  emPuesto.value = '';
  emDepartamento.value = '';
  emError.classList.add('hidden');
  emError.textContent = '';
  rememberFocus(empleadoModal);
  empleadoModal.classList.remove('hidden');
  activateModal(empleadoModal);
  setTimeout(() => emNombre.focus(), 30);
}
function closeEmpleadoModal() {
  empleadoModal.classList.add('hidden');
  restoreFocus(empleadoModal);
}

document.getElementById('reg-quick-add').addEventListener('click', openEmpleadoModal);
empleadoModal.addEventListener('click', (e) => {
  if (e.target === empleadoModal || e.target.closest('[data-empmodal-close]')) {
    closeEmpleadoModal();
  }
});

empleadoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  emError.classList.add('hidden');
  emError.textContent = '';

  const payload = {
    nombre: emNombre.value,
    apellidos: emApellidos.value,
    puesto: emPuesto.value,
    departamento: emDepartamento.value,
  };

  emSubmit.disabled = true;
  const prevLabel = emSubmit.textContent;
  emSubmit.textContent = 'Creando…';
  const res = await window.api.quickCreateEmpleado(payload);
  emSubmit.disabled = false;
  emSubmit.textContent = prevLabel;

  if (!res?.ok) {
    emError.textContent = res?.error || 'No se pudo guardar';
    emError.classList.remove('hidden');
    return;
  }

  closeEmpleadoModal();
  // Auto-select the newly created empleado.
  selectEmpleado(res.empleado.id);
});
