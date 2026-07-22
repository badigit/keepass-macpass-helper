const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = vm.createContext({
  SimpleStorage: class {},
  TextDecoder,
  TextEncoder,
  Uint8Array,
  atob,
  btoa,
  crypto,
  nacl: {
    box: {
      keyPair: () => ({publicKey: new Uint8Array([4, 5, 6])})
    }
  }
});
const source = fs.readFileSync(path.join(__dirname, '..', 'connect', 'keepassxc', 'keepassxc.js'), 'utf8');
vm.runInContext(source, context);
const KeePassXC = vm.runInContext('KeePassXC', context);

test('test-associate keeps every stored KeePassXC association', async () => {
  const keepass = new KeePassXC();
  const current = {id: 'current-id', key: 'current-key'};
  const other = {id: 'other-id', key: 'other-key'};
  let request;

  keepass.databasehash = async () => ({hash: 'current'});
  keepass.read = async () => ({
    'xc-current': current,
    'xc-other': other,
    unrelated: {id: 'ignored'}
  });
  keepass.securePost = async value => {
    request = value;
    return {success: 'true'};
  };

  await keepass['test-associate']();

  assert.equal(request.action, 'test-associate');
  assert.equal(request.id, current.id);
  assert.equal(keepass.key, current);
  assert.deepEqual(Array.from(keepass.keys), [current, other]);
  assert.equal(keepass.connected, true);
});

test('get-logins sends all associated database keys', async () => {
  const keepass = new KeePassXC();
  const keys = [
    {id: 'first-id', key: 'first-key'},
    {id: 'second-id', key: 'second-key'}
  ];
  let request;
  keepass.keys = keys;
  keepass.securePost = async value => {
    request = value;
    return {success: 'true', entries: []};
  };

  await keepass['get-logins']('https://example.test');

  assert.equal(request.action, 'get-logins');
  assert.equal(request.url, 'https://example.test');
  assert.equal(request.keys, keys);
});

test('new KeePassXC association is immediately usable', async () => {
  const keepass = new KeePassXC();
  keepass.keyPair = {publicKey: new Uint8Array([1, 2, 3])};
  keepass.securePost = async () => ({success: 'true', id: 'new-id', hash: 'new-hash'});
  keepass.write = async () => {};

  await keepass.associate();

  assert.equal(keepass.keys.length, 1);
  assert.equal(keepass.keys[0].id, 'new-id');
  assert.equal(keepass.connected, true);
});
