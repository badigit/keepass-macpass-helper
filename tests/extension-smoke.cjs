// Real unpacked extension in a disposable Chrome profile, with the backend disabled.
// Requires a browser supporting CDP Extensions.loadUnpacked and KMH_CHROME/KMH_PLAYWRIGHT.
const {chromium} = require(process.env.KMH_PLAYWRIGHT || 'playwright');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const deadline = setTimeout(() => {console.error('Extension smoke exceeded 60 seconds'); process.exit(1);}, 60000);
deadline.unref();
async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'kmh-extension-'));
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><form><input name="username" autocomplete="username" value="fixture-user"><input type="password" name="password" autocomplete="new-password"><button>Sign in</button></form>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: true, executablePath: process.env.KMH_CHROME,
      args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'], timeout: 15000
    });
    context.setDefaultTimeout(8000);
    const cdp = await context.browser().newBrowserCDPSession();
    const {id} = await cdp.send('Extensions.loadUnpacked', {path: path.resolve(__dirname, '..')});
    const control = await context.newPage();
    await control.goto('chrome-extension://' + id + '/data/options/index.html');
    await control.evaluate(() => chrome.storage.local.set({engine: 'none', faqs: false}));
    await Promise.race([
      control.evaluate(() => chrome.runtime.sendMessage({cmd: 'session-storage-get', prefs: {}})),
      new Promise((resolve, reject) => setTimeout(() => reject(Error('Worker did not answer within 8 seconds')), 8000))
    ]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.bringToFront();
    await page.locator('[name=password]').click();
    await page.locator('kp-hints-host').waitFor({state: 'attached'});
    // The hints intentionally use a closed shadow root. Read its box through
    // CDP, then deliver a real mouse click so user activation reaches Chrome.
    const dom = await context.newCDPSession(page);
    let footer = false;
    const findButton = node => {
      const attributes = node.attributes || [];
      const classIndex = attributes.indexOf('class');
      const isPrimary = classIndex >= 0 && attributes[classIndex + 1].split(' ').includes('kp-primary');
      const isNew = node.nodeName === 'BUTTON' && (node.children || []).some(child => child.nodeValue?.startsWith('+ '));
      if (footer ? isNew : isPrimary) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) {
        const found = findButton(child);
        if (found) return found;
      }
      return null;
    };
    const clickNew = async () => {
      let button;
      for (let attempt = 0; attempt < 30 && !button; attempt++) {
        button = findButton((await dom.send('DOM.getDocument', {depth: -1, pierce: true})).root);
        if (!button) await page.waitForTimeout(100);
      }
      assert.ok(button, 'registration action must appear in the closed hints shadow root');
      const {model} = await dom.send('DOM.getBoxModel', {backendNodeId: button.backendNodeId});
      await page.mouse.click((model.content[0] + model.content[2]) / 2, (model.content[1] + model.content[5]) / 2);
    };
    await clickNew();
    await page.waitForFunction(async () => {
      // The injected script stays alive after opening the real side panel.
      return document.querySelector('kp-hints-host') !== null;
    });
    let state;
    for (let attempt = 0; attempt < 30; attempt++) {
      state = await control.evaluate(async () => ({
        panels: await chrome.runtime.getContexts({contextTypes: ['SIDE_PANEL']}),
        storage: await chrome.storage.session.get(null),
        windows: await chrome.windows.getAll()
      }));
      if (state.panels.length && Object.values(state.storage).some(value => value?.pending === false)) break;
      await page.waitForTimeout(100);
    }
    assert.equal(state.panels.length, 1, 'real side panel must be open');
    assert.equal(state.windows.filter(window => window.type === 'popup').length, 0, 'no fallback popup');
    const payload = Object.entries(state.storage).find(([key]) => key.startsWith('kp-save-form:'))[1];
    assert.equal(payload.pending, false);
    assert.equal(payload.pairs[0].usernames[0], 'fixture-user');
    const generated = await page.locator('[name=password]').inputValue();
    assert.ok(generated.length > 10);
    assert.equal(payload.pairs[0].passwords[0], generated);
    assert.deepEqual(errors, []);
    console.log('PASS real extension: content-script click opens SIDE_PANEL with the matching tab payload and no popup');
    await page.locator('[name=password]').fill('');
    await page.locator('[name=username]').click();
    await page.locator('[name=password]').click();
    footer = true;
    await clickNew();
    let second;
    for (let attempt = 0; attempt < 30; attempt++) {
      second = await control.evaluate(() => chrome.storage.session.get(null));
      second = Object.entries(second).find(([key]) => key.startsWith('kp-save-form:'))[1];
      if (second.revision > payload.revision && second.pending === false) break;
      await page.waitForTimeout(100);
    }
    assert.ok(second.revision > payload.revision);
    assert.equal(second.pending, false);
    assert.equal(second.pairs[0].passwords[0], await page.locator('[name=password]').inputValue());
    assert.notEqual(second.pairs[0].passwords[0], generated);
    console.log('PASS real extension: footer New starts a fresh request and replaces the previous payload');
  }
  finally {
    await context?.close();
    await new Promise(resolve => server.close(resolve));
    const resolved = path.resolve(profile);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('kmh-extension-')) {
      await fs.rm(resolved, {recursive: true, force: true, maxRetries: 3});
    }
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
