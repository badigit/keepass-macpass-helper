const test = require('node:test');
const assert = require('node:assert/strict');

const {
  lookupUrlCandidates,
  searchWithUrlFallback,
  isLookupCandidate
} = require('../tools/url-lookup.js');

test('lookup candidates are exact-first and public-suffix-aware', () => {
  assert.deepEqual(
    lookupUrlCandidates('https://sso.login.example.co.uk/path?next=1'),
    [
      'https://sso.login.example.co.uk/path?next=1',
      'https://www.example.co.uk/',
      'https://example.co.uk/'
    ]
  );
});

test('lookup candidates do not cross registrable-domain boundaries', () => {
  const source = 'https://login.notexample.com/';
  assert.equal(isLookupCandidate(source, 'https://www.example.com/'), false);
  assert.equal(isLookupCandidate(source, 'https://www.notexample.com/'), true);
});

test('non-web and invalid URLs do not get fallback candidates', () => {
  assert.deepEqual(lookupUrlCandidates('chrome://settings/'), ['chrome://settings/']);
  assert.deepEqual(lookupUrlCandidates('not a URL'), ['not a URL']);
});

test('an exact result prevents all fallback requests', async () => {
  const calls = [];
  const result = await searchWithUrlFallback(async url => {
    calls.push(url);
    return {Entries: [{Uuid: 'exact', Login: 'alice'}]};
  }, 'https://sso.example.com/login');

  assert.deepEqual(calls, ['https://sso.example.com/login']);
  assert.equal(result.Entries[0].Login, 'alice');
  assert.deepEqual(result.Entries[0].__kpLookup, {
    url: 'https://sso.example.com/login',
    index: 0
  });
});

test('fallback merges KeePassHTTP, KeePassXC and local KDBX shapes stably', async () => {
  const calls = [];
  const responses = new Map([
    ['https://sso.example.com/login', []],
    ['https://www.example.com/', [
      {Uuid: 'http-1', Login: 'http-user', Password: 'one'},
      {uuid: 'xc-1', Login: 'xc-user', Password: 'two'}
    ]],
    ['https://example.com/', [
      {Uuid: 'http-1', Login: 'http-user', Password: 'one'},
      {Login: 'local-user', Name: 'Local', Password: 'three'}
    ]]
  ]);

  const result = await searchWithUrlFallback(async url => {
    calls.push(url);
    return {Entries: responses.get(url) || []};
  }, 'https://sso.example.com/login');

  assert.deepEqual(calls, [
    'https://sso.example.com/login',
    'https://www.example.com/',
    'https://example.com/'
  ]);
  assert.deepEqual(result.Entries.map(e => e.Login), [
    'http-user',
    'xc-user',
    'local-user'
  ]);
  assert.deepEqual(result.Entries[2].__kpLookup, {
    url: 'https://example.com/',
    index: 1
  });
});
