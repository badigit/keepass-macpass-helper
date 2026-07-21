/* node --test tests/password-gen.test.js */
const test = require('node:test');
const assert = require('node:assert/strict');

const gen = require('../tools/password-gen.js');
const words = require('../tools/diceware-words.js');

test('EFF wordlist has exactly 7776 unique words', () => {
  assert.equal(words.length, 7776);
  assert.equal(new Set(words).size, 7776);
});

test('randomIndex stays in range and looks uniform-ish', () => {
  const n = 16;
  const counts = Array.from({length: n}, () => 0);
  const SAMPLES = 16000;
  for (let i = 0; i < SAMPLES; i += 1) counts[gen.randomIndex(n)] += 1;
  for (const c of counts) {
    // Each bucket should be within ±30% of the expected 1000 hits.
    assert.ok(c > 700 && c < 1300, `count ${c} skews too much`);
  }
});

test('randomIndex throws on bad n', () => {
  assert.throws(() => gen.randomIndex(0), RangeError);
  assert.throws(() => gen.randomIndex(-1), RangeError);
});

test('charset — default length is length1 + length2', () => {
  const pw = gen.charset();
  assert.equal(pw.length, 12);
});

test('charset — honors custom lengths and empty symbol pool', () => {
  const pw = gen.charset({length1: 8, length2: 0});
  assert.equal(pw.length, 8);
  assert.match(pw, /^[A-Za-z0-9]+$/);
});

test('charset — contains at least one symbol when length2 > 0', () => {
  // 50 runs make the false-negative probability vanishingly small.
  let sawSymbol = false;
  for (let i = 0; i < 50; i += 1) {
    if (/[!@#$%^&*()\-_+=]/.test(gen.charset({length1: 8, length2: 3}))) {
      sawSymbol = true;
      break;
    }
  }
  assert.ok(sawSymbol);
});

test('charset — first char is from charset1 (avoids leading symbols)', () => {
  for (let i = 0; i < 50; i += 1) {
    const pw = gen.charset({length1: 5, length2: 3});
    assert.match(pw[0], /[A-Za-z0-9]/);
  }
});

test('diceware — defaults to 5 capitalized words separated by hyphen plus digit and symbol', () => {
  const pw = gen.diceware();
  assert.match(pw, /\d[!@#$%^&*?\-_+=]$/);
  const parts = pw.slice(0, -2).split('-');
  assert.equal(parts.length, 5);
  for (const w of parts) {
    assert.match(w[0], /[A-Z]/);
    assert.ok(words.includes(w.toLowerCase()));
  }
});

test('diceware — explicit empty separator joins words without separators', () => {
  const pw = gen.diceware({
    wordCount: 3,
    separator: '',
    appendDigits: 0,
    appendSymbols: 0
  });
  assert.doesNotMatch(pw, /[-\s]/);
  assert.equal((pw.match(/[A-Z]/g) || []).length, 3);
});

test('diceware — custom separator + capitalize', () => {
  const pw = gen.diceware({
    wordCount: 4,
    separator: ' ',
    capitalize: true,
    appendDigits: 0,
    appendSymbols: 0
  });
  const parts = pw.split(' ');
  assert.equal(parts.length, 4);
  for (const w of parts) {
    assert.match(w[0], /[A-Z]/);
    assert.ok(words.includes(w.toLowerCase()));
  }
});

test('diceware — appendDigits adds a trailing digit block', () => {
  const pw = gen.diceware({
    wordCount: 3,
    separator: '-',
    capitalize: false,
    appendDigits: 4,
    appendSymbols: 0
  });
  const parts = pw.split('-');
  assert.equal(parts.length, 3);
  assert.match(parts[2], /^[a-z]+\d{4}$/);
});

test('diceware — appendSymbols adds trailing symbols after digits', () => {
  const pw = gen.diceware({
    wordCount: 3,
    separator: '-',
    appendDigits: 2,
    appendSymbols: 2,
    symbolPool: '@'
  });
  assert.match(pw, /\d{2}@@$/);
});

test('diceware — zero words yields empty string', () => {
  assert.equal(gen.diceware({wordCount: 0}), '');
});

test('diceware — different calls produce different passwords', () => {
  const a = gen.diceware();
  const b = gen.diceware();
  assert.notEqual(a, b);
});
