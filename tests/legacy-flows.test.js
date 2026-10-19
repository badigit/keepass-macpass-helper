const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {worker, panel, storage, flush, read} = require('./helpers/extension.js');
const prefs = require('../tools/password-prefs.js');
const timeout = {timeout: 3000};

for (const result of [undefined, {}, {Success: false, Error: 'fixture-refused'}, {Success: 'false'}]) {
  test('all KeePass write callers reject unconfirmed response ' + JSON.stringify(result), timeout, async () => {
    const w = worker();
    const core = vm.runInContext('new KeePass()', w.context);
    core.post = async () => result;
    vm.runInContext('engine.type = "keepass"', w.context);
    w.context.fixtureCore = core;
    vm.runInContext('engine.core = fixtureCore', w.context);
    const entry = {url: 'https://example.test', login: 'fixture-user', password: 'fixture-password'};
    await assert.rejects(core.set(entry));
    await assert.rejects(vm.runInContext('engine.set', w.context)(entry));
    await assert.rejects(core.set({uuid: 'fixture-uuid', url: entry.url, onlyIfUrlEmpty: true}));
    await assert.rejects(core.set({stringFields: [{key: 'fixture', value: 'fixture'}]}));
  });
}
test('save UI reports refused write and stays open for correction', timeout, async () => {
  const store = storage({session: {'kp-save-form:42': {revision: 1, url: 'https://example.test',
    pairs: [{usernames: ['fixture'], passwords: ['fixture']}]}}});
  const w = worker({storage: store});
  const core = vm.runInContext('new KeePass()', w.context);
  core.post = async () => ({Success: false, Error: 'fixture-refused'});
  const p = panel(w.chrome, {context: {engine: {prepare: async () => {}, set: query => core.set(query)}}});
  await flush();
  p.listeners.submit[0]({preventDefault() {}, target: {checkValidity: () => true}});
  await flush();
  assert.equal(p.field('#status').textContent, 'fixture-refused');
  assert.equal(p.field('#status').className, 'status error');
  assert.equal(p.field('[data-cmd=save]').disabled, false);
});

test('worker restores real SSDB with real Safe and reads an encrypted fixture', timeout, async () => {
  const w = worker();
  assert.ok(w.imports.includes('/tools/safe.js'));
  const safe = vm.runInContext('new Safe()', w.context);
  await safe.open('synthetic-fixture-password');
  const exported = await safe.export();
  await w.chrome.storage.session.set({'ssdb-exported-key': exported});
  await vm.runInContext('engine.prepare("none")', w.context);
  const ssdb = vm.runInContext('engine.ssdb', w.context);
  const uuid = (await ssdb.convert('https://example.test'))[0];
  await ssdb.append(uuid, {Login: 'fixture-user', Password: 'fixture-password'});
  const result = await vm.runInContext('engine.search({url: "https://example.test"})', w.context);
  assert.equal(result.Entries[0].Login, 'fixture-user');
  assert.equal(result.Entries[0].Password, 'fixture-password');
});
test('invalid SSDB key is removed without hanging backend initialization', timeout, async () => {
  const store = storage({session: {'ssdb-exported-key': 'invalid-fixture-key'}});
  const w = worker({storage: store});
  await vm.runInContext('engine.prepare("none")', w.context);
  assert.equal(vm.runInContext('engine.ssdb', w.context), undefined);
  assert.equal(store.session.values['ssdb-exported-key'], undefined);
});
test('SSDB form saves independently of a disconnected KeePass backend', timeout, async () => {
  const store = storage({local: {engine: 'keepass'}, session: {'kp-save-form:42': {revision: 1, url: 'https://example.test',
    pairs: [{usernames: ['fixture'], passwords: ['fixture']}]}}});
  const w = worker({storage: store});
  const safe = vm.runInContext('new Safe()', w.context);
  await safe.open('fixture-password');
  await store.session.set({'ssdb-exported-key': await safe.export()});
  const engine = vm.runInContext('engine', w.context);
  const p = panel(w.chrome, {context: {engine, console: {warn() {}}}});
  await flush();
  p.field('[name=target]').value = 'ssdb';
  p.listeners.submit[0]({preventDefault() {}, target: {checkValidity: () => true}});
  for (let i = 0; i < 30 && p.field('#status').textContent !== 'Saved'; i++) await flush();
  assert.equal(engine.type, 'none');
  assert.equal(p.field('#status').textContent, 'Saved');
  assert.equal(Object.keys(store.sync.values).length, 1);
});
test('confirmed KeePass replies preserve the client result', timeout, async () => {
  const w = worker();
  const core = vm.runInContext('new KeePass()', w.context);
  for (const Success of [true, 'true']) {
    core.post = async () => ({Success, Uuid: 'fixture-uuid'});
    assert.equal((await core.set({login: 'fixture'})).Uuid, 'fixture-uuid');
  }
});
test('Safe keeps the legacy IV plus ciphertext format, including old data URL prefix', timeout, async () => {
  const w = worker();
  const safe = vm.runInContext('new Safe()', w.context);
  await safe.open('fixture-password');
  const encoded = await safe.encrypt('Unicode fixture: Привет');
  assert.equal(await safe.decrypt('data:application/octet-binary;base64,' + encoded), 'Unicode fixture: Привет');
  const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  const key = await w.context.crypto.subtle.importKey('raw', Uint8Array.from(atob(await safe.export()), char => char.charCodeAt(0)), 'AES-CBC', false, ['decrypt']);
  const legacy = await w.context.crypto.subtle.decrypt({name: 'AES-CBC', iv: new Uint8Array(16)}, key, bytes);
  assert.equal(new TextDecoder().decode(new Uint8Array(legacy).subarray(16)), 'Unicode fixture: Привет');
});
test('SSDB constructor failure is caught and synced write rejection propagates', timeout, async () => {
  const store = storage({session: {'ssdb-exported-key': 'fixture'}});
  const w = worker({storage: store});
  vm.runInContext('Safe = class { constructor() { throw Error("fixture-constructor"); } };', w.context);
  await vm.runInContext('engine.prepare("none")', w.context);
  assert.equal(store.session.values['ssdb-exported-key'], undefined);
  store.sync.set = async () => {throw Error('fixture-quota');};
  const synced = vm.runInContext('new SyncedStorage()', w.context);
  await assert.rejects(synced.set('fixture-key', 'fixture-value'), /fixture-quota/);
});

test('clipboard popup uses an expiring one-time token and validates its caller', timeout, async () => {
  const w = worker();
  assert.equal((await w.message({cmd: 'copy-interface', password: 'fixture-secret'})).ok, true);
  const url = w.calls.find(call => call[0] === 'window')[1].url;
  assert.ok(!url.includes('fixture-secret'));
  const id = new URL(url, 'chrome-extension://fixture').searchParams.get('id');
  const request = {cmd: 'copy-payload', id};
  assert.equal((await w.message(request, {url: 'https://example.test' + url})).ok, false);
  assert.equal((await w.message(request, {url: 'chrome-extension://other' + url})).ok, false);
  const sender = {url: 'chrome-extension://fixture' + url};
  const result = await w.message(request, sender);
  assert.equal(result.content, 'fixture-secret');
  assert.equal(w.chrome.storage.session.values['kp-copy:' + id], undefined);
  assert.equal((await w.message(request, sender)).ok, false);
  await w.chrome.storage.session.set({['kp-copy:' + id]: {content: 'fixture', expires: Date.now() - 1}});
  assert.equal((await w.message(request, sender)).ok, false);
});
test('clipboard payload can be consumed only once under concurrent requests', timeout, async () => {
  const w = worker();
  await w.message({cmd: 'copy-interface', password: 'fixture'});
  const url = w.calls.find(call => call[0] === 'window')[1].url;
  const id = new URL(url, 'chrome-extension://fixture').searchParams.get('id');
  const sender = {url: 'chrome-extension://fixture' + url};
  const results = await Promise.all([w.message({cmd: 'copy-payload', id}, sender), w.message({cmd: 'copy-payload', id}, sender)]);
  assert.equal(results.filter(result => result.ok).length, 1);
});
test('clipboard window failure cleans its payload; worker startup removes expired payloads', timeout, async () => {
  const store = storage({session: {'kp-copy:expired-fixture': {content: 'fixture', expires: 1}}});
  const w = worker({storage: store, createWindow: () => {throw Error('fixture-window-failed');}});
  await flush();
  assert.equal(store.session.values['kp-copy:expired-fixture'], undefined);
  const result = await w.message({cmd: 'copy-interface', password: 'fixture'});
  assert.equal(result.ok, false);
  assert.ok(!Object.keys(store.session.values).some(key => key.startsWith('kp-copy:')));
});

test('legacy generator settings migrate once, keeping zero symbols and custom pools', timeout, async () => {
  const store = storage({local: {'charset-1': 'ABC', 'charset-2': '', 'length-1': 7, 'length-2': 0}});
  const result = await prefs.load(store.local);
  assert.equal(result.mode, 'charset');
  assert.equal(result.charset.charset1, 'ABC');
  assert.equal(result.charset.length2, 0);
  assert.equal(result.charset.charset2, '');
  assert.equal(store.local.values['length-1'], undefined);
  assert.deepEqual(await prefs.load(store.local), result);
});
test('canonical generator choices win over legacy values', timeout, async () => {
  const canonical = prefs.normalize({mode: 'diceware', charset: {length1: 23, charset1: 'XYZ'}});
  const store = storage({local: {[prefs.key]: canonical, 'length-1': 7, 'charset-1': 'ABC'}});
  const result = await prefs.load(store.local);
  assert.equal(result.mode, 'diceware');
  assert.equal(result.charset.length1, 23);
  assert.equal(result.charset.charset1, 'XYZ');
});
test('menu, shortcut, inline generation and save panel share preferences and generator', timeout, async () => {
  const canonical = prefs.normalize({mode: 'charset', charset: {charset1: 'XYZ', charset2: '', length1: 9, length2: 0}});
  const store = storage({local: {[prefs.key]: canonical}, session: {'kp-save-form:42': {revision: 1, url: 'https://example.test', pairs: []}}});
  const w = worker({storage: store});
  const generated = [];
  w.context.__kpPasswordGen.generate = value => {generated.push(value); return 'fixture';};
  w.context.navigator.clipboard = {writeText: async () => {}};
  await w.chrome.contextMenus.onClicked.fire({menuItemId: 'generate-password'}, w.activeTab);
  await w.chrome.commands.onCommand.fire('generate-password', w.activeTab);
  await w.message({cmd: 'hints-save-form', generate: true});
  const p = panel(w.chrome, {generate: value => {generated.push(value); return 'fixture';}});
  await flush();
  await store.session.set({'kp-save-form:42': {revision: Date.now() + 1000, url: 'https://example.test', pairs: []}});
  assert.equal(generated.length, 4);
  for (const value of generated) {
    assert.equal(value.mode, 'charset');
    assert.equal(value.charset.charset1, 'XYZ');
    assert.equal(value.charset.length2, 0);
  }
  assert.equal(p.field('[name=password]').value, 'fixture');
});
test('old alternate implementations are absent and surviving pages load their shared helpers', timeout, () => {
  const source = read('worker.js');
  assert.equal((source.match(/chrome\.sidePanel\.open\(/g) || []).length, 1);
  assert.doesNotMatch(source, /\?content=|prefs\.json|id: 'auto-login'/);
  assert.doesNotMatch(read('data/options/index.js'), /auto-submit-auto-login|localStorage.getItem\('auto-submit'\)/);
  assert.doesNotMatch(read('data/options/index.html'), /Auto Login \(not available\)|auto-submit-auto-login/);
  assert.match(read('data/save/index.html'), /tools\/save-state.js/);
  assert.match(read('data/options/index.html'), /tools\/password-prefs.js/);
});
