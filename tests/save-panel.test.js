const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const worker = fs.readFileSync(path.join(__dirname, '../worker.js'), 'utf8');
const opener = worker.slice(worker.indexOf('const openSaveForm ='), worker.indexOf('// Generates a password'));
const branch = worker.slice(worker.indexOf("else if (request.cmd === 'hints-save-form')"),
  worker.indexOf("else if (request.cmd === 'hints-report-unwanted')"));

function setup({generate = false, rejectOpen = false} = {}) {
  const calls = [];
  let gesture = true;
  let respond;
  const response = new Promise(resolve => { respond = resolve; });
  const field = {tagName: 'INPUT', type: 'password', value: '', isConnected: true};
  const document = {activeElement: {tagName: 'BODY'}};
  field.ownerDocument = document;
  const context = {
    Promise, document, console: {warn() {}},
    __kpHintsActiveField: field,
    __kpHintsField: require('../tools/hints-field.js'),
    setInputValue: (target, value) => { target.value = value; },
    generatePassword: async () => { calls.push('generate'); return 'fixture-password'; },
    chrome: {
      storage: {session: {set: async payload => {
        calls.push(['storage', payload]);
        queueMicrotask(() => { gesture = false; });
      }}},
      sidePanel: {
        setOptions: async options => { calls.push(['options', options]); },
        open: options => {
          calls.push(['open', options]);
          assert.equal(gesture, true, 'panel must open before the first async boundary');
          return rejectOpen ? Promise.reject(new Error('panel refused')) : Promise.resolve();
        }
      },
      windows: {create: () => { assert.fail('saving must never open a popup'); }},
      scripting: {executeScript: async options => {
        calls.push(['script', options]);
        if (options.func) vm.runInContext('(' + options.func.toString() + ')("fixture-password")', context);
      }}
    }
  };
  context.self = context;
  vm.createContext(context);
  vm.runInContext(opener + '\nconst handler = (request, sender, response) => { if (false) {} ' + branch + '};\n' +
    'self.handle = handler;', context);
  assert.equal(context.handle({cmd: 'hints-save-form', url: 'https://example.test/register',
    login: 'fixture-user', password: generate ? '' : 'existing-password', generate},
  {tab: {id: 42, url: 'https://example.test/register'}, frameId: 7}, respond), true);
  return {calls, response, field};
}

test('inline save opens the side panel before storage completes', {timeout: 2000}, async () => {
  const {calls, response} = setup();
  assert.equal((await response).ok, true);
  assert.equal(calls[1][0], 'options');
  assert.equal(calls[2][0], 'open');
  assert.equal(calls[2][1].tabId, 42);
  const payload = calls.filter(call => call[0] === 'storage').at(-1)[1]['kp-save-form:42'];
  assert.equal(payload.pairs[0].passwords[0], 'existing-password');
});

test('generated password fills the original frame field after panel focus changes', {timeout: 2000}, async () => {
  const {calls, response, field} = setup({generate: true});
  assert.equal((await response).ok, true);
  assert.ok(calls.findIndex(call => call[0] === 'open') < calls.indexOf('generate'));
  assert.equal(field.value, 'fixture-password');
  const scripts = calls.filter(call => call[0] === 'script');
  assert.equal(scripts[0][1].target.frameIds[0], 7);
  assert.ok(scripts[0][1].files.includes('/tools/hints-field.js'));
  const payload = calls.filter(call => call[0] === 'storage').at(-1)[1]['kp-save-form:42'];
  assert.equal(payload.pairs[0].passwords[0], field.value);
});

test('panel refusal reports failure without creating a popup or generating a password', {timeout: 2000}, async () => {
  const {calls, response} = setup({generate: true, rejectOpen: true});
  const result = await response;
  assert.equal(result.ok, false);
  assert.equal(result.error, 'panel refused');
  assert.ok(!calls.includes('generate'));
});

test('pending payload does not render or generate a second password', {timeout: 2000}, () => {
  const save = fs.readFileSync(path.join(__dirname, '../data/save/index.js'), 'utf8');
  const render = save.slice(save.indexOf('const renderPayload ='), save.indexOf('const loadPayload ='));
  const context = {q: () => assert.fail('pending payload must wait before touching fields')};
  vm.runInNewContext(render + '\nrenderPayload({pending: true});', context);
});
