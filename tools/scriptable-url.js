(function(root) {
  'use strict';

  const RESTRICTED_URL_RE = /^(chrome|edge|about|view-source|chrome-extension|moz-extension|chrome-search|chrome-devtools|devtools):|^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)(\/|$)/i;
  const isScriptableUrl = url => typeof url === 'string' && url.length > 0 && !RESTRICTED_URL_RE.test(url);

  const api = {isScriptableUrl};
  root.__kpScriptableUrl = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
