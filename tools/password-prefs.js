/* Shared generator preferences for options, save panel and worker. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__kpPasswordPrefs = api;
})(typeof self !== 'undefined' ? self : globalThis, function() {
  const key = 'kp-password-generator-prefs';
  const defaults = {
    mode: 'diceware',
    diceware: {wordCount: 5, separator: '-', capitalize: true, appendDigits: 1, appendSymbols: 1},
    charset: {
      charset1: 'qwertyuioplkjhgfdsazxcvbnmQWERTYUIOPLKJHGFDSAZXCVBNM1234567890',
      charset2: '!@#$%^&*()-_+=', length1: 14, length2: 3
    }
  };
  const count = (value, fallback, maximum, minimum = 0) => {
    const number = value === '' || value == null ? fallback : Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, Math.trunc(number))) : fallback;
  };
  const normalize = prefs => {
    const diceware = prefs?.diceware || {};
    const charset = prefs?.charset || {};
    return {
      mode: prefs?.mode === 'charset' ? 'charset' : 'diceware',
      diceware: {
        wordCount: count(diceware.wordCount, defaults.diceware.wordCount, 12, 3),
        separator: typeof diceware.separator === 'string' ? diceware.separator : defaults.diceware.separator,
        capitalize: typeof diceware.capitalize === 'boolean' ? diceware.capitalize : defaults.diceware.capitalize,
        appendDigits: count(diceware.appendDigits, defaults.diceware.appendDigits, 6),
        appendSymbols: count(diceware.appendSymbols, defaults.diceware.appendSymbols, 6)
      },
      charset: {
        charset1: typeof charset.charset1 === 'string' ? charset.charset1 : defaults.charset.charset1,
        charset2: typeof charset.charset2 === 'string' ? charset.charset2 : defaults.charset.charset2,
        length1: count(charset.length1, defaults.charset.length1, 64),
        length2: count(charset.length2, defaults.charset.length2, 16)
      }
    };
  };
  const load = async storage => {
    const stored = await storage.get([key, 'charset-1', 'charset-2', 'length-1', 'length-2']);
    const legacy = ['charset-1', 'charset-2', 'length-1', 'length-2'].some(name => stored[name] !== undefined);
    const prefs = normalize(stored[key] || (legacy ? {mode: 'charset'} : null));
    for (const [oldName, name] of [['charset-1', 'charset1'], ['charset-2', 'charset2'], ['length-1', 'length1'], ['length-2', 'length2']]) {
      if (stored[key]?.charset?.[name] === undefined && stored[oldName] !== undefined) {
        prefs.charset[name] = stored[oldName];
      }
    }
    const normalized = normalize(prefs);
    if (legacy) {
      await storage.set({[key]: normalized});
      await storage.remove(['charset-1', 'charset-2', 'length-1', 'length-2']);
    }
    return normalized;
  };
  return {key, defaults, normalize, load};
});
