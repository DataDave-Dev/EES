// Toast no bloqueante. Reemplaza a window.alert() para feedback de UX.
// Uso: EES_TOAST.error('mensaje'), EES_TOAST.success(...), EES_TOAST.info(...).

(function () {
  const CONTAINER_ID = 'ees-toast-container';
  const DEFAULT_DURATION = 4500;

  function ensureContainer() {
    let c = document.getElementById(CONTAINER_ID);
    if (!c) {
      c = document.createElement('div');
      c.id = CONTAINER_ID;
      c.className = 'toast-container';
      c.setAttribute('aria-live', 'polite');
      c.setAttribute('aria-atomic', 'false');
      document.body.appendChild(c);
    }
    return c;
  }

  function show(message, variant, duration) {
    const container = ensureContainer();
    const el = document.createElement('div');
    el.className = `toast toast--${variant}`;
    el.setAttribute('role', variant === 'error' ? 'alert' : 'status');
    el.textContent = String(message ?? '');
    container.appendChild(el);

    const dur = Number.isFinite(duration) ? duration : DEFAULT_DURATION;
    const timer = setTimeout(dismiss, dur);
    function dismiss() {
      clearTimeout(timer);
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 200);
    }
    el.addEventListener('click', dismiss);
    return dismiss;
  }

  window.EES_TOAST = {
    error: (msg, dur) => show(msg, 'error', dur),
    success: (msg, dur) => show(msg, 'success', dur),
    info: (msg, dur) => show(msg, 'info', dur),
  };
})();
