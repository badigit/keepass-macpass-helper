/* global engine, tldjs */
'use strict';

const args = new URLSearchParams(location.search);
const sessionKey = 'kp-save-form:' + (args.get('tab') || '');
const {key: generatorPrefsKey, defaults: generatorDefaults} = self.__kpPasswordPrefs;
const targetPrefsKey = 'kp-save-target';
let generatorPrefs = self.__kpPasswordPrefs.normalize();
const payloadState = self.__kpSaveState.create();
let payloadReady = false;
let generatorReady = false;

const t = (key, subs) => self.__kpI18n?.t(key, subs) || '';
const q = sel => document.querySelector(sel);
const qa = sel => [...document.querySelectorAll(sel)];
const numberValue = (sel, fallback) => {
  const raw = q(sel).value.trim();
  if (raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};
const setNumber = (sel, value) => {
  q(sel).value = String(value);
};

/* ---------- status line (replaces alert()) ---------- */

let statusTimer;
const showStatus = (message, kind = '') => {
  clearTimeout(statusTimer);
  const el = q('#status');
  el.textContent = message;
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.hidden = !message;
};
const hideStatus = () => showStatus('');

/* ---------- URL modes ---------- */

// The address the worker scraped. Mode buttons always derive from it so the
// user can switch Full -> Domain -> Full without losing the path.
let originalUrl = '';
let urlMode = 'full';

const deriveUrl = (raw, mode) => {
  const url = new URL(raw);
  if (mode === 'origin') return url.origin;
  if (mode === 'domain') return url.protocol + '//' + (tldjs.getDomain(url.href) || url.hostname);
  return raw;
};
const setUrlMode = mode => {
  const source = originalUrl || q('[name=url]').value;
  try {
    q('[name=url]').value = deriveUrl(source, mode);
    urlMode = mode;
    hideStatus();
  }
  catch (e) {
    showStatus(t('save_error_invalid_url') || e.message, 'error');
    return;
  }
  qa('[data-cmd=url-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
};
const hostOf = raw => {
  try {
    return new URL(raw).host;
  }
  catch (e) {
    return '';
  }
};
const syncHost = () => {
  const host = hostOf(q('[name=url]').value);
  q('[name=title]').placeholder = host || t('save_field_title_placeholder');
};

/* ---------- generator ---------- */

const currentGeneratorPrefs = () => self.__kpPasswordPrefs.normalize({
  mode: q('#gen-panel').dataset.mode || generatorDefaults.mode,
  diceware: {
    wordCount: numberValue('[name=dw-count]', generatorDefaults.diceware.wordCount),
    separator: q('[name=dw-sep]').value,
    capitalize: q('[name=dw-cap]').checked,
    appendDigits: numberValue('[name=dw-digits]', generatorDefaults.diceware.appendDigits),
    appendSymbols: numberValue('[name=dw-symbols]', generatorDefaults.diceware.appendSymbols)
  },
  charset: {
    ...generatorPrefs.charset,
    length1: numberValue('[name=cs-len1]', generatorDefaults.charset.length1),
    length2: numberValue('[name=cs-len2]', generatorDefaults.charset.length2)
  }
});

const setGeneratorMode = mode => {
  q('#gen-panel').dataset.mode = mode;
  qa('.gen-fields').forEach(el => {
    el.hidden = el.dataset.mode !== mode;
  });
  qa('[data-cmd=gen-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
};

const applyGeneratorPrefs = prefs => {
  prefs = prefs || {};
  const diceware = {...generatorDefaults.diceware, ...prefs.diceware};
  const charset = {...generatorDefaults.charset, ...prefs.charset};
  const mode = prefs.mode === 'charset' || prefs.mode === 'diceware' ? prefs.mode : generatorDefaults.mode;
  if (diceware.separator == null) diceware.separator = generatorDefaults.diceware.separator;
  if (typeof diceware.capitalize !== 'boolean') diceware.capitalize = generatorDefaults.diceware.capitalize;
  setNumber('[name=dw-count]', diceware.wordCount);
  q('[name=dw-sep]').value = diceware.separator;
  q('[name=dw-cap]').checked = diceware.capitalize;
  setNumber('[name=dw-digits]', diceware.appendDigits);
  setNumber('[name=dw-symbols]', diceware.appendSymbols);
  setNumber('[name=cs-len1]', charset.length1);
  setNumber('[name=cs-len2]', charset.length2);
  setGeneratorMode(mode);
};

const saveGeneratorPrefs = () => chrome.storage.local.set({
  [generatorPrefsKey]: generatorPrefs = currentGeneratorPrefs()
});

const revealPassword = reveal => {
  const field = q('[name=password]');
  const btn = q('[data-cmd=toggle]');
  field.type = reveal ? 'text' : 'password';
  btn.dataset.type = field.type;
};

const runGenerator = () => {
  saveGeneratorPrefs();
  let pw;
  try {
    pw = self.__kpPasswordGen.generate(currentGeneratorPrefs());
  }
  catch (err) {
    showStatus(err.message, 'error');
    return;
  }
  q('[name=password]').value = pw;
  // Surface what we generated even when the field is still masked.
  revealPassword(true);
  hideStatus();
};

/* ---------- commands ---------- */

document.addEventListener('click', e => {
  const target = e.target.closest('[data-cmd]');
  if (!target) return;
  const cmd = target.dataset.cmd;

  if (cmd === 'cancel') {
    window.close();
  }
  else if (cmd === 'toggle') {
    revealPassword(target.dataset.type === 'password');
  }
  else if (cmd === 'generate') {
    const panel = q('#gen-panel');
    panel.hidden = !panel.hidden;
    target.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) {
      q('[data-cmd=gen-go]').focus();
    }
  }
  else if (cmd === 'gen-close') {
    q('#gen-panel').hidden = true;
    q('[data-cmd=generate]').setAttribute('aria-expanded', 'false');
  }
  else if (cmd === 'gen-mode') {
    payloadState.edit('password');
    setGeneratorMode(target.dataset.mode);
    runGenerator();
  }
  else if (cmd === 'copy') {
    const value = q('[name=password]').value;
    if (!value) return;
    const done = () => {
      showStatus(t('save_status_copied') || 'Copied', 'ok');
      statusTimer = setTimeout(hideStatus, 1500);
    };
    navigator.clipboard.writeText(value).then(done).catch(() => {
      // Async clipboard needs a focused document; fall back to the legacy
      // selection-based copy, which works from a button click regardless.
      const field = q('[name=password]');
      const wasMasked = field.type === 'password';
      if (wasMasked) field.type = 'text';
      field.select();
      const ok = document.execCommand('copy');
      if (wasMasked) field.type = 'password';
      field.blur();
      ok ? done() : showStatus('Clipboard unavailable', 'error');
    });
  }
  else if (cmd === 'gen-go') {
    payloadState.edit('password');
    runGenerator();
  }
  else if (cmd === 'url-mode') {
    payloadState.edit('url');
    setUrlMode(target.dataset.mode);
    syncHost();
  }
});

q('#gen-panel').addEventListener('input', saveGeneratorPrefs);
q('#gen-panel').addEventListener('change', saveGeneratorPrefs);
q('[name=url]').addEventListener('input', () => {
  // Manual edits detach from the scraped address; mode buttons then work on
  // whatever the user typed.
  originalUrl = '';
  qa('[data-cmd=url-mode]').forEach(b => b.classList.remove('active'));
  syncHost();
});
q('[name=target]').addEventListener('change', e => {
  chrome.storage.local.set({[targetPrefsKey]: e.target.value});
});
qa('input[required]').forEach(el => el.addEventListener('blur', () => el.classList.add('touched')));

/* ---------- submit ---------- */

const collect = () => {
  const value = name => q('[name=' + name + ']').value.trim();
  const query = {
    url: value('url'),
    login: value('login'),
    password: q('[name=password]').value
  };
  // Optional fields are only sent when filled: the KeePassHTTP client encrypts
  // every listed field and drops empty ones, KeePassXC and kdbxweb ignore
  // what they do not know.
  for (const name of ['title', 'submiturl', 'group', 'notes']) {
    const v = value(name);
    if (v) query[name] = v;
  }
  return query;
};

document.addEventListener('submit', e => {
  e.preventDefault();
  if (!payloadReady) return;
  const form = e.target;
  qa('input[required]').forEach(el => el.classList.add('touched'));
  if (!form.checkValidity()) {
    form.querySelector(':invalid')?.focus();
    return;
  }
  const button = q('[data-cmd=save]');
  const target = q('[name=target]').value;
  const query = collect();

  button.disabled = true;
  showStatus(t('save_status_saving') || 'Saving…');

  chrome.storage.local.get({engine: 'keepass'}, async prefs => {
    try {
      const backend = target === 'ssdb' ? 'none' : prefs.engine;
      await engine.prepare(backend);

      if (backend === 'kwpass') {
        await engine.core.open(prompt(t('save_error_password_prompt') || 'Password to unlock the database?'));
      }

      if (target === 'ssdb') {
        if (!engine.ssdb) {
          throw new Error(t('save_error_ssdb_closed') || 'Secure synced storage is not open.');
        }
        const uuid = (await engine.ssdb.convert(query.url)).at(0);
        await engine.ssdb.append(uuid, {
          'Url': query.url,
          'SubmitUrl': query.submiturl,
          'Login': query.login,
          'Password': query.password,
          'Name': query.title,
          'Notes': query.notes
        });
      }
      else {
        await engine.set(query);
      }

      showStatus(t('save_status_saved') || 'Saved', 'ok');
      setTimeout(() => window.close(), 1200);
    }
    catch (err) {
      console.warn(err);
      showStatus(err.message, 'error');
      button.disabled = false;
    }
  });
});

/* ---------- payload from the worker ---------- */

const renderPayload = payload => {
  if (!generatorReady) return;
  const update = payloadState.accept(payload);
  if (!update) return;
  if (update.reset) {
    for (const name of ['title', 'url', 'submiturl', 'login', 'password', 'group', 'notes']) {
      q('[name=' + name + ']').value = '';
    }
    q('#favicon').hidden = true;
    revealPassword(false);
    hideStatus();
  }
  payloadReady = update.phase === 'ready';
  q('[data-cmd=save]').disabled = !payloadReady;
  if (payloadState.canFill('url')) {
    originalUrl = payload.url || '';
    q('[name=url]').value = originalUrl;
  }
  if (!payloadReady) {
    if (payload.error) showStatus(payload.error, 'error');
    syncHost();
    return;
  }
  const pair = (payload.pairs || [])
    .filter(a => a.usernames.length || a.passwords.length)
    .sort((a, b) => {
      if (a.usernames.length && a.passwords.length) return -1;
      if (b.usernames.length && b.passwords.length) return 1;
      return 0;
    })
    .shift();

  if (payloadState.canFill('login')) q('[name=login]').value = pair?.usernames.filter(s => s).shift() || '';
  if (payloadState.canFill('password')) q('[name=password]').value = pair?.passwords.filter(s => s).shift() || '';

  const favicon = q('#favicon');
  if (payload.favicon && /^https?:/.test(payload.favicon)) {
    favicon.src = payload.favicon;
    favicon.hidden = false;
  }
  else {
    favicon.hidden = true;
  }

  revealPassword(false);
  if (payloadState.canFill('url')) setUrlMode(originalUrl ? 'origin' : 'full');
  syncHost();

  // Nothing scraped from the page: this is a sign-up, offer a fresh password
  // right away instead of an empty field.
  if (!q('[name=password]').value && payloadState.canFill('password')) {
    runGenerator();
  }

  const focusTarget = q('[name=login]').value ? q('[name=password]') : q('[name=login]');
  focusTarget.focus();
};

const loadPayload = async () => {
  if (!sessionKey) return renderPayload(null);
  const stash = await chrome.storage.session.get(sessionKey);
  if (stash[sessionKey]) renderPayload(stash[sessionKey]);
};

// Generator prefs must be applied before the first payload render, otherwise
// the auto-generated password would ignore the saved mode and lengths.
q('[data-cmd=save]').disabled = true;
document.addEventListener('input', e => {
  if (e.target.name) payloadState.edit(e.target.name);
});
const customStyle = localStorage.getItem('save-dialog-style');
if (customStyle) {
  const style = document.createElement('style');
  style.textContent = customStyle;
  document.head.appendChild(style);
}
Promise.all([
  self.__kpPasswordPrefs.load(chrome.storage.local),
  chrome.storage.local.get({[targetPrefsKey]: 'keepass'})
]).then(([generator, prefs]) => {
  generatorPrefs = generator;
  applyGeneratorPrefs(generator);
  q('[name=target]').value = prefs[targetPrefsKey] === 'ssdb' ? 'ssdb' : 'keepass';
  generatorReady = true;
  return loadPayload();
}).catch(err => showStatus(err.message, 'error'));

// Worker writes the scraped pairs asynchronously after the panel opens; pick
// them up here without clobbering what the user already typed.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[generatorPrefsKey] && generatorReady) {
    generatorPrefs = self.__kpPasswordPrefs.normalize(changes[generatorPrefsKey].newValue);
    applyGeneratorPrefs(generatorPrefs);
    return;
  }
  if (area !== 'session' || !sessionKey || !changes[sessionKey]) return;
  renderPayload(changes[sessionKey].newValue);
});

addEventListener('keydown', e => {
  if (e.code === 'Escape') window.close();
});
