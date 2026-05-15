(function () {
  // Theme is per-user, persisted in SQLite. Pre-login (login/setup) we render
  // with DEFAULTS — there's no user yet. After login the dashboard fetches the
  // user's saved theme/accent and calls applyFromUser().

  const ACCENTS = {
    terracota: '#d97757',
    azul: '#4a7cf7',
    verde: '#2ea66c',
    violeta: '#8b5cf6',
  };

  const DEFAULTS = {
    theme: 'claro',
    accent: 'terracota',
  };

  function isHex(value) {
    return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
  }

  function accentHex(value) {
    if (isHex(value)) return value;
    return ACCENTS[value] || ACCENTS.terracota;
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function apply(settings) {
    const s = settings || DEFAULTS;
    const root = document.documentElement;

    root.setAttribute('data-theme', s.theme === 'oscuro' ? 'dark' : 'light');

    const hex = accentHex(s.accent);
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-soft', hexToRgba(hex, 0.15));
    root.style.setProperty('--accent-ring', hexToRgba(hex, 0.25));
  }

  function applyFromUser(user) {
    if (!user) return apply(DEFAULTS);
    apply({
      theme: user.theme || DEFAULTS.theme,
      accent: user.accent || DEFAULTS.accent,
    });
  }

  // Save partial settings via IPC, then apply locally for instant feedback.
  // Returns the updated user (or null on failure).
  async function persist(partial) {
    if (!window.api || typeof window.api.setSettings !== 'function') {
      apply({ ...DEFAULTS, ...partial });
      return null;
    }
    const res = await window.api.setSettings(partial);
    if (res?.ok && res.user) {
      applyFromUser(res.user);
      return res.user;
    }
    return null;
  }

  window.EES_THEME = {
    ACCENTS,
    DEFAULTS,
    apply,
    applyFromUser,
    persist,
    accentHex,
    isHex,
  };

  // Render defaults immediately so login/setup don't flash.
  apply(DEFAULTS);
})();
