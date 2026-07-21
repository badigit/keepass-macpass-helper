/* global engine, tldjs */
'use strict';

const args = new URLSearchParams(location.search);
const sessionKey = 'kp-save-form:' + (args.get('tab') || '');
const generatorPrefsKey = 'kp-password-generator-prefs';
const generatorDefaults = {
  mode: 'diceware',
  diceware: {
    wordCount: 5,
    separator: '-',
    capitalize: true,
    appendDigits: 1,
    appendSymbols: 1
  },
  charset: {
    length1: 14,
    length2: 3
  }
};

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

const currentGeneratorPrefs = () => ({
  mode: q('[name=gen-mode]').value,
  diceware: {
    wordCount: numberValue('[name=dw-count]', generatorDefaults.diceware.wordCount),
    separator: q('[name=dw-sep]').value,
    capitalize: q('[name=dw-cap]').checked,
    appendDigits: numberValue('[name=dw-digits]', generatorDefaults.diceware.appendDigits),
    appendSymbols: numberValue('[name=dw-symbols]', generatorDefaults.diceware.appendSymbols)
  },
  charset: {
    length1: numberValue('[name=cs-len1]', generatorDefaults.charset.length1),
    length2: numberValue('[name=cs-len2]', generatorDefaults.charset.length2)
  }
});

const applyGeneratorPrefs = prefs => {
  prefs = prefs || {};
  const diceware = {...generatorDefaults.diceware, ...prefs.diceware};
  const charset = {...generatorDefaults.charset, ...prefs.charset};
  const mode = prefs.mode === 'charset' || prefs.mode === 'diceware' ? prefs.mode : generatorDefaults.mode;
  if (diceware.separator == null) diceware.separator = generatorDefaults.diceware.separator;
  if (typeof diceware.capitalize !== 'boolean') diceware.capitalize = generatorDefaults.diceware.capitalize;
  q('[name=gen-mode]').value = mode;
  setNumber('[name=dw-count]', diceware.wordCount);
  q('[name=dw-sep]').value = diceware.separator;
  q('[name=dw-cap]').checked = diceware.capitalize;
  setNumber('[name=dw-digits]', diceware.appendDigits);
  setNumber('[name=dw-symbols]', diceware.appendSymbols);
  setNumber('[name=cs-len1]', charset.length1);
  setNumber('[name=cs-len2]', charset.length2);
  syncGeneratorMode();
};

const saveGeneratorPrefs = () => chrome.storage.local.set({
  [generatorPrefsKey]: currentGeneratorPrefs()
});

const syncGeneratorMode = () => {
  const mode = q('[name=gen-mode]').value;
  qa('.gen-fields').forEach(el => {
    el.hidden = el.dataset.mode !== mode;
  });
};

document.addEventListener('click', e => {
  const target = e.target.closest('[data-cmd]');
  if (!target) return;
  const cmd = target.dataset.cmd;

  if (cmd === 'cancel') {
    window.close();
  }
  else if (cmd === 'reset') {
    // Reset clears the form, then re-applies whatever the worker last stashed.
    q('[name=login]').value = '';
    q('[name=password]').value = '';
    loadPayload();
  }
  else if (cmd === 'toggle') {
    const next = target.dataset.type === 'password' ? 'text' : 'password';
    target.dataset.type = next;
    q('[name=password]').type = next;
  }
  else if (cmd === 'generate') {
    const panel = q('#gen-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      q('[name=gen-mode]').focus();
    }
  }
  else if (cmd === 'gen-close') {
    q('#gen-panel').hidden = true;
  }
  else if (cmd === 'gen-go') {
    runGenerator();
  }
  else if (cmd === 'trim' || cmd === 'domain') {
    const input = target.parentElement.querySelector('input[type=text]');
    try {
      const url = new URL(input.value);
      input.value = cmd === 'trim' ? url.origin : url.protocol + '//' + tldjs.getDomain(url.href);
      input.focus();
    }
    catch (err) {
      alert(err.message);
    }
  }
});

q('[name=gen-mode]').addEventListener('change', () => {
  syncGeneratorMode();
  saveGeneratorPrefs();
});
q('#gen-panel').addEventListener('input', saveGeneratorPrefs);
q('#gen-panel').addEventListener('change', saveGeneratorPrefs);

const runGenerator = () => {
  saveGeneratorPrefs();
  const mode = q('[name=gen-mode]').value;
  let pw;
  try {
    if (mode === 'diceware') {
      pw = self.__kpPasswordGen.diceware({
        wordCount: numberValue('[name=dw-count]', 3),
        separator: q('[name=dw-sep]').value,
        capitalize: q('[name=dw-cap]').checked,
        appendDigits: numberValue('[name=dw-digits]', 1),
        appendSymbols: numberValue('[name=dw-symbols]', 1)
      });
    }
    else {
      pw = self.__kpPasswordGen.charset({
        length1: +q('[name=cs-len1]').value || 14,
        length2: +q('[name=cs-len2]').value || 3
      });
    }
  }
  catch (err) {
    alert(err.message);
    return;
  }
  const field = q('[name=password]');
  field.value = pw;
  // Surface what we generated even when the field is still type=password.
  if (field.type === 'password') {
    const btn = q('[data-cmd=toggle]');
    btn.dataset.type = 'text';
    field.type = 'text';
  }
};

document.addEventListener('submit', e => {
  e.preventDefault();
  const submitter = e.submitter;
  if (!submitter) return;
  submitter.disabled = true;

  const formData = new FormData(e.target);
  const query = {};
  for (const [key, value] of formData.entries()) {
    if (key === 'url' || key === 'submiturl' || key === 'login' || key === 'password') {
      query[key] = value;
    }
  }

  chrome.storage.local.get({engine: 'keepass'}, async prefs => {
    try {
      await engine.prepare(prefs.engine);

      if (prefs.engine === 'kwpass') {
        await engine.core.open(prompt('Password to unlock the database?'));
      }

      if (submitter.dataset.cmd === 'ssdb') {
        if (!engine.ssdb) {
          throw new Error('Secure synced storage is not open. Use the popup interface to open it, then retry.');
        }
        const uuid = (await engine.ssdb.convert(query.url)).at(0);
        await engine.ssdb.append(uuid, {
          'Url': query.url,
          'SubmitUrl': query.submiturl,
          'Login': query.login,
          'Password': query.password
        });
      }
      else {
        await engine.set(query);
      }

      submitter.textContent = 'Saved ✓';
      setTimeout(() => window.close(), 1500);
    }
    catch (err) {
      console.warn(err);
      alert(err.message);
      submitter.disabled = false;
    }
  });
});

const renderPayload = payload => {
  payload = payload || {pairs: [], url: ''};
  const pair = (payload.pairs || [])
    .filter(a => a.usernames.length || a.passwords.length)
    .sort((a, b) => {
      if (a.usernames.length && a.passwords.length) return -1;
      if (b.usernames.length && b.passwords.length) return 1;
      return 0;
    })
    .shift();

  q('[name=url]').value = payload.url || '';
  q('[name=submiturl]').value = '';
  q('[name=login]').value = pair?.usernames.filter(s => s).shift() || '';
  q('[name=password]').value = pair?.passwords.filter(s => s).shift() || '';

  // Reset toggle state in case user reset after revealing password.
  const toggle = q('[data-cmd=toggle]');
  toggle.dataset.type = 'password';
  q('[name=password]').type = 'password';

  q('[name=url]').focus();
  q('[name=url]').select();
};

const loadPayload = async () => {
  if (!sessionKey) return renderPayload(null);
  const stash = await chrome.storage.session.get(sessionKey);
  renderPayload(stash[sessionKey]);
};
chrome.storage.local.get({[generatorPrefsKey]: generatorDefaults}, prefs => {
  applyGeneratorPrefs(prefs[generatorPrefsKey]);
});
loadPayload();

// Worker writes the scraped pairs asynchronously after the panel opens; pick
// them up here.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !sessionKey || !changes[sessionKey]) return;
  // Don't clobber what the user has typed: only refresh if login/password are
  // still empty (initial state or after Reset).
  const loginEmpty = !q('[name=login]').value;
  const passwordEmpty = !q('[name=password]').value;
  if (loginEmpty && passwordEmpty) {
    renderPayload(changes[sessionKey].newValue);
  }
});

addEventListener('keydown', e => {
  if (e.code === 'Escape') window.close();
});
