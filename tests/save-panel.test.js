const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {worker, panel, storage, flush} = require('./helpers/extension.js');
const deferred = () => { let resolve; const promise = new Promise(done => {resolve = done;}); return {promise, resolve}; };
const timeout = {timeout: 3000};

for (const entry of ['inline', 'menu', 'shortcut']) {
  test(entry + ' opens panel before awaiting and publishes pending then final data', timeout, async () => {
    const script = deferred();
    let gestured = true;
    const w = worker({open: () => {assert.equal(gestured, true); return Promise.resolve();}, executeScript: () => script.promise});
    const seed = w.chrome.storage.session.set;
    w.chrome.storage.session.set = value => {queueMicrotask(() => {gestured = false;}); return seed(value);};
    let done;
    if (entry === 'inline') done = w.message({cmd: 'hints-save-form', password: 'existing', login: 'fixture-user'});
    else if (entry === 'menu') done = w.chrome.contextMenus.onClicked.fire({menuItemId: 'save-form'}, w.activeTab);
    else done = w.chrome.commands.onCommand.fire('save-form', w.activeTab);
    await flush();
    assert.equal(w.calls.filter(call => call[0] === 'open').length, 1);
    if (entry !== 'inline') assert.equal(w.chrome.storage.session.values['kp-save-form:42'].pending, true);
    script.resolve([{result: [{usernames: ['fixture-user'], passwords: ['existing']}]}]);
    await done;
    const payload = w.chrome.storage.session.values['kp-save-form:42'];
    assert.equal(payload.pending, false);
    assert.equal(payload.pairs[0].passwords[0], 'existing');
    assert.equal(w.calls.filter(call => call[0] === 'window').length, 0);
  });
}
test('generated inline password fills the preserved field in the sender frame', timeout, async () => {
  const page = {document: {activeElement: {tagName: 'BODY'}}};
  const field = {tagName: 'INPUT', type: 'password', ownerDocument: page.document, isConnected: true};
  page.self = page;
  page.__kpHintsActiveField = field;
  page.__kpHintsField = require('../tools/hints-field.js');
  page.setInputValue = (element, value) => {element.value = value;};
  const w = worker({executeScript: async options => {
    assert.equal(options.target.frameIds[0], 7);
    if (options.func) vm.runInNewContext('(' + options.func + ')(' + JSON.stringify(options.args[0]) + ')', page);
    return [];
  }});
  w.context.__kpPasswordGen.generate = () => 'fixture-password';
  assert.equal((await w.message({cmd: 'hints-save-form', generate: true})).ok, true);
  assert.equal(field.value, 'fixture-password');
  assert.equal(w.chrome.storage.session.values['kp-save-form:42'].pairs[0].passwords[0], field.value);
});
test('panel failure is explicit and never generates or opens a popup', timeout, async () => {
  const w = worker({open: () => Promise.reject(Error('panel refused'))});
  w.context.__kpPasswordGen.generate = () => assert.fail('must not generate');
  const result = await w.message({cmd: 'hints-save-form', generate: true});
  assert.equal(result.error, 'panel refused');
  assert.equal(w.chrome.storage.session.values['kp-save-form:42'].error, 'panel refused');
  assert.ok(!w.calls.some(call => call[0] === 'window'));
});
test('late completion of an older save cannot overwrite the newer one', timeout, async () => {
  const first = deferred();
  const w = worker({executeScript: () => first.promise});
  const old = w.chrome.contextMenus.onClicked.fire({menuItemId: 'save-form'}, w.activeTab);
  await flush();
  await w.message({cmd: 'hints-save-form', login: 'new-user', password: 'new-password'});
  first.resolve([{result: [{usernames: ['old-user'], passwords: ['old-password']}]}]);
  await old;
  assert.equal(w.chrome.storage.session.values['kp-save-form:42'].pairs[0].usernames[0], 'new-user');
});
test('panel waits for ready data, handles repeats and ignores stale snapshots', timeout, async () => {
  const store = storage();
  let generations = 0;
  const p = panel({storage: store}, {generate: () => {generations++; return 'generated';}});
  await flush();
  const put = payload => store.session.set({'kp-save-form:42': payload});
  await put({revision: 1, pending: true, url: 'https://example.test'});
  assert.equal(generations, 0);
  assert.equal(p.field('[data-cmd=save]').disabled, true);
  await put({revision: 1, pairs: [{usernames: ['first'], passwords: ['actual']}], url: 'https://example.test'});
  assert.equal(p.field('[name=password]').value, 'actual');
  await put({revision: 2, pending: true, url: 'https://example.test/other'});
  assert.equal(p.field('[name=password]').value, '');
  p.input('login', 'typed-user');
  await put({revision: 2, pairs: [{usernames: ['scraped'], passwords: ['second']}], url: 'https://example.test/other'});
  assert.equal(p.field('[name=login]').value, 'typed-user');
  assert.equal(p.field('[name=password]').value, 'second');
  await put({revision: 1, pairs: [{usernames: ['stale'], passwords: ['stale']}]});
  assert.equal(p.field('[name=password]').value, 'second');
  assert.equal(generations, 0);
});
test('empty final form generates once, preserves empty edits and applies CSS', timeout, async () => {
  const store = storage();
  let generations = 0;
  const p = panel({storage: store}, {style: 'body {color: red}', generate: () => {generations++; return 'generated';}});
  await flush();
  const put = payload => store.session.set({'kp-save-form:42': payload});
  await put({revision: 1, pending: true});
  await put({revision: 1, pairs: []});
  await put({revision: 1, pairs: []});
  assert.equal(generations, 1);
  assert.equal(p.styles[0].textContent, 'body {color: red}');
  await put({revision: 2, pending: true});
  p.input('password', '');
  await put({revision: 2, pairs: [{usernames: ['fixture'], passwords: ['scraped']}]});
  assert.equal(p.field('[name=password]').value, '');
  assert.equal(generations, 1);
});

test('menu scraping keeps usernames and passwords inside the same form', timeout, async () => {
  const forms = ['first', 'second'].map(name => ({
    extendedQuerySelectorAll: selector => selector.includes('password') ? [{value: name + '-password'}] :
      selector.includes('email') ? [] : [{tagName: 'INPUT', name: 'username', type: 'text', offsetParent: {}, value: name + '-user', getAttribute: () => null}]
  }));
  const passwords = forms.map(form => ({form, value: 'unused-page-password'}));
  const page = {document: {extendedQuerySelectorAll: () => passwords}, detectForm: field => field.form};
  page.__kpFormContext = require('../data/hints/form-context.js');
  page.self = page;
  const w = worker({executeScript: async options => options.func ?
    [{result: vm.runInNewContext('(' + options.func + ')()', page)}] : []});
  await w.chrome.contextMenus.onClicked.fire({menuItemId: 'save-form'}, w.activeTab);
  const pairs = w.chrome.storage.session.values['kp-save-form:42'].pairs;
  assert.deepEqual(pairs.map(pair => pair.passwords), [['first-password'], ['second-password']]);
  assert.deepEqual(pairs.map(pair => pair.usernames), [['first-user'], ['second-user']]);
});
