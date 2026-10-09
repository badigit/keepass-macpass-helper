/* KeePass Helper — trusted executeScript target for a content-script sender. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  else {
    root.__kpHintsTarget = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const senderScriptTarget = sender => {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) return null;
    const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
    return {tabId, frameIds: [frameId]};
  };

  return {senderScriptTarget};
});
