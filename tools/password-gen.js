/* KeePass Helper — password generators.
 *
 * Two modes:
 *   - charset: classic alphanumeric + symbols pool, uniform random pick
 *   - diceware: N words from the EFF Large Wordlist, joined by a separator
 *
 * Both use crypto.getRandomValues with rejection sampling so the output is
 * unbiased even when the pool size doesn't divide 256/2^32 evenly. */
(function (root, factory) {
  const api = factory(
    root && root.__kpDicewareWords,
    root && root.crypto
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__kpPasswordGen = api;
})(typeof self !== 'undefined' ? self : globalThis, function (dicewareWords, cryptoApi) {
  const cryptoImpl = cryptoApi || (typeof crypto !== 'undefined' ? crypto : require('node:crypto').webcrypto);
  const wordlist = dicewareWords || (typeof require === 'function' ? require('./diceware-words.js') : null);

  /* Unbiased index in [0, n). Uses rejection sampling on Uint32. */
  const randomIndex = n => {
    if (n <= 0 || n > 0xffffffff) throw new RangeError('n out of range');
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / n) * n;
    while (true) {
      cryptoImpl.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % n;
    }
  };

  const pickFromString = pool => {
    if (!pool) throw new RangeError('empty character pool');
    return pool[randomIndex(pool.length)];
  };

  /* Fisher-Yates with cryptographic randomness. */
  const shuffle = arr => {
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = randomIndex(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  /* Classic generator. Picks `length1` chars from charset1 (typically
   * alphanumerics) and `length2` chars from charset2 (typically symbols),
   * concatenates, then shuffles everything except the first character — that
   * keeps the leading char predictable (alpha) which avoids breaking sites
   * that reject passwords starting with a symbol. */
  const charset = ({
    charset1 = 'qwertyuioplkjhgfdsazxcvbnmQWERTYUIOPLKJHGFDSAZXCVBNM1234567890',
    charset2 = '!@#$%^&*()-_+=',
    length1 = 10,
    length2 = 2
  } = {}) => {
    if (length1 + length2 <= 0) return '';
    const out = [];
    for (let i = 0; i < length1; i += 1) out.push(pickFromString(charset1));
    for (let i = 0; i < length2; i += 1) out.push(pickFromString(charset2));
    if (out.length <= 1) return out.join('');
    const [first, ...rest] = out;
    shuffle(rest);
    return [first, ...rest].join('');
  };

  const DEFAULT_SYMBOLS = '!@#$%^&*?-_+=';

  /* Diceware. Picks `wordCount` words uniformly from the EFF Large Wordlist
   * and joins them. Optionally capitalizes each word, appends N random
   * digits and N random symbols at the end (no separator before the tail —
   * just glued, the way most sites expect mixed-character passwords).
   *
   * Entropy: log2(7776) ≈ 12.92 bits per word. 5 capitalized words + 1 digit
   * + 1 symbol ≈ 78 bits. */
  const diceware = ({
    wordCount = 5,
    separator = '-',
    capitalize = true,
    appendDigits = 1,
    appendSymbols = 1,
    symbolPool = DEFAULT_SYMBOLS
  } = {}) => {
    if (!wordlist || wordlist.length !== 7776) {
      throw new Error('diceware wordlist not loaded');
    }
    if (wordCount <= 0) return '';
    const picks = [];
    for (let i = 0; i < wordCount; i += 1) {
      let w = wordlist[randomIndex(wordlist.length)];
      if (capitalize) w = w[0].toUpperCase() + w.slice(1);
      picks.push(w);
    }
    let out = picks.join(separator);
    for (let i = 0; i < appendDigits; i += 1) out += randomIndex(10);
    for (let i = 0; i < appendSymbols; i += 1) out += pickFromString(symbolPool);
    return out;
  };

  return {randomIndex, charset, diceware};
});
