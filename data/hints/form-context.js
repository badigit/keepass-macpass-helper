/* KeePass Helper — form-scoping and login inference.
 *
 * Pure logic: given a field and access to its DOM neighbors, infer which login
 * the user has been typing into the form so that password-field hints can be
 * ranked by relevance. Loaded as a content script after heuristics.js and also
 * require()-d from tests/.
 */
(function (root, factory) {
  const api = factory(root && root.__kpHints);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  else {
    root.__kpFormContext = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function (heuristics) {
  // In Node tests we get heuristics via require(); in the browser via __kpHints.
  const h = heuristics || require('./heuristics.js');

  const FORM_LOOKUP_DEPTH = 10;
  const TEXT_LIKE_TYPES = new Set(['text', 'email', 'tel', '']);

  const normalizeLogin = value => String(value || '').trim().toLowerCase();

  /* Find the smallest ancestor that holds either a password input or a
   * text-like input — i.e. the actual form regardless of <form> markup. Stops
   * at document.body and crosses one shadow boundary when walking up. */
  const formContextRoot = el => {
    if (!el) return (typeof document !== 'undefined' ? document.body : null);
    const closestForm = el.closest?.('form');
    if (closestForm) return closestForm;

    let parent = el;
    for (let i = 0; i < FORM_LOOKUP_DEPTH; i += 1) {
      if (parent.parentElement) {
        parent = parent.parentElement;
      }
      else {
        const rootNode = parent.getRootNode?.();
        if (typeof ShadowRoot !== 'undefined' && rootNode instanceof ShadowRoot && rootNode.host) {
          parent = rootNode.host;
        }
      }

      if (!parent) break;
      const hasPassword = parent.querySelector?.('input[type=password]');
      const hasTextLike = parent.querySelector?.('input[type=text],input[type=email],input[type=tel],input:not([type])');
      if (hasPassword || hasTextLike) {
        return parent;
      }
    }
    return (typeof document !== 'undefined' ? document.body : null);
  };

  const createFormStateStore = () => {
    // WeakMap is fine in both environments; falls back to Map keyed by id in
    // pathological cases (the keys here are DOM nodes so this is unreachable).
    return typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();
  };

  const getFormState = (store, el) => {
    const node = formContextRoot(el);
    if (!node) return {};
    let state = store.get(node);
    if (!state) {
      state = {};
      store.set(node, state);
    }
    return state;
  };

  const rememberLoginForField = (store, el, login) => {
    const normalized = normalizeLogin(login);
    if (!normalized) return;
    getFormState(store, el).preferredLogin = normalized;
  };

  const inferLoginFromForm = (store, el) => {
    const state = getFormState(store, el);
    if (state.preferredLogin) return state.preferredLogin;

    const node = formContextRoot(el);
    if (!node) return '';
    const inputs = [...(node.querySelectorAll?.('input') || [])]
      .filter(input => input !== el && input.offsetParent);
    const userField = inputs.find(input => {
      const type = (input.type || '').toLowerCase();
      if (!TEXT_LIKE_TYPES.has(type)) return false;
      return h.isLoginField(input) && !h.isPasswordField(input) && !h.isOTPField(input);
    });

    const value = normalizeLogin(userField?.value);
    if (value) {
      state.preferredLogin = value;
      return value;
    }
    return '';
  };

  /* When the active field is a password input, rank entries so the one whose
   * Login matches what the user has typed into the username field comes first.
   * Exact match wins, then prefix overlap, then any substring overlap. */
  const sortedEntriesForField = (items, el, store) => {
    if (!h.isPasswordField(el)) return items.slice();
    const preferred = inferLoginFromForm(store, el);
    if (!preferred) return items.slice();

    return items
      .map((entry, index) => {
        const login = normalizeLogin(entry.Login);
        let score = 0;
        if (login === preferred) score = 3;
        else if (login && (login.startsWith(preferred) || preferred.startsWith(login))) score = 2;
        else if (login && (login.includes(preferred) || preferred.includes(login))) score = 1;
        return {entry, index, score};
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(item => item.entry);
  };

  return {
    normalizeLogin,
    formContextRoot,
    createFormStateStore,
    rememberLoginForField,
    inferLoginFromForm,
    sortedEntriesForField
  };
});
