/* node --test tests/
 *
 * Pure tests for data/hints/heuristics.js. The heuristics module ships UMD so
 * we can require() it directly without a bundler. */
const test = require('node:test');
const assert = require('node:assert/strict');

const h = require('../data/hints/heuristics.js');

// Minimal <input>-like stub. Attributes drive the heuristic checks; the form
// fallback in isLoginField needs `closest('form')` and the form's
// `querySelectorAll('input')`, so we support that too.
function makeInput(attrs = {}) {
  const a = {
    type: 'text',
    name: '',
    id: '',
    className: '',
    autocomplete: null,
    placeholder: null,
    'aria-label': null,
    inputmode: null,
    pattern: null,
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
    get className() { return a.className; },
    get value() { return a.value; },
    get offsetParent() { return a.offsetParent; },
    getAttribute(key) {
      return Object.prototype.hasOwnProperty.call(a, key) ? a[key] : null;
    },
    closest(sel) {
      return sel === 'form' ? a.form : null;
    },
    _attrs: a
  };
  return el;
}

function makeForm({inputs = [], action = '', hasSubmit = false} = {}) {
  const submitTokens = hasSubmit ? [{type: 'submit', tagName: 'INPUT', offsetParent: {}}] : [];
  const all = [...inputs, ...submitTokens];
  const form = {
    getAttribute(key) { return key === 'action' ? action : null; },
    querySelectorAll() { return all; }
  };
  inputs.forEach(i => { if (i && i._attrs) i._attrs.form = form; });
  return form;
}

// Tailwind class blob from the live Frigate /login page that originally
// triggered the regression (disabled:opacity-50 contains the substring "city").
const TAILWIND_CLASSES =
  'flex h-10 rounded-md ring-offset-background file:border-0 file:bg-transparent ' +
  'file:text-sm file:font-medium placeholder:text-muted-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ' +
  'dark:bg-background_alt text-md w-full border border-input bg-background p-2 ' +
  'hover:bg-accent hover:text-accent-foreground dark:[color-scheme:dark]';

test('isClearlyNonAuthField — regression: Tailwind "opacity" must not trip "city"', () => {
  const el = makeInput({name: 'user', type: 'text', className: TAILWIND_CLASSES});
  assert.equal(h.isClearlyNonAuthField(el), false);
});

test('isClearlyNonAuthField — search/filter markers still excluded', () => {
  for (const className of ['search-input', 'filter-bar', 'lookup-row']) {
    const el = makeInput({name: 'q', className});
    assert.equal(h.isClearlyNonAuthField(el), true, `expected non-auth for ${className}`);
  }
});

test('isClearlyNonAuthField — Bitrix selector _label suffix', () => {
  const el = makeInput({name: 'CONTACT_ID_label', id: 'CONTACT_ID_label'});
  assert.equal(h.isClearlyNonAuthField(el), true);
});

test('isClearlyNonAuthField — Grafana user-search placeholder', () => {
  const el = makeInput({
    name: 'q',
    placeholder: 'Поиск пользователя по логину...'
  });
  assert.equal(h.isClearlyNonAuthField(el), true);
});

test('isClearlyNonAuthField — phone field with misapplied one-time-code', () => {
  const el = makeInput({
    type: 'tel',
    autocomplete: 'one-time-code',
    placeholder: 'Введите номер телефона'
  });
  assert.equal(h.isClearlyNonAuthField(el), true);
});

test('isClearlyNonAuthField — "name$" excludes ending in "username"', () => {
  const userEl = makeInput({name: 'username', id: 'username'});
  assert.equal(h.isClearlyNonAuthField(userEl), false);
});

test('isOTPField — totp/otp with separators', () => {
  for (const name of ['app_totp', 'sudo_app_otp', 'login-2fa', 'mfa_code', 'pin-code']) {
    const el = makeInput({name});
    assert.equal(h.isOTPField(el), true, `expected OTP for ${name}`);
  }
});

test('isOTPField — autocomplete one-time-code', () => {
  const el = makeInput({autocomplete: 'one-time-code'});
  assert.equal(h.isOTPField(el), true);
});

test('isOTPField — false on plain login', () => {
  const el = makeInput({name: 'username'});
  assert.equal(h.isOTPField(el), false);
});

test('isPasswordField — only type=password', () => {
  assert.equal(h.isPasswordField(makeInput({type: 'password'})), true);
  assert.equal(h.isPasswordField(makeInput({type: 'text'})), false);
  assert.equal(h.isPasswordField(null), false);
});

test('isLoginField — Frigate/shadcn login (Tailwind classes + name="user")', () => {
  const el = makeInput({name: 'user', type: 'text', className: TAILWIND_CLASSES});
  assert.equal(h.isLoginField(el), true);
});

test('isLoginField — type=password is always a login field', () => {
  assert.equal(h.isLoginField(makeInput({type: 'password'})), true);
});

test('isLoginField — email-like placeholder', () => {
  const el = makeInput({placeholder: 'ivan@domain.ru'});
  assert.equal(h.isLoginField(el), true);
});

test('isLoginField — single text input in submit-bearing form (login-first flow)', () => {
  const el = makeInput({type: 'text', name: 'whatever'});
  makeForm({inputs: [el], hasSubmit: true});
  assert.equal(h.isLoginField(el), true);
});

test('isLoginField — search form with submit button is NOT a login', () => {
  const el = makeInput({type: 'text', name: 'q'});
  makeForm({inputs: [el], hasSubmit: true, action: '/search'});
  assert.equal(h.isLoginField(el), false);
});

test('isLoginField — type=number is excluded (was previously over-greedy)', () => {
  const el = makeInput({type: 'number'});
  assert.equal(h.isLoginField(el), false);
});

test('isLoginField — non-auth wins over USER_RE on placeholder', () => {
  // Search box that mentions login/email in placeholder must stay excluded.
  const el = makeInput({
    name: 'q',
    className: 'search-input',
    placeholder: 'Найти пользователя по email'
  });
  assert.equal(h.isLoginField(el), false);
});

test('positiveHintText / negativeHintText boundaries', () => {
  const el = makeInput({
    name: 'user',
    id: 'login',
    className: 'opacity-50',
    inputmode: 'email',
    pattern: '.*'
  });
  const pos = h.positiveHintText(el);
  const neg = h.negativeHintText(el);
  assert.ok(pos.includes('user') && pos.includes('login'));
  assert.ok(!pos.includes('opacity'));
  assert.ok(neg.includes('opacity-50'));
  assert.ok(neg.includes('email'));
});
