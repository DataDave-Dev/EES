const I = window.EES_ICONS;

window.api.setView('setup');

// ── Icons ──────────────────────────────────────────────────────
document.getElementById('icon-user').innerHTML = I.user(16);
document.getElementById('icon-lock1').innerHTML = I.lock(16);
document.getElementById('icon-lock2').innerHTML = I.lock(16);
document.getElementById('done-check').innerHTML = I.check(32);

// ── Refs ───────────────────────────────────────────────────────
const nombreEl = document.getElementById('nombre');
const apellidosEl = document.getElementById('apellidos');
const userEl = document.getElementById('username');
const passEl = document.getElementById('password');
const pass2El = document.getElementById('password2');
const eyeBtn = document.getElementById('eye-btn');
const pass2Error = document.getElementById('pass2-error');
const pass2Shell = document.getElementById('pass2-shell');
const pass2Label = document.getElementById('pass2-label');

const backBtn = document.getElementById('back-btn');
const nextBtn = document.getElementById('next-btn');
const nextContent = document.getElementById('next-content');
const errorBox = document.getElementById('error');
const stepEls = document.querySelectorAll('.wizard-step');
const stepDots = document.querySelectorAll('#step-bar .step');
const stepLines = document.querySelectorAll('#step-bar .step-line');

// ── State ──────────────────────────────────────────────────────
let step = 0;
let pwVisible = false;
let isSubmitting = false;

// ── Validation ─────────────────────────────────────────────────
function accountOk() {
  return !!(nombreEl.value.trim() && apellidosEl.value.trim() && userEl.value.trim().length >= 2);
}
function securityOk() {
  return window.EES_PASSWORD.check(passEl.value).ok && passEl.value === pass2El.value;
}
function canAdvance() {
  if (step === 0) return true;
  if (step === 1) return accountOk();
  if (step === 2) return securityOk() && !isSubmitting;
  return true;
}

// ── Stepper render ─────────────────────────────────────────────
function renderStepper() {
  stepDots.forEach((el, i) => {
    el.classList.toggle('is-done', i < step);
    el.classList.toggle('is-current', i === step);
    if (i === step) el.setAttribute('aria-current', 'step');
    else el.removeAttribute('aria-current');
    const dot = el.querySelector('.step-dot');
    if (i < step) dot.innerHTML = I.check(12);
    else if (i === step) dot.textContent = String(i + 1);
    else dot.textContent = '';
  });
  stepLines.forEach((el, i) => {
    el.classList.toggle('is-filled', i < step);
  });
}

// ── Step display ───────────────────────────────────────────────
function showStep(next) {
  step = next;
  stepEls.forEach((el) => {
    const i = Number(el.dataset.step);
    el.classList.toggle('is-active', i === step);
  });
  renderStepper();
  syncFooter();
  clearError();

  setTimeout(() => {
    if (step === 1) nombreEl.focus();
    else if (step === 2) passEl.focus();
    else nextBtn.focus();
  }, 60);
}

// ── Footer ─────────────────────────────────────────────────────
function syncFooter() {
  backBtn.style.visibility = (step > 0 && step < 3) ? 'visible' : 'hidden';
  let label;
  if (step === 0) label = 'Comenzar';
  else if (step === 1) label = 'Continuar';
  else if (step === 2) label = isSubmitting
    ? `${I.spinner(16)}<span>Creando…</span>`
    : 'Crear administrador';
  else label = 'Ir al login';
  nextContent.innerHTML = label;
  nextBtn.disabled = !canAdvance();
}

// ── Errors ─────────────────────────────────────────────────────
function showError(msg) {
  errorBox.innerHTML = `${I.alert(13)} <span>${msg}</span>`;
  errorBox.classList.remove('hidden');
}
function clearError() {
  errorBox.classList.add('hidden');
  errorBox.innerHTML = '';
}
function setPass2Error(msg) {
  if (msg) {
    pass2Error.innerHTML = `${I.alert(13)} <span>${msg}</span>`;
    pass2Error.classList.remove('hidden');
    pass2Shell.classList.add('is-error');
    pass2Label.classList.add('is-error');
  } else {
    pass2Error.classList.add('hidden');
    pass2Error.innerHTML = '';
    pass2Shell.classList.remove('is-error');
    pass2Label.classList.remove('is-error');
  }
}

// ── Password strength ──────────────────────────────────────────
// Driven by EES_PASSWORD rules so the meter agrees with the gate:
// segments = rules passed (max 4 shown, 5th = "excelente" coloring).
function scorePassword(pw) {
  if (!pw) return { passed: 0, label: '—', color: 'var(--muted)' };
  const passed = window.EES_PASSWORD.check(pw).rules.filter((r) => r.ok).length;
  const labels = ['débil', 'débil', 'aceptable', 'fuerte', 'casi', 'excelente'];
  const colors = ['#e5484d', '#e5484d', '#f3bc4b', '#3b82f6', '#3b82f6', '#16a34a'];
  return { passed, label: labels[passed], color: colors[passed] };
}
function renderStrength() {
  const { passed, label, color } = scorePassword(passEl.value);
  document.querySelectorAll('.strength-seg').forEach((seg, i) => {
    // 4 segments. Fill one per rule passed, capped at 4. All 5 rules → all green.
    if (passEl.value && i < passed) {
      seg.style.background = color;
    } else {
      seg.style.background = '';
    }
  });
  const lbl = document.getElementById('strength-label');
  lbl.textContent = label;
  lbl.style.color = passEl.value ? color : '';
}

// ── Eye toggle ─────────────────────────────────────────────────
function renderEye() {
  eyeBtn.innerHTML = pwVisible ? I.eyeOff(17) : I.eye(17);
  eyeBtn.setAttribute('aria-label', pwVisible ? 'Ocultar contraseña' : 'Mostrar contraseña');
  eyeBtn.setAttribute('aria-pressed', pwVisible ? 'true' : 'false');
  passEl.type = pwVisible ? 'text' : 'password';
  pass2El.type = pwVisible ? 'text' : 'password';
}
eyeBtn.addEventListener('mousedown', (e) => e.preventDefault());
eyeBtn.addEventListener('click', () => { pwVisible = !pwVisible; renderEye(); });
renderEye();

// ── Listeners ──────────────────────────────────────────────────
[nombreEl, apellidosEl, userEl].forEach((el) =>
  el.addEventListener('input', syncFooter)
);
passEl.addEventListener('input', () => {
  renderStrength();
  if (pass2El.value && passEl.value !== pass2El.value) setPass2Error('No coincide.');
  else setPass2Error('');
  syncFooter();
});
pass2El.addEventListener('input', () => {
  if (pass2El.value && passEl.value !== pass2El.value) setPass2Error('No coincide.');
  else setPass2Error('');
  syncFooter();
});

document.getElementById('setup-form').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleNext();
  }
});

// ── Submit ─────────────────────────────────────────────────────
async function submitUser() {
  if (isSubmitting) return;
  clearError();
  const nombre = nombreEl.value.trim();
  const apellidos = apellidosEl.value.trim();
  const username = userEl.value.trim();
  const password = passEl.value;

  if (!nombre || !apellidos || !username || !password) {
    showError('Todos los campos son obligatorios.');
    return;
  }
  const pw = window.EES_PASSWORD.check(password);
  if (!pw.ok) {
    showError(pw.firstError);
    return;
  }
  if (password !== pass2El.value) {
    showError('Las contraseñas no coinciden.');
    return;
  }

  isSubmitting = true;
  syncFooter();
  backBtn.disabled = true;

  const res = await window.api.createInitialUser({ nombre, apellidos, username, password });

  isSubmitting = false;
  backBtn.disabled = false;

  if (!res.ok) {
    showError(res.error || 'No se pudo crear el usuario.');
    syncFooter();
    return;
  }

  document.getElementById('done-user').textContent = username;
  showStep(3);
}

// ── Nav ────────────────────────────────────────────────────────
function handleNext() {
  if (step === 2) { submitUser(); return; }
  if (step === 3) { window.location.href = '../login/login.html'; return; }
  if (!canAdvance()) return;
  showStep(step + 1);
}
function handleBack() {
  if (step === 0 || isSubmitting) return;
  showStep(step - 1);
}
nextBtn.addEventListener('click', (e) => { e.preventDefault(); handleNext(); });
backBtn.addEventListener('click', (e) => { e.preventDefault(); handleBack(); });

stepDots.forEach((el) => {
  el.addEventListener('click', () => {
    const target = Number(el.dataset.step);
    if (target < step && !isSubmitting) showStep(target);
  });
});

// ── Init ───────────────────────────────────────────────────────
renderStepper();
renderStrength();
syncFooter();
