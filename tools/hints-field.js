/* KeePass Helper — preserve the page field while inline search owns focus. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  else {
    root.__kpHintsField = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const takeHintField = (root, document) => {
    const saved = root?.__kpHintsActiveField;
    if (root) root.__kpHintsActiveField = null;
    if (
      saved?.tagName === 'INPUT' &&
      saved.ownerDocument === document &&
      saved.isConnected !== false
    ) {
      return saved;
    }
    return document?.activeElement || null;
  };

  return {takeHintField};
});
