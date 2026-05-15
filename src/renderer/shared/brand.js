// Shared brand helper. Reads the company name from the main process and
// applies it across the UI:
//   - [data-brand-name]    : textContent becomes the company name.
//   - [data-brand-initial] : textContent becomes the first letter (uppercase).
//   - document.title       : the segment before " · " is replaced.
// Falls back to 'Onix' when the IPC call fails (e.g. dev/edge cases).
window.EES_BRAND = (() => {
  const DEFAULT = 'Onix';
  let cachedName = null;

  async function fetchName() {
    if (cachedName) return cachedName;
    try {
      const res = await window.api.getCompanyName();
      cachedName = (res?.ok && res.name) ? res.name : DEFAULT;
    } catch {
      cachedName = DEFAULT;
    }
    return cachedName;
  }

  function applyTo(root, name) {
    const initial = (name[0] || 'O').toUpperCase();
    root.querySelectorAll('[data-brand-name]').forEach((el) => {
      el.textContent = name;
    });
    root.querySelectorAll('[data-brand-initial]').forEach((el) => {
      el.textContent = initial;
    });
  }

  function applyToTitle(name) {
    const t = document.title || '';
    if (!t) { document.title = name; return; }
    const parts = t.split(' · ');
    if (parts.length >= 2) {
      parts[0] = name;
      document.title = parts.join(' · ');
    } else {
      document.title = name;
    }
  }

  async function applyAll(opts = {}) {
    if (opts.force) cachedName = null;
    const name = await fetchName();
    applyTo(document, name);
    applyToTitle(name);
    return name;
  }

  function getCachedName() { return cachedName || DEFAULT; }

  return { applyAll, fetchName, getCachedName };
})();

document.addEventListener('DOMContentLoaded', () => {
  // Best-effort: never block render on this.
  window.EES_BRAND.applyAll().catch(() => {});
});
