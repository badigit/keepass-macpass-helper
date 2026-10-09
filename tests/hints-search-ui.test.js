const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the real content script with a small DOM and a mocked extension bridge.
function setup(initialEntries) {
  let focused;
  let pendingTimer;
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.listeners = {};
      this.attributes = {};
      this.value = '';
      this.isConnected = true;
      this.classList = {
        add() {}, remove() {}, contains() { return false; }
      };
    }
    set innerHTML(value) { this.children = []; }
    appendChild(child) { this.children.push(child); return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    attachShadow() { this.shadow = new Element('shadow'); return this.shadow; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    setAttribute(key, value) { this.attributes[key] = value; }
    focus() { focused = this; }
    setSelectionRange() {}
    getBoundingClientRect() { return {left: 20, bottom: 60, width: 300}; }
    querySelector(selector) {
      if (selector === '.kp-search input') return find(this, el => el.type === 'search');
      return null;
    }
  }
  function find(root, predicate) {
    if (predicate(root)) return root;
    for (const child of root.children) {
      const match = find(child, predicate);
      if (match) return match;
    }
  }
  const document = new Element('document');
  document.documentElement = new Element('html');
  document.createElement = tag => new Element(tag);
  document.querySelectorAll = () => [];
  const field = new Element('input');
  const calls = [];
  const context = {
    document,
    location: {href: 'https://example.test/login', origin: 'https://example.test'},
    window: {innerWidth: 1000, addEventListener() {}},
    setTimeout: callback => { pendingTimer = callback; return 1; }, clearTimeout() {},
    chrome: {
      i18n: {getMessage: () => ''},
      runtime: {
        id: 'test', getManifest: () => ({version: 'test'}),
        onMessage: {addListener() {}},
        async sendMessage(message) {
          calls.push(message);
          return {ok: true, entries: message.cmd === 'hints-search' ? initialEntries :
            [{Login: 'other', Name: 'Other', uuid: 'manual', source: 'manual'}]};
        }
      },
      storage: {local: {async get() { return {}; }}, onChanged: {addListener() {}}}
    },
    __kpHints: {
      isOTPField: () => false, isPasswordField: () => false,
      isLoginField: el => el === field
    },
    __kpFormContext: {
      normalizeLogin: value => value, createFormStateStore: () => ({}),
      formContextRoot: () => null, rememberLoginForField() {},
      sortedEntriesForField: items => items
    },
    __kpIgnoredFields: {ignoredFieldKey: () => 'field'},
    __kpHintsLayout: {dropdownLayout: () => ({key: 'login', minWidth: 280, fields: ['Login']})}
  };
  context.self = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../data/hints/inject.js'), 'utf8'), context);
  const shadow = () => document.documentElement.children[0].shadow;
  const search = () => find(shadow(), el => el.className === 'kp-search');
  const button = label => find(shadow(), el => el.tagName === 'BUTTON' && el.textContent === label);
  const click = label => button(label).listeners.mousedown({preventDefault() {}, stopPropagation() {}});
  const open = () => document.listeners.focusin({target: field});
  const runSearch = query => {
    search().children[0].value = query;
    search().children[0].listeners.input();
    return pendingTimer();
  };
  return {open, search, button, click, calls, focused: () => focused, runSearch};
}

test('URL matches hide search until the footer Search button focuses it', {timeout: 2000}, async () => {
  const ui = setup([{Login: 'user', Name: 'Account', uuid: 'site'}]);
  await ui.open();
  assert.equal(ui.search().hidden, true);
  assert.equal(ui.button('Search').attributes['aria-expanded'], 'false');
  await ui.click('Search');
  assert.equal(ui.search().hidden, false);
  assert.equal(ui.focused(), ui.search().children[0]);
  assert.equal(ui.button('Search').attributes['aria-expanded'], 'true');
  assert.equal(ui.calls.length, 1);
  await ui.click('Refresh');
  assert.equal(ui.search().hidden, true);
});

test('empty URL matches show search automatically', {timeout: 2000}, async () => {
  const ui = setup([]);
  await ui.open();
  assert.equal(ui.search().hidden, false);
  assert.equal(ui.button('Search').attributes['aria-expanded'], 'true');
});

test('manual results and clearing the query keep the revealed search open', {timeout: 2000}, async () => {
  const ui = setup([{Login: 'user', Name: 'Account', uuid: 'site'}]);
  await ui.open();
  await ui.click('Search');
  await ui.runSearch('other');
  assert.equal(ui.search().hidden, false);
  assert.equal(ui.search().children[0].value, 'other');
  await ui.runSearch('');
  assert.equal(ui.search().hidden, false);
  assert.equal(ui.focused(), ui.search().children[0]);
});
