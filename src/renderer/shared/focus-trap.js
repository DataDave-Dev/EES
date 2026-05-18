// Focus trap utility for modal dialogs.
//
// Uso:
//   const release = EES_FOCUS_TRAP.trap(modalEl);
//   // ...al cerrar el modal:
//   release();
//
// Caracteristicas:
// - Tab y Shift+Tab circulan dentro del modal (no se sale al fondo de la app).
// - Si no hay elementos focusables, el foco queda en el contenedor del modal.
// - Esta diseniado para usarse junto con rememberFocus/restoreFocus existentes
//   (no restaura el foco — eso lo hace el caller).
window.EES_FOCUS_TRAP = (() => {
  const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  function getFocusable(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((el) => {
        if (el.hasAttribute('aria-hidden') && el.getAttribute('aria-hidden') === 'true') return false;
        // descartar elementos invisibles (display:none, visibility:hidden)
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
      });
  }

  function trap(modalEl) {
    if (!modalEl) return () => {};

    function onKeyDown(e) {
      if (e.key !== 'Tab') return;
      const focusables = getFocusable(modalEl);
      if (focusables.length === 0) {
        e.preventDefault();
        modalEl.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !modalEl.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !modalEl.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    modalEl.addEventListener('keydown', onKeyDown);

    return function release() {
      modalEl.removeEventListener('keydown', onKeyDown);
    };
  }

  return { trap };
})();
