/* node --test tests/form-context.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');

const fc = require('../data/hints/form-context.js');

// Lightweight DOM-ish input. Matches the surface form-context.js touches:
// type, name, id, value, closest('form'), querySelectorAll, getRootNode,
// parentElement, offsetParent.
function makeInput(attrs = {}) {
  const a = {
    type: 'text',
    name: '',
    id: '',
    value: '',
    offsetParent: {},
    form: null,
    ...attrs
  };
  const el = {
    tagName: 'INPUT',
    get type() { return a.type; },
    get name() { return a.name; },
    get id() { return a.id; },
    get value() { return a.value; },
    set value(v) { a.value = v; },
    get offsetParent() { return a.offsetParent; },
    get className() { return ''; },
    parentElement: null,
    getAttribute() { return null; },
    getRootNode() { return null; },
    closest(sel) { return sel === 'form' ? a.form : null; },
    _attrs: a
  };
  return el;
}

function makeForm(inputs) {
  const form = {
    parentElement: null,
    getRootNode() { return null; },
    closest(sel) { return sel === 'form' ? form : null; },
    querySelector(sel) { return form.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      // Cheap shim: ignore selector, return all inputs for the heuristics' uses.
      // Tests below pass a single input, so this is sufficient.
      if (sel === 'input' || sel.includes('input')) return inputs;
      return [];
    }
  };
  inputs.forEach(i => { if (i?._attrs) i._attrs.form = form; });
  return form;
}

test('sortedEntriesForField — non-password field returns shallow copy', () => {
  const el = makeInput({type: 'text', name: 'user'});
  const items = [{Login: 'a'}, {Login: 'b'}];
  const sorted = fc.sortedEntriesForField(items, el, fc.createFormStateStore());
  assert.deepEqual(sorted, items);
  assert.notEqual(sorted, items, 'must return a new array');
});

test('sortedEntriesForField — exact login match ranks first', () => {
  const user = makeInput({type: 'text', name: 'user', value: 'alice'});
  const pw = makeInput({type: 'password', name: 'password'});
  makeForm([user, pw]);
  const store = fc.createFormStateStore();
  const items = [
    {Login: 'bob'},
    {Login: 'alice@example.com'},
    {Login: 'alice'},
    {Login: 'charlie'}
  ];
  const sorted = fc.sortedEntriesForField(items, pw, store);
  assert.equal(sorted[0].Login, 'alice', 'exact match wins');
  assert.equal(sorted[1].Login, 'alice@example.com', 'prefix overlap second');
});

test('sortedEntriesForField — case-insensitive matching', () => {
  const user = makeInput({type: 'text', name: 'user', value: '  ALICE '});
  const pw = makeInput({type: 'password', name: 'password'});
  makeForm([user, pw]);
  const items = [{Login: 'bob'}, {Login: 'alice'}];
  const sorted = fc.sortedEntriesForField(items, pw, fc.createFormStateStore());
  assert.equal(sorted[0].Login, 'alice');
});

test('rememberLoginForField — wins over DOM-inferred login', () => {
  const user = makeInput({type: 'text', name: 'user', value: 'bob'});
  const pw = makeInput({type: 'password', name: 'password'});
  makeForm([user, pw]);
  const store = fc.createFormStateStore();
  fc.rememberLoginForField(store, pw, 'alice');
  const items = [{Login: 'bob'}, {Login: 'alice'}];
  const sorted = fc.sortedEntriesForField(items, pw, store);
  assert.equal(sorted[0].Login, 'alice', 'remembered login overrides DOM value');
});

test('sortedEntriesForField — no preferred login falls back to original order', () => {
  const pw = makeInput({type: 'password', name: 'password'});
  makeForm([pw]); // no user field, no remembered login
  const items = [{Login: 'zeta'}, {Login: 'alpha'}];
  const sorted = fc.sortedEntriesForField(items, pw, fc.createFormStateStore());
  assert.deepEqual(sorted.map(e => e.Login), ['zeta', 'alpha']);
});

test('sortedEntriesForField — stable on ties (preserve original index)', () => {
  const user = makeInput({type: 'text', name: 'user', value: 'admin'});
  const pw = makeInput({type: 'password', name: 'password'});
  makeForm([user, pw]);
  const items = [
    {Login: 'foo'},
    {Login: 'bar'},
    {Login: 'baz'}
  ];
  // None match "admin" → all score 0, original order preserved.
  const sorted = fc.sortedEntriesForField(items, pw, fc.createFormStateStore());
  assert.deepEqual(sorted.map(e => e.Login), ['foo', 'bar', 'baz']);
});

test('normalizeLogin — trim, lowercase, null-safe', () => {
  assert.equal(fc.normalizeLogin('  Foo '), 'foo');
  assert.equal(fc.normalizeLogin(null), '');
  assert.equal(fc.normalizeLogin(undefined), '');
});
