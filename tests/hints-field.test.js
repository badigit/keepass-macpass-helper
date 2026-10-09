const test = require('node:test');
const assert = require('node:assert/strict');

const {takeHintField} = require('../tools/hints-field.js');

test('inline fill prefers the page field saved before manual search took focus', () => {
  const document = {activeElement: {tagName: 'KP-HINTS-HOST'}};
  const field = {tagName: 'INPUT', ownerDocument: document, isConnected: true};
  const root = {__kpHintsActiveField: field};

  assert.equal(takeHintField(root, document), field);
  assert.equal(root.__kpHintsActiveField, null);
});

test('inline fill ignores a field removed by a login-step transition', () => {
  const activeElement = {tagName: 'INPUT'};
  const document = {activeElement};
  const stale = {tagName: 'INPUT', ownerDocument: document, isConnected: false};

  assert.equal(takeHintField({__kpHintsActiveField: stale}, document), activeElement);
});
