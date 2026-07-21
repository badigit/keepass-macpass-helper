const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = vm.createContext({
  AbortController,
  SimpleStorage: class {},
  TextDecoder,
  TextEncoder,
  Uint8Array,
  atob,
  btoa,
  crypto,
  fetch
});
const source = fs.readFileSync(path.join(__dirname, '..', 'connect', 'keepass', 'keepass.js'), 'utf8');
vm.runInContext(source, context);
const KeePass = vm.runInContext('KeePass', context);

test('customSearch searches only login, title and URL', async () => {
  const keepass = new KeePass();
  let call;
  keepass.post = async (...args) => {
    call = args;
    return {Entries: []};
  };

  await keepass.customSearch('uiscom');

  assert.equal(call[0].RequestType, 'get-logins-custom-search');
  assert.equal(call[0].SearchString, 'uiscom');
  assert.equal(call[0].SearchInTitles, true);
  assert.equal(call[0].SearchInUserNames, true);
  assert.equal(call[0].SearchInUrls, true);
  assert.equal(call[0].SearchInPasswords, false);
  assert.equal(call[0].SearchInNotes, false);
  assert.equal(call[0].ExcludeExpired, true);
  assert.equal(call[2], true);
  assert.deepEqual(Array.from(call[3]), ['SearchString']);
});

test('getByUuid encrypts the selected UUID', async () => {
  const keepass = new KeePass();
  let call;
  keepass.post = async (...args) => {
    call = args;
    return {Entries: []};
  };

  await keepass.getByUuid('001122');

  assert.equal(call[0].RequestType, 'get-login-by-uuid');
  assert.equal(call[0].Uuid, '001122');
  assert.equal(call[2], true);
  assert.deepEqual(Array.from(call[3]), ['Uuid']);
});
