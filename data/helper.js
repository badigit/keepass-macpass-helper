// Extend the Element prototype with a new method
Document.prototype.extendedQuerySelectorAll = Element.prototype.extendedQuerySelectorAll = function(q) {
  const found = [];

  const traverse = node => {
    // Add elements matching the query to the found array
    found.push(...node.querySelectorAll(q));

    // Traverse all elements in the current node
    for (const e of node.querySelectorAll('*')) {
      // If the element has a shadow root, traverse it as well
      if (e.shadowRoot) {
        try {
          traverse(e.shadowRoot);
        }
        catch (e) {}
      }
    }
  };
  traverse(this);
  return found;
};

// detect the parent form element from a query
self.detectForm = function(e, query = '[type=password]') {
  const form = e.closest('form');

  if (form) {
    return form;
  }
  // what if there is no form element
  let parent = e;
  for (let i = 0; i < 10; i += 1) {
    if (parent.parentElement) {
      parent = parent.parentElement;
    }
    else {
      if (parent.getRootNode() instanceof ShadowRoot) {
        parent = parent.getRootNode().host;
      }
    }

    if (parent.extendedQuerySelectorAll(query).length) {
      return parent;
    }
  }
  return parent;
};

// Reliably set an input value across React/Vue controlled inputs and plain forms.
self.setInputValue = function(el, value) {
  if (!el) return;
  el.focus();

  const setNative = v => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, v);
    }
    else {
      el.value = v;
    }
  };

  // Primary path for React/Vue controlled inputs.
  try { setNative(value); }
  catch (e) {
    try { el.value = value; }
    catch (ex) {}
  }

  try {
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: String(value),
      inputType: 'insertReplacementText'
    }));
  }
  catch (e) {
    el.dispatchEvent(new Event('input', {bubbles: true}));
  }
  el.dispatchEvent(new Event('change', {bubbles: true}));

  // Fallback if value still did not stick.
  if (el.value !== value) {
    try { document.execCommand('selectAll', false, ''); }
    catch (e) {}
    let ok = false;
    try { ok = document.execCommand('insertText', false, value); }
    catch (e) {}
    if (!ok) {
      try { setNative(value); }
      catch (e) {
        try { el.value = value; }
        catch (ex) {}
      }
    }
    el.dispatchEvent(new Event('input', {bubbles: true}));
    el.dispatchEvent(new Event('change', {bubbles: true}));
  }
};

// eslint-disable-next-line eol-last, semi
''
