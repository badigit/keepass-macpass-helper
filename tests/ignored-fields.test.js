const test = require('node:test');
const assert = require('node:assert/strict');

const {ignoredFieldKey, normalizeClassName} = require('../data/hints/ignored-fields.js');

const makeInput = attrs => ({
  tagName: 'INPUT',
  type: attrs.type || 'text',
  name: attrs.name || '',
  id: attrs.id || '',
  className: attrs.className || '',
  getAttribute(key) {
    return attrs[key] || null;
  }
});

test('ignored field key is scoped to the site', () => {
  const field = makeInput({placeholder: 'Enter code or name'});
  assert.notEqual(
    ignoredFieldKey(field, 'https://one.example'),
    ignoredFieldKey(field, 'https://two.example')
  );
});

test('ignored field key survives dynamic numeric ids', () => {
  const first = makeInput({id: 'ul-combobox-1150-inputEl'});
  const rerendered = makeInput({id: 'ul-combobox-4208-inputEl'});
  assert.equal(
    ignoredFieldKey(first, 'https://app.example'),
    ignoredFieldKey(rerendered, 'https://app.example')
  );
});

test('placeholder identifies fields without name or id', () => {
  const field = makeInput({placeholder: 'Начните вводить код или название'});
  assert.match(ignoredFieldKey(field, 'https://app.example'), /placeholder/);
});

test('same generic name with different local context stays distinct', () => {
  const login = makeInput({name: 'email', placeholder: 'Email'});
  const contact = makeInput({name: 'email', placeholder: 'Customer email'});
  assert.notEqual(
    ignoredFieldKey(login, 'https://app.example'),
    ignoredFieldKey(contact, 'https://app.example')
  );
});

test('fallback key ignores transient focus and invalid classes', () => {
  const plain = makeInput({autocomplete: 'one-time-code', className: 'otp-cell widget'});
  const focused = makeInput({
    autocomplete: 'one-time-code',
    className: 'widget otp-cell x-form-focus x-form-invalid-field'
  });
  assert.equal(
    ignoredFieldKey(plain, 'https://app.example'),
    ignoredFieldKey(focused, 'https://app.example')
  );
  assert.equal(normalizeClassName(focused.className), 'otp-cell widget');
});
