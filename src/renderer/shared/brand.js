// Shared brand helper. Reads the company name + optional logo from the main
// process and applies them across the UI:
//   - [data-brand-name]    : textContent becomes the company name.
//   - [data-brand-initial] : becomes the company logo image when one exists,
//                            otherwise textContent becomes the first letter.
//   - document.title       : the segment before " · " is replaced.
// Falls back to 'Onix' / letter when IPC fails or no logo is configured.
window.EES_BRAND = (() => {
  const DEFAULT = 'Onix';
  let cachedName = null;
  let cachedLogoUrl = null;
  let cachedLogoFetched = false;

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

  async function fetchLogoUrl() {
    if (cachedLogoFetched) return cachedLogoUrl;
    try {
      const res = await window.api.getCompanyLogo();
      cachedLogoUrl = (res?.ok && res.dataUrl) ? res.dataUrl : null;
    } catch {
      cachedLogoUrl = null;
    }
    cachedLogoFetched = true;
    return cachedLogoUrl;
  }

  function applyNames(root, name) {
    root.querySelectorAll('[data-brand-name]').forEach((el) => {
      el.textContent = name;
    });
  }

  function applyInitials(root, name, logoUrl) {
    const initial = (name[0] || 'O').toUpperCase();
    root.querySelectorAll('[data-brand-initial]').forEach((el) => {
      // Remove any prior injected <img>
      el.querySelectorAll(':scope > .brand-logo-img').forEach((n) => n.remove());
      if (logoUrl) {
        el.classList.add('has-logo');
        el.textContent = '';
        const img = document.createElement('img');
        img.className = 'brand-logo-img';
        img.src = logoUrl;
        img.alt = name;
        img.draggable = false;
        el.appendChild(img);
      } else {
        el.classList.remove('has-logo');
        el.textContent = initial;
      }
    });
  }

  function applyTitle(name) {
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
    if (opts.force) {
      cachedName = null;
      cachedLogoUrl = null;
      cachedLogoFetched = false;
    }
    const name = await fetchName();
    const logoUrl = await fetchLogoUrl();
    applyNames(document, name);
    applyInitials(document, name, logoUrl);
    applyTitle(name);
    return { name, logoUrl };
  }

  function getCachedName() { return cachedName || DEFAULT; }
  function getCachedLogoUrl() { return cachedLogoUrl; }

  return { applyAll, fetchName, fetchLogoUrl, getCachedName, getCachedLogoUrl };
})();

document.addEventListener('DOMContentLoaded', () => {
  window.EES_BRAND.applyAll().catch(() => {});
});
