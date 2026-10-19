// Real DOM smoke with synthetic Chrome APIs; never opens the user's browser profile or vault.
// KMH_PLAYWRIGHT: optional Playwright module path; KMH_CHROME: installed browser executable.
const {chromium} = require(process.env.KMH_PLAYWRIGHT || 'playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const deadline = setTimeout(() => {console.error('Browser smoke exceeded 60 seconds'); process.exit(1);}, 60000);
deadline.unref();

async function main() {
  const server = http.createServer(async (request, response) => {
    try {
      const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + name);
      if (!file.startsWith(root + path.sep)) throw Error('Outside fixture root');
      response.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(await fs.readFile(file));
    }
    catch {response.writeHead(404); response.end();}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless: true, executablePath: process.env.KMH_CHROME, timeout: 15000});
    const context = await browser.newContext();
    context.setDefaultTimeout(5000);
    await context.addInitScript(() => {
      const state = JSON.parse(localStorage.getItem('kmh-smoke-store') || '{"local":{},"session":{},"sync":{}}');
      const listeners = [];
      const persist = () => localStorage.setItem('kmh-smoke-store', JSON.stringify(state));
      const area = name => ({
        get: async (keys, callback) => {
          const values = state[name];
          const result = keys == null ? {...values} : typeof keys === 'string' ? {[keys]: values[keys]} :
            Array.isArray(keys) ? Object.fromEntries(keys.map(key => [key, values[key]])) :
              {...keys, ...Object.fromEntries(Object.keys(keys).filter(key => key in values).map(key => [key, values[key]]))};
          if (callback) callback(result);
          return result;
        },
        set: async (values, callback) => {
          const changes = {};
          for (const [key, value] of Object.entries(values)) {
            changes[key] = {oldValue: state[name][key], newValue: value};
            state[name][key] = value;
          }
          persist();
          listeners.forEach(fn => fn(changes, name));
          callback?.();
        },
        remove: async (keys, callback) => {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete state[name][key];
          persist(); callback?.();
        }
      });
      window.chrome = {
        storage: {local: area('local'), session: area('session'), sync: area('sync'), onChanged: {addListener: fn => listeners.push(fn)}},
        runtime: {getManifest: () => ({version: 'fixture'}),
          sendMessage: async request => request.cmd === 'copy-payload' ? {ok: true, content: 'synthetic-copy-fixture'} : {ok: true}},
        i18n: {getMessage: () => ''}, permissions: {contains: (request, callback) => callback(true)}
      };
      window.__copied = [];
      Object.defineProperty(navigator, 'clipboard', {value: {writeText: async value => window.__copied.push(value)}});
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const base = 'http://127.0.0.1:' + server.address().port;
    await page.goto(base + '/data/options/index.html');
    await page.waitForFunction(() => document.getElementById('dw-count').value === '5');
    await page.locator('#generator-mode').selectOption('charset');
    await page.locator('#charset-1').fill('XYZ');
    await page.locator('#charset-2').fill('');
    await page.locator('#length-1').fill('9');
    await page.locator('#length-2').fill('0');
    await page.locator('#save-dialog-style').fill('body { --kmh-smoke-style: applied; }');
    await page.locator('#auto-login').check();
    await page.locator('#auto-submit').uncheck();
    await page.locator('#save').click();
    await page.waitForFunction(() => document.getElementById('toast').textContent === 'Options saved');
    const saved = await page.evaluate(() => chrome.storage.local.get(null));
    assert.equal(saved['kp-password-generator-prefs'].charset.length2, 0);
    assert.equal(saved['auto-login'], true);
    assert.equal(saved['auto-submit'], false);
    assert.equal(await page.locator('#auto-submit-auto-login').count(), 0);
    console.log('PASS options: canonical generator settings, zero symbols, live autofill settings, removed dead controls');
    await page.evaluate(() => chrome.storage.session.set({'kp-save-form:42': {revision: 1, pending: true, url: 'https://example.test'}}));
    await page.goto(base + '/data/save/index.html?tab=42');
    await page.waitForFunction(() => document.getElementById('gen-panel').dataset.mode === 'charset');
    assert.equal(await page.locator('[name=password]').inputValue(), '');
    assert.equal(await page.locator('[data-cmd=save]').isDisabled(), true);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--kmh-smoke-style').trim()), 'applied');
    await page.evaluate(() => chrome.storage.session.set({'kp-save-form:42': {revision: 1, url: 'https://example.test', pairs: [{usernames: ['fixture-user'], passwords: ['actual-fixture']}]}}));
    assert.equal(await page.locator('[name=password]').inputValue(), 'actual-fixture');
    await page.evaluate(() => chrome.storage.session.set({'kp-save-form:42': {revision: 2, pending: true, url: 'https://example.test/second'}}));
    await page.locator('[name=login]').fill('typed-fixture');
    await page.evaluate(() => chrome.storage.session.set({'kp-save-form:42': {revision: 2, url: 'https://example.test/second', pairs: [{usernames: ['scraped-fixture'], passwords: ['second-fixture']}]}}));
    assert.equal(await page.locator('[name=login]').inputValue(), 'typed-fixture');
    assert.equal(await page.locator('[name=password]').inputValue(), 'second-fixture');
    console.log('PASS save panel: pending, ready, repeat save, typed login preserved, saved CSS applied');
    await page.locator('[data-cmd=generate]').click();
    await page.locator('[data-cmd=gen-go]').click();
    const generated = await page.locator('[name=password]').inputValue();
    assert.match(generated, /^[XYZ]{9}$/);
    console.log('PASS generator: custom character pool and zero symbols reach the real UI');
    await page.evaluate(() => {
      const core = new KeePass();
      core.post = async () => ({Success: false, Error: 'synthetic-refused'});
      engine.prepare = async () => {engine.core = core;};
    });
    await page.locator('[data-cmd=save]').click();
    await page.waitForFunction(() => document.getElementById('status').textContent === 'synthetic-refused');
    assert.equal(await page.locator('[data-cmd=save]').isDisabled(), false);
    console.log('PASS save failure: rejected KeePassHTTP write stays visible and can be corrected');
    await page.goto(base + '/data/copy/index.html?id=00000000-0000-0000-0000-000000000000');
    await page.waitForFunction(() => window.__copied.length === 1);
    assert.equal(await page.evaluate(() => window.__copied[0]), 'synthetic-copy-fixture');
    assert.ok(!page.url().includes('synthetic-copy-fixture'));
    console.log('PASS copy page: fetches payload by token and copies without a secret in its URL');
    assert.deepEqual(errors, []);
    console.log('PASS real browser pages: no uncaught JavaScript errors');
  }
  finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
