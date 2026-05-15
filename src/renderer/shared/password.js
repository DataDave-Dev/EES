window.EES_PASSWORD = (() => {
  const RULES = [
    { key: 'length', label: 'Al menos 8 caracteres',     test: (p) => p.length >= 8 },
    { key: 'upper',  label: 'Una letra mayúscula',       test: (p) => /[A-Z]/.test(p) },
    { key: 'lower',  label: 'Una letra minúscula',       test: (p) => /[a-z]/.test(p) },
    { key: 'digit',  label: 'Un número',                 test: (p) => /\d/.test(p) },
    { key: 'symbol', label: 'Un símbolo (! @ # $ …)',    test: (p) => /[^A-Za-z0-9]/.test(p) },
  ];

  function check(pw) {
    const p = String(pw ?? '');
    const results = RULES.map((r) => ({ key: r.key, label: r.label, ok: r.test(p) }));
    return {
      rules: results,
      ok: results.every((r) => r.ok),
      firstError: results.find((r) => !r.ok)?.label || null,
    };
  }

  return { RULES, check };
})();
