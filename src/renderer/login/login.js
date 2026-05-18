const I = window.EES_ICONS;

window.api.setView('login');

// ── Icons ──────────────────────────────────────────────────────
document.getElementById('icon-user').innerHTML = I.user(16);
document.getElementById('icon-lock').innerHTML = I.lock(16);

// ── Clock ──────────────────────────────────────────────────────
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
function pad(n) { return String(n).padStart(2, '0'); }
function tickClock() {
  const now = new Date();
  const h24 = now.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ampm = h24 < 12 ? 'a.m.' : 'p.m.';
  document.getElementById('clock-hh').textContent = pad(h12);
  document.getElementById('clock-mm').textContent = pad(now.getMinutes());
  document.getElementById('clock-ss').textContent = pad(now.getSeconds());
  document.getElementById('clock-ampm').textContent = ampm;
  document.getElementById('clock-date').textContent =
    `${DAYS[now.getDay()]}, ${now.getDate()} de ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}
tickClock();
setInterval(tickClock, 1000);

// ── Prefill last logged-in user + apply their theme ────────────
window.api.getLastUser().then((last) => {
  if (!last) return;
  window.EES_THEME.applyFromUser(last);
  document.getElementById('username').value = last.username;
  document.getElementById('password').focus();
  syncSubmit();
});

// ── Eye toggle ─────────────────────────────────────────────────
const passInput = document.getElementById('password');
const eyeBtn = document.getElementById('eye-btn');
let pwVisible = false;
function renderEye() {
  eyeBtn.innerHTML = pwVisible ? I.eyeOff(17) : I.eye(17);
  eyeBtn.setAttribute('aria-label', pwVisible ? 'Ocultar contraseña' : 'Mostrar contraseña');
  eyeBtn.setAttribute('aria-pressed', pwVisible ? 'true' : 'false');
  passInput.type = pwVisible ? 'text' : 'password';
}
eyeBtn.addEventListener('mousedown', (e) => e.preventDefault());
eyeBtn.addEventListener('click', () => { pwVisible = !pwVisible; renderEye(); });
renderEye();

// ── Caps lock detection ────────────────────────────────────────
const capsHint = document.getElementById('caps-hint');
function updateCaps(e) {
  if (typeof e.getModifierState === 'function') {
    const on = e.getModifierState('CapsLock');
    if (on) {
      capsHint.innerHTML = `${I.caps(14)} <span>Bloq Mayús está activado.</span>`;
      capsHint.classList.remove('hidden');
    } else {
      capsHint.classList.add('hidden');
    }
  }
}
passInput.addEventListener('keydown', updateCaps);
passInput.addEventListener('keyup', updateCaps);

// ── Submit state ───────────────────────────────────────────────
const form = document.getElementById('login-form');
const submitBtn = document.getElementById('submit-btn');
const submitContent = document.getElementById('submit-content');
const usernameInput = document.getElementById('username');
const passError = document.getElementById('pass-error');
const passShell = document.getElementById('pass-shell');
const passLabel = document.getElementById('pass-label');

function syncSubmit() {
  const canSubmit = usernameInput.value.trim().length >= 2 && passInput.value.length >= 1;
  submitBtn.disabled = !canSubmit;
}
usernameInput.addEventListener('input', syncSubmit);
passInput.addEventListener('input', syncSubmit);
syncSubmit();

function clearError() {
  passError.classList.add('hidden');
  passError.innerHTML = '';
  passShell.classList.remove('is-error');
  passLabel.classList.remove('is-error');
}
function showError(msg) {
  passError.innerHTML = `${I.alert(13)} <span>${msg}</span>`;
  passError.classList.remove('hidden');
  passShell.classList.add('is-error');
  passLabel.classList.add('is-error');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();

  const username = usernameInput.value.trim();
  const password = passInput.value;
  if (!username || !password) { showError('Ingresa usuario y contraseña.'); return; }

  submitBtn.disabled = true;
  submitContent.innerHTML = `${I.spinner(16)}<span>Verificando…</span>`;

  const res = await window.api.login(username, password);

  if (!res.ok) {
    submitContent.textContent = 'Iniciar sesión';
    showError(res.error || 'Credenciales inválidas.');
    passInput.value = '';
    syncSubmit();
    return;
  }

  window.location.href = '../dashboard/dashboard.html';
});
