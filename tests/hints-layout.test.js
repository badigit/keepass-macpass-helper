const assert = require('node:assert/strict');
const test = require('node:test');

const {dropdownLayout} = require('../data/hints/layout.js');

test('dropdown omits empty group and gives title room', () => {
  assert.deepEqual(dropdownLayout([
    {Login: 'short', Name: 'A much longer credential title', group: ''}
  ]), {
    fields: ['Login', 'Name'],
    key: 'login-name',
    minWidth: 400
  });
});

test('dropdown keeps all populated credential columns', () => {
  assert.deepEqual(dropdownLayout([
    {Login: 'user', Name: 'Title', group: 'Work/Services'}
  ]), {
    fields: ['Login', 'Name', 'group'],
    key: 'login-name-group',
    minWidth: 460
  });
});

test('dropdown uses a compact single column for login-only entries', () => {
  assert.deepEqual(dropdownLayout([{Login: 'user'}]), {
    fields: ['Login'],
    key: 'login',
    minWidth: 280
  });
});
