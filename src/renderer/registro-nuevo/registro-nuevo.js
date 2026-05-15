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
function fmtTime(iso) {
  if (!iso) return '—';
  const utcIso = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
  const d = new Date(utcIso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('es-MX', { hour: 'numeric', minute: '2-digit', hour12: true });
}

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

// ── Live clock ────────────────────────────────────────────────
function tick() {
  const now = new Date();
  regNowDate.textContent = now.toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  regNowTime.textContent = now.toLocaleTimeString('es-MX', {
    hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true,
  });
}
tick();
setInterval(tick, 1000);

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

function openTipoModal() {
  regTipoError.classList.add('hidden');
  regTipoError.textContent = '';
  regTipoInput.value = '';
  regTipoModal.classList.remove('hidden');
  setTimeout(() => regTipoInput.focus(), 30);
}
function closeTipoModal() {
  regTipoModal.classList.add('hidden');
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
function renderSearchResults(list) {
  if (!list.length) {
    regResults.innerHTML = '<div class="reg-empty">Sin coincidencias.</div>';
    regResults.classList.remove('hidden');
    return;
  }
  regResults.innerHTML = list.map((e) => `
    <button type="button" class="reg-result-card" data-id="${e.id}">
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
}

function clearSearchResults() {
  regResults.innerHTML = '';
  regResults.classList.add('hidden');
}

function renderSelected() {
  if (!regSelectedEmpleado) {
    regSelected.classList.add('hidden');
    regSelected.innerHTML = '';
    regSalidaFields.classList.add('hidden');
    regBtnIn.disabled = true;
    regBtnOut.disabled = true;
    return;
  }
  regSalidaFields.classList.remove('hidden');
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
    alert(res?.error || 'No se pudo cargar el empleado.');
    return;
  }
  regSelectedEmpleado = res.empleado;
  regLastEventToday = res.lastEvent;
  renderSelected();
}

regSearchInput.addEventListener('input', () => {
  const q = regSearchInput.value.trim();
  if (regSearchTimer) clearTimeout(regSearchTimer);
  if (!q) { clearSearchResults(); return; }
  regSearchTimer = setTimeout(async () => {
    const res = await window.api.searchEmpleados(q, 8);
    if (!res?.ok) { clearSearchResults(); return; }
    renderSearchResults(res.empleados);
  }, 150);
});

regResults.addEventListener('click', (e) => {
  const btn = e.target.closest('button.reg-result-card');
  if (!btn) return;
  selectEmpleado(Number(btn.dataset.id));
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
  if (!regSelectedEmpleado) return;
  const t = regSalidaTipo.value;
  const d = regSalidaDetalle.value.trim();

  if (tipo === 'salida' && !t) {
    alert('Selecciona el motivo de la salida.');
    regSalidaTipo.focus();
    return;
  }
  // motivo + detalle aplican a ambos tipos; vacíos = no se registra motivo.
  const motivo = (t || d) ? { tipo: t, detalle: d } : null;

  regBtnIn.disabled = true;
  regBtnOut.disabled = true;
  const res = await window.api.markEvent(regSelectedEmpleado.id, tipo, motivo);
  if (!res?.ok) {
    alert(res?.error || 'No se pudo registrar el evento');
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
  empleadoModal.classList.remove('hidden');
  setTimeout(() => emNombre.focus(), 30);
}
function closeEmpleadoModal() {
  empleadoModal.classList.add('hidden');
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
