/* Track save requests and preserve fields the user actually edited. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__kpSaveState = api;
})(typeof self !== 'undefined' ? self : globalThis, function() {
  const create = () => {
    let revision = -1;
    let phase = '';
    const dirty = new Set();
    return {
      edit: name => dirty.add(name),
      canFill: name => !dirty.has(name),
      accept(payload) {
        if (!payload || !Number.isFinite(payload.revision) || payload.revision < revision) return null;
        const reset = payload.revision > revision;
        if (reset) {
          revision = payload.revision;
          phase = '';
          dirty.clear();
        }
        const next = payload.pending ? 'pending' : payload.error ? 'error' : 'ready';
        if (next === phase || (phase && phase !== 'pending' && next === 'pending')) return null;
        phase = next;
        return {reset, phase};
      }
    };
  };
  return {create};
});
