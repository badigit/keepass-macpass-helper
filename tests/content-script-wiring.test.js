const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const manifest = require('../manifest.json');
const worker = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');
const inject = fs.readFileSync(path.join(root, 'data/hints/inject.js'), 'utf8');

test('manifest is the only persistent hints content-script registration', () => {
  assert.equal(manifest.content_scripts.length, 1);
  assert.doesNotMatch(worker, /chrome\.scripting\.registerContentScripts/);
  assert.match(worker, /unregisterContentScripts\(\{\s*ids: \['kp-hints'\]/);
});

test('extension update refresh uses every declarative hints script', () => {
  for (const file of manifest.content_scripts[0].js) {
    assert.match(worker, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(worker, /reason !== 'update'/);
  assert.match(worker, /allFrames: true/);
});

test('hints replace stale UI from a previous extension version', () => {
  assert.match(inject, /dependenciesReady && self\.__kpHintsInjected/);
  assert.match(inject, /__kpHintsInjected !== injectedVersion/);
  assert.match(inject, /querySelectorAll\('kp-hints-host'\)/);
  assert.match(inject, /dataset\.extensionVersion = injectedVersion/);
});
