/* KeePass Helper — stable, site-scoped keys for fields the user marked as
 * "not a login field". Pure UMD module so key generation can be unit-tested. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  else {
    root.__kpIgnoredFields = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const STORAGE_KEY = 'hintsIgnoredFields';
  const MAX_IGNORED_FIELDS = 500;

  const normalize = value => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '#')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ');

  const normalizeClassName = value => [...new Set(normalize(value)
    .split(' ')
    .filter(Boolean)
    .filter(token => !/(?:^|[-_])(focus|focused|active|invalid|hover)(?:[-_]|$)/.test(token)))]
    .sort()
    .join(' ');

  const ignoredFieldKey = (el, origin) => {
    if (!el || el.tagName !== 'INPUT' || !origin) return '';

    const type = normalize(el.type || 'text');
    const attributes = {
      id: normalize(el.id),
      name: normalize(el.name),
      placeholder: normalize(el.getAttribute?.('placeholder')),
      'aria-label': normalize(el.getAttribute?.('aria-label'))
    };
    const primary = ['id', 'name', 'placeholder', 'aria-label']
      .find(kind => attributes[kind]);

    if (primary) {
      // Keep the strongest available identity first, then add other local
      // attributes to avoid suppressing every generic `name="email"` field on
      // a site after the user rejected only a contact/search field.
      const identity = [primary, attributes[primary]];
      for (const kind of ['id', 'name', 'placeholder', 'aria-label']) {
        if (kind !== primary && attributes[kind]) identity.push(kind, attributes[kind]);
      }
      return JSON.stringify([normalize(origin), type, ...identity]);
    }

    // Last-resort identity for unlabeled OTP widgets. It is intentionally
    // site-scoped; matching all equivalent cells of one OTP widget is useful.
    return JSON.stringify([
      normalize(origin),
      type,
      'fallback',
      normalize(el.getAttribute?.('autocomplete')),
      normalize(el.getAttribute?.('inputmode')),
      normalize(el.getAttribute?.('pattern')),
      normalizeClassName(el.className)
    ]);
  };

  return {
    STORAGE_KEY,
    MAX_IGNORED_FIELDS,
    normalize,
    normalizeClassName,
    ignoredFieldKey
  };
});
