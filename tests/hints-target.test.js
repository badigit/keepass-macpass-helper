const test = require('node:test');
const assert = require('node:assert/strict');

const {senderScriptTarget} = require('../tools/hints-target.js');

test('manual hint actions target the frame that sent the request', () => {
  assert.deepEqual(senderScriptTarget({tab: {id: 42}, frameId: 7}), {
    tabId: 42,
    frameIds: [7]
  });
});

test('top-level senders default to frame zero', () => {
  assert.deepEqual(senderScriptTarget({tab: {id: 42}}), {
    tabId: 42,
    frameIds: [0]
  });
});

test('messages without a browser tab cannot create a script target', () => {
  assert.equal(senderScriptTarget({}), null);
});
