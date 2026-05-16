// Formato unificado de horas para toda la UI.
//
// Decision: usar formato 12h con periodo en minusculas y puntos juntos
// ("a.m." / "p.m.") en vez de lo que devuelve toLocaleTimeString('es-MX')
// que produce "a. m." con espacios raros y se ve mal en reportes.

(function () {
  function parseToDate(iso) {
    if (!iso) return null;
    if (iso instanceof Date) return iso;
    const s = String(iso);
    // SQLite/SQL strings vienen como "YYYY-MM-DD HH:MM:SS"; los tratamos
    // como UTC para que se conviertan a la zona local del usuario.
    const utcIso = s.includes('T') ? s : s.replace(' ', 'T') + 'Z';
    const d = new Date(utcIso);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function periodOf(h) {
    return h >= 12 ? 'p.m.' : 'a.m.';
  }
  function h12(h) {
    const x = h % 12;
    return x === 0 ? 12 : x;
  }
  function mm(n) {
    return String(n).padStart(2, '0');
  }

  // "2:30 p.m."
  function fmtTime12(input) {
    const d = parseToDate(input);
    if (!d) return '—';
    return `${h12(d.getHours())}:${mm(d.getMinutes())} ${periodOf(d.getHours())}`;
  }

  // "2:30:45 p.m." (para relojes y auditoria)
  function fmtClockSeconds(input) {
    const d = parseToDate(input);
    if (!d) return '—';
    return `${h12(d.getHours())}:${mm(d.getMinutes())}:${mm(d.getSeconds())} ${periodOf(d.getHours())}`;
  }

  // "2 may 2026, 2:30 p.m."
  function fmtDateTime12(input) {
    const d = parseToDate(input);
    if (!d) return '—';
    const date = d.toLocaleDateString('es-MX', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
    return `${date}, ${h12(d.getHours())}:${mm(d.getMinutes())} ${periodOf(d.getHours())}`;
  }

  // "2 may 2026, 2:30:45 p.m." (para auditoria con segundos)
  function fmtDateTime12Seconds(input) {
    const d = parseToDate(input);
    if (!d) return '—';
    const date = d.toLocaleDateString('es-MX', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
    return `${date}, ${h12(d.getHours())}:${mm(d.getMinutes())}:${mm(d.getSeconds())} ${periodOf(d.getHours())}`;
  }

  window.EES_TIME = {
    fmtTime12,
    fmtClockSeconds,
    fmtDateTime12,
    fmtDateTime12Seconds,
    periodOf,
  };
})();
