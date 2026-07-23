const assert = require('node:assert/strict');
const test = require('node:test');

const {isScriptableUrl} = require('../tools/scriptable-url.js');

test('browser-owned pages are not scriptable', () => {
  for (const url of [
    'chrome://extensions/',
    'edge://settings/',
    'about:blank',
    'view-source:https://example.test/',
    'chrome-extension://extension-id/page.html',
    'chrome-search://local-ntp/local-ntp.html',
    'devtools://devtools/bundled/inspector.html',
    'https://chromewebstore.google.com/detail/example/id',
    'https://chrome.google.com/webstore/detail/example/id'
  ]) {
    assert.equal(isScriptableUrl(url), false, url);
  }
});

test('ordinary web pages remain scriptable', () => {
  assert.equal(isScriptableUrl('https://example.test/login'), true);
  assert.equal(isScriptableUrl('http://localhost:3000/'), true);
});

test('missing URL is not scriptable', () => {
  assert.equal(isScriptableUrl(''), false);
  assert.equal(isScriptableUrl(undefined), false);
});
