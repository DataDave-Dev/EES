const I = window.EES_ICONS;
const PERMS = window.EES_PERMISSIONS;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function goBack() {
  window.location.href = '../dashboard/dashboard.html#inasistencias';
}

// ── Modo: create vs edit (?id=N en URL) ───────────────────────
const _params = new URLSearchParams(window.location.search);
const editId = _params.get('id') ? Number(_params.get('id')) : null;
const isEdit = Number.isInteger(editId) && editId > 0;

// ── Auth gate ─────────────────────────────────────────────────
let currentUser = null;
async function bootstrap() {
  currentUser = await window.api.getCurrentUser();
  if (!currentUser) { window.location.href = '../login/login.html'; return; }
  if (!PERMS.has(currentUser, 'inasistencias')) { goBack(); return; }
  await Promise.all([loadEmpleados(), loadMotivos()]);
  if (isEdit) await loadExistingRecord(editId);
  updateUI();
}

// ── Iconos ────────────────────────────────────────────────────
document.getElementById('ina-back-icon').innerHTML = I.arrowLeft(14);
document.getElementById('ina-search-icon').innerHTML = I.search(16);
document.getElementById('ina-today-icon').innerHTML = I.refresh(13);
document.getElementById('ina-evidencia-icon').innerHTML = I.paperclip(14);
document.getElementById('ina-submit-icon').innerHTML = I.check(14);

// ── Refs ──────────────────────────────────────────────────────
const pageTitle = document.getElementById('ina-page-title');
const searchInput = document.getElementById('ina-search');
const resultsBox = document.getElementById('ina-results');
const selectedBox = document.getElementById('ina-selected');
const stepPeriodo = document.getElementById('ina-step-periodo');
const stepMotivo = document.getElementById('ina-step-motivo');
const stepEvidencia = document.getElementById('ina-step-evidencia');
const stepPw = document.getElementById('ina-step-pw');
const fechaIni = document.getElementById('ina-fecha-ini');
const fechaFin = document.getElementById('ina-fecha-fin');
const motivoSel = document.getElementById('ina-motivo-tipo');
const motivoDetalle = document.getElementById('ina-motivo-detalle');
const evidenciaCurrent = document.getElementById('ina-evidencia-current');
const evidenciaFile = document.getElementById('ina-evidencia-file');
const evidenciaClear = document.getElementById('ina-evidencia-clear');
const evidenciaLabel = document.getElementById('ina-evidencia-label-text');
const errorBox = document.getElementById('ina-error');
const submitBtn = document.getElementById('ina-submit');
const submitLabel = document.getElementById('ina-submit-label');
const cancelBtn = document.getElementById('ina-cancel');
const pwInput = document.getElementById('ina-pw');
const todayBtn = document.getElementById('ina-step-today');

// ── Estado ────────────────────────────────────────────────────
let activeEmpleados = [];     // catálogo cargado de empleados activos
let motivosCache = [];        // catálogo de motivos activos
let selected = null;          // empleado seleccionado
let currentEvidenciaMeta = null;  // del registro existente (sólo edición)
let evidenciaPending = undefined;
// undefined: no se toca el adjunto.
// null: el usuario quitó el adjunto actual (sólo edición).
// { name, mime, dataBase64 }: archivo nuevo a subir/reemplazar.
let existingRecord = null;
let searchTimer = null;

function todayLocalISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function loadEmpleados() {
  const res = await window.api.listInasistenciasEmpleados();
  if (res?.ok) activeEmpleados = res.empleados;
}

async function loadMotivos() {
  const res = await window.api.listCatalogo('inasistencia_motivos', { activeOnly: true });
  if (!res?.ok) return;
  motivosCache = res.items;
  motivoSel.innerHTML = ['<option value="">Selecciona…</option>']
    .concat(res.items.map((i) => `<option value="${escapeHtml(i.valor)}">${escapeHtml(i.valor)}</option>`))
    .join('');
}

async function loadExistingRecord(id) {
  const res = await window.api.listInasistencias({});
  if (!res?.ok) {
    EES_TOAST.error('No se pudo cargar la inasistencia.');
    goBack();
    return;
  }
  const row = res.inasistencias.find((r) => r.id === id);
  if (!row) {
    EES_TOAST.error('Inasistencia no encontrada.');
    goBack();
    return;
  }
  existingRecord = row;
  pageTitle.textContent = 'Editar inasistencia';
  submitLabel.textContent = 'Guardar cambios';

  if (row.empleado) {
    selected = {
      id: row.empleado.id,
      numero_empleado: row.empleado.numero_empleado,
      nombre: row.empleado.nombre,
      apellidos: row.empleado.apellidos,
      estatus: row.empleado.estatus,
    };
    renderSelected();
  }
  fechaIni.value = row.fecha_ini;
  fechaFin.value = row.fecha_fin;
  motivoSel.value = row.motivo_tipo;
  motivoDetalle.value = row.motivo_detalle || '';
  if (row.evidencia) {
    currentEvidenciaMeta = row.evidencia;
    showEvidenciaState(`Adjunto actual: ${row.evidencia.filename || 'archivo'}`, true);
    evidenciaLabel.textContent = 'Reemplazar archivo';
  }
  stepPw.classList.remove('hidden');
}

// ── Buscador de empleados ─────────────────────────────────────
function filterEmpleados(q) {
  const needle = q.toLowerCase();
  return activeEmpleados.filter((e) => {
    const hay = `${e.numero_empleado} ${e.nombre} ${e.apellidos}`.toLowerCase();
    return hay.includes(needle);
  }).slice(0, 8);
}

let inaComboActive = -1;

function setComboActive(idx) {
  const opts = resultsBox.querySelectorAll('button.reg-result-card');
  if (!opts.length) {
    inaComboActive = -1;
    searchInput.removeAttribute('aria-activedescendant');
    return;
  }
  inaComboActive = ((idx % opts.length) + opts.length) % opts.length;
  opts.forEach((el, i) => {
    el.classList.toggle('is-active', i === inaComboActive);
    el.setAttribute('aria-selected', i === inaComboActive ? 'true' : 'false');
  });
  const active = opts[inaComboActive];
  if (active) {
    searchInput.setAttribute('aria-activedescendant', active.id);
    active.scrollIntoView({ block: 'nearest' });
  }
}

function renderResults(list) {
  if (!list.length) {
    resultsBox.innerHTML = '<div class="reg-empty" role="status">Sin coincidencias.</div>';
    resultsBox.classList.remove('hidden');
    searchInput.setAttribute('aria-expanded', 'true');
    searchInput.removeAttribute('aria-activedescendant');
    inaComboActive = -1;
    return;
  }
  resultsBox.innerHTML = list.map((e, idx) => `
    <button type="button" class="reg-result-card" data-id="${e.id}" id="ina-result-opt-${idx}" role="option" aria-selected="false">
      <span class="reg-result-num">#${escapeHtml(e.numero_empleado)}</span>
      <span>
        <div class="reg-result-name">${escapeHtml(e.nombre)} ${escapeHtml(e.apellidos)}</div>
      </span>
    </button>
  `).join('');
  resultsBox.classList.remove('hidden');
  searchInput.setAttribute('aria-expanded', 'true');
  inaComboActive = -1;
}

function clearResults() {
  resultsBox.innerHTML = '';
  resultsBox.classList.add('hidden');
  searchInput.setAttribute('aria-expanded', 'false');
  searchInput.removeAttribute('aria-activedescendant');
  inaComboActive = -1;
}

function renderSelected() {
  if (!selected) {
    selectedBox.classList.add('hidden');
    selectedBox.innerHTML = '';
    return;
  }
  selectedBox.innerHTML = `
    <div class="reg-selected-info">
      <div class="reg-selected-name">${escapeHtml(selected.nombre)} ${escapeHtml(selected.apellidos)}</div>
      <div class="reg-selected-meta">#${escapeHtml(selected.numero_empleado)}</div>
    </div>
    <button type="button" class="reg-selected-clear" id="ina-selected-clear" title="Quitar selección" aria-label="Quitar selección">${I.close(14)}</button>
  `;
  selectedBox.classList.remove('hidden');
  document.getElementById('ina-selected-clear').addEventListener('click', () => {
    selected = null;
    renderSelected();
    updateUI();
  });
}

searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  if (searchTimer) clearTimeout(searchTimer);
  if (!q) { clearResults(); return; }
  searchTimer = setTimeout(() => {
    renderResults(filterEmpleados(q));
  }, 100);
});

function pickEmpleadoById(id) {
  selected = activeEmpleados.find((x) => x.id === id) || null;
  searchInput.value = '';
  clearResults();
  renderSelected();
  updateUI();
}

resultsBox.addEventListener('click', (e) => {
  const btn = e.target.closest('button.reg-result-card');
  if (!btn) return;
  pickEmpleadoById(Number(btn.dataset.id));
});

searchInput.addEventListener('keydown', (e) => {
  const open = !resultsBox.classList.contains('hidden');
  const opts = resultsBox.querySelectorAll('button.reg-result-card');
  if (e.key === 'ArrowDown') {
    if (!open || !opts.length) return;
    e.preventDefault();
    setComboActive(inaComboActive < 0 ? 0 : inaComboActive + 1);
  } else if (e.key === 'ArrowUp') {
    if (!open || !opts.length) return;
    e.preventDefault();
    setComboActive(inaComboActive < 0 ? opts.length - 1 : inaComboActive - 1);
  } else if (e.key === 'Enter') {
    if (!open || inaComboActive < 0 || !opts.length) return;
    e.preventDefault();
    pickEmpleadoById(Number(opts[inaComboActive].dataset.id));
  } else if (e.key === 'Escape') {
    if (open) {
      e.preventDefault();
      e.stopPropagation();
      clearResults();
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
  if (!resultsBox.classList.contains('hidden')) {
    if (!e.target.closest('#ina-results') && !e.target.closest('#ina-search')) {
      clearResults();
    }
  }
});

// ── Fechas: default a hoy ─────────────────────────────────────
(function initDates() {
  if (isEdit) return; // se llenarán desde el registro existente
  const t = todayLocalISO();
  fechaIni.value = t;
  fechaFin.value = t;
})();

todayBtn.addEventListener('click', () => {
  const t = todayLocalISO();
  fechaIni.value = t;
  fechaFin.value = t;
});

// ── Evidencia ─────────────────────────────────────────────────
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('No se pudo leer el archivo'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

function showEvidenciaState(text, hasAttachment) {
  evidenciaCurrent.textContent = text;
  evidenciaCurrent.classList.remove('hidden');
  if (hasAttachment) evidenciaClear.classList.remove('hidden');
  else evidenciaClear.classList.add('hidden');
}

function resetEvidenciaState() {
  evidenciaCurrent.classList.add('hidden');
  evidenciaCurrent.textContent = '';
  evidenciaClear.classList.add('hidden');
  evidenciaLabel.textContent = 'Cargar archivo';
}

evidenciaFile.addEventListener('change', async (e) => {
  errorBox.classList.add('hidden');
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const MAX = 5 * 1024 * 1024;
  if (file.size > MAX) {
    showError('El archivo supera el máximo de 5 MB.');
    evidenciaFile.value = '';
    return;
  }
  const mime = (file.type || '').toLowerCase();
  const allowed = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!allowed.includes(mime)) {
    showError('Formato no soportado. Usa PDF, PNG, JPG o WebP.');
    evidenciaFile.value = '';
    return;
  }
  try {
    const dataBase64 = await readFileAsBase64(file);
    evidenciaPending = { name: file.name, mime, dataBase64 };
    showEvidenciaState(`Nuevo adjunto: ${file.name}`, true);
    evidenciaLabel.textContent = 'Cambiar archivo';
  } catch (err) {
    showError(err?.message || 'No se pudo leer el archivo');
    evidenciaFile.value = '';
  }
});

evidenciaClear.addEventListener('click', () => {
  evidenciaFile.value = '';
  if (evidenciaPending && !evidenciaPending.remove) {
    // Era una selección nueva: descartarla y volver al estado actual.
    evidenciaPending = undefined;
    if (currentEvidenciaMeta) {
      showEvidenciaState(`Adjunto actual: ${currentEvidenciaMeta.filename || 'archivo'}`, true);
      evidenciaLabel.textContent = 'Reemplazar archivo';
    } else {
      resetEvidenciaState();
    }
    return;
  }
  if (currentEvidenciaMeta) {
    // Quitar el adjunto existente al guardar.
    evidenciaPending = { remove: true };
    showEvidenciaState('Se quitará el adjunto al guardar.', false);
    evidenciaLabel.textContent = 'Cargar archivo';
  }
});

// ── Habilitar/deshabilitar pasos según selección ─────────────
function updateUI() {
  const hasEmp = !!selected;
  stepPeriodo.classList.toggle('reg-step--disabled', !hasEmp);
  stepMotivo.classList.toggle('reg-step--disabled', !hasEmp);
  stepEvidencia.classList.toggle('reg-step--disabled', !hasEmp);
  submitBtn.disabled = !hasEmp;
}

// ── Error display ─────────────────────────────────────────────
function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.remove('hidden');
  errorBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Cancelar / volver ─────────────────────────────────────────
cancelBtn.addEventListener('click', goBack);
document.getElementById('ina-back').addEventListener('click', goBack);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  // Si hay un modal abierto o el combobox de busqueda esta abierto, no salir
  // de la vista — esos handlers locales gestionan el Esc.
  const hasOpenModal = !!document.querySelector('.modal-backdrop:not(.hidden)');
  if (hasOpenModal) return;
  if (!resultsBox.classList.contains('hidden')) return;
  goBack();
});

// ── Submit ────────────────────────────────────────────────────
submitBtn.addEventListener('click', async () => {
  errorBox.classList.add('hidden');
  if (!selected) { showError('Selecciona un empleado.'); return; }
  if (!fechaIni.value || !fechaFin.value) { showError('Indica el rango de fechas.'); return; }
  if (fechaIni.value > fechaFin.value) { showError('La fecha inicial no puede ser posterior a la final.'); return; }
  if (!motivoSel.value) { showError('Selecciona el motivo.'); return; }
  if (isEdit && !pwInput.value) { showError('Ingresa tu contraseña para confirmar los cambios.'); return; }

  // Resolver evidencia para el payload.
  let evidenciaPayload;
  if (evidenciaPending === undefined) evidenciaPayload = undefined;
  else if (evidenciaPending && evidenciaPending.remove) evidenciaPayload = null;
  else evidenciaPayload = evidenciaPending;

  const payload = {
    empleadoId: selected.id,
    fechaIni: fechaIni.value,
    fechaFin: fechaFin.value,
    motivoTipo: motivoSel.value,
    motivoDetalle: motivoDetalle.value.trim() || null,
  };
  if (!isEdit) {
    if (evidenciaPayload && !evidenciaPayload.remove) payload.evidencia = evidenciaPayload;
  } else if (evidenciaPayload !== undefined) {
    payload.evidencia = evidenciaPayload;
  }

  submitBtn.disabled = true;
  const prevLabel = submitLabel.textContent;
  submitLabel.textContent = isEdit ? 'Guardando…' : 'Creando…';

  const res = isEdit
    ? await window.api.updateInasistencia(editId, payload, pwInput.value)
    : await window.api.createInasistencia(payload);

  submitBtn.disabled = false;
  submitLabel.textContent = prevLabel;

  if (!res?.ok) {
    showError(res?.error || 'No se pudo guardar');
    return;
  }
  goBack();
});

bootstrap();
