// Polyfills for engine scripts that reference window
self.window = self;
self.KWPASS = class {
  async prepare() {}
  async search() { return { Entries: [] }; }
  async set() { throw Error('Not_Supported'); }
};
self.kdbxweb = {};

importScripts(
  '/tools/tld.js',
  '/tools/url-lookup.js',
  '/connect/SecureSyncedDB.js',
  '/connect/api.js',
  '/connect/keepass/keepass.js',
  '/connect/keepassxc/nacl-fast.min.js',
  '/connect/keepassxc/keepassxc.js',
  '/connect/totp.js',
  '/connect/otp-resolve.js',
  // Single source of truth for field-detection regexes across content script,
  // service worker, and node tests. Exposes self.__kpHints.
  '/data/hints/heuristics.js',
  // Password generators (charset + diceware). Exposes self.__kpPasswordGen.
  '/tools/diceware-words.js',
  '/tools/password-gen.js'
);

const {searchWithUrlFallback, isLookupCandidate} = self.__kpUrlLookup;

const current = () => chrome.tabs.query({
  lastFocusedWindow: true,
  active: true,
  windowType: 'normal'
}).then(tbs => {
  if (tbs.length === 0) {
    return chrome.tabs.query({
      active: true,
      windowType: 'normal'
    }).then(tbs => tbs[0]);
  }
  return tbs[0];
});

const notify = async (tab, e, badge = 'E', color = '#d93025') => {
  tab = tab || await current();

  chrome.action.setBadgeText({
    tabId: tab.id,
    text: badge
  });
  chrome.action.setBadgeBackgroundColor({
    tabId: tab.id,
    color
  });
  chrome.action.setTitle({
    tabId: tab.id,
    title: e.message || e
  });

  clearTimeout(notify.id);
  notify.id = setTimeout(() => chrome.action.setBadgeText({
    tabId: tab.id,
    text: ''
  }), 3000);
};

// eslint-disable-next-line no-unused-vars
const storage = { // used by "associate"
  get(name) {
    try {
      return localStorage.getItem(name);
    }
    catch (e) {
      return undefined;
    }
  },
  set(name, value) {
    try {
      localStorage.setItem(name, value);
    }
    catch (e) {}
  },
  remote: o => new Promise(resolve => chrome.storage.local.get(o, resolve))
};

// Hints engine — lazy init, search without passwords
const hints = {
  ready: false,
  preparing: null,
  reset() {
    this.ready = false;
    this.preparing = null;
  },
  async ensureReady(force = false) {
    if (force) {
      this.reset();
    }
    if (!this.ready) {
      if (!this.preparing) {
        this.preparing = (async () => {
          const prefs = await storage.remote({engine: 'keepass'});
          await engine.prepare(prefs.engine);
          if (prefs.engine === 'keepass') {
            await engine.core.test(false);
          }
          else if (prefs.engine === 'keepassxc') {
            await engine.core['test-associate']();
          }
          this.ready = true;
        })().catch(e => {
          console.warn('hints engine:', e);
        }).finally(() => {
          this.preparing = null;
        });
      }
      await this.preparing;
    }
  },
  async searchExact(url, {force = false} = {}) {
    try {
      await this.ensureReady(force);
      if (!this.ready) {
        return {Entries: []};
      }
      return await engine.search({url});
    }
    catch (e) {
      this.reset();
      if (!force) {
        await this.ensureReady(true);
        if (this.ready) {
          return engine.search({url});
        }
      }
      throw e;
    }
  },
  async search(url, {force = false} = {}) {
    let first = true;
    return searchWithUrlFallback(candidate => {
      const candidateForce = force && first;
      first = false;
      return this.searchExact(candidate, {force: candidateForce});
    }, url);
  }
};

const entryOTP = entry => OTPResolve.get(entry);

const copy = async (content, tab) => {
  // Firefox
  try {
    await navigator.clipboard.writeText(content);
    notify(undefined, 'Done', '✓', 'green');
  }
  catch (e) {
    try {
      await chrome.scripting.executeScript({
        target: {
          tabId: tab.id
        },
        func: password => {
          navigator.clipboard.writeText(password).then(() => chrome.runtime.sendMessage({
            cmd: 'notify',
            message: 'Done',
            badge: '✓',
            color: 'green'
          })).catch(() => chrome.runtime.sendMessage({
            cmd: 'copy-interface',
            password
          }));
        },
        args: [content]
      });
    }
    catch (e) {
      copy.interface(content);
    }
  }
};
copy.interface = async content => {
  const win = await chrome.windows.getCurrent();
  chrome.windows.create({
    url: '/data/copy/index.html?content=' + encodeURIComponent(content),
    width: 400,
    height: 300,
    left: win.left + Math.round((win.width - 400) / 2),
    top: win.top + Math.round((win.height - 300) / 2),
    type: 'popup'
  });
};

// messaging
chrome.runtime.onMessage.addListener((request, sender, response) => {
  if (request.cmd === 'close-me') {
    chrome.scripting.executeScript({
      target: {
        tabId: sender.tab.id
      },
      func: () => {
        for (const e of document.querySelectorAll('dialog.kphelper')) {
          e.remove();
        }

        window.focus();
        try {
          window.aElement.focus();
        }
        catch (e) {
          document.activeElement.focus();
        }
      }
    });
  }
  else if (request.cmd === 'notify') {
    notify(undefined, request.message, request.badge, request.color);
  }
  else if (request.cmd === 'copy-interface') {
    copy.interface(request.password);
  }
  else if (request.cmd === 'native') {
    chrome.runtime.sendNativeMessage(request.id, request.request, response);
    return true;
  }
  else if (request.cmd === 'session-storage-get') {
    chrome.storage.session.get(request.prefs, response);
    return true;
  }
  else if (request.cmd === 'hints-search') {
    hints.search(request.url, {
      force: request.force === true
    }).then(r => {
      const entries = (r.Entries || []).map((e, i) => ({
        Login: e.Login || '',
        Name: e.Name || '',
        group: e.group || '',
        originalIndex: e.__kpLookup?.index ?? i,
        lookupUrl: e.__kpLookup?.url || request.url
      }));
      response({entries, ok: true});
    }).catch(e => {
      console.warn('hints-search:', e);
      response({
        entries: [],
        ok: false,
        error: e?.message || String(e)
      });
    });
    return true;
  }
  else if (request.cmd === 'hints-fill') {
    (async () => {
      try {
        const tab = sender.tab;
        const lookupUrl = isLookupCandidate(request.url, request.lookupUrl) ?
          request.lookupUrl : request.url;
        const r = await hints.searchExact(lookupUrl);
        const entry = (r.Entries || [])[request.index];
        if (!entry) {
          return;
        }
        if (request.target === 'otp') {
          const otp = await entryOTP(entry).catch(() => '');
          if (!otp) {
            return;
          }
          // Inject helper.js (setInputValue) and heuristics.js (isOTPField) into
          // the page. The heuristics file is also injected as a content script,
          // but content scripts live in the isolated world; we need __kpHints in
          // the main world so the executeScript func below can reach it.
          await chrome.scripting.executeScript({
            target: {tabId: tab.id},
            files: ['/data/helper.js', '/data/hints/heuristics.js']
          });
          await chrome.scripting.executeScript({
            target: {tabId: tab.id},
            func: otp => {
              const {isOTPField} = self.__kpHints;
              const active = document.activeElement;
              const candidates = [...document.querySelectorAll('input')].filter(e => e.offsetParent);
              const field = isOTPField(active) ? active : (candidates.find(isOTPField) || active);
              if (!field || field.tagName !== 'INPUT') return;
              self.setInputValue(field, otp);
            },
            args: [otp]
          });
          return;
        }
        const username = entry.Login || '';
        const password = entry.Password || '';

        // Inject helper.js (setInputValue/detectForm) and heuristics.js
        // (USER_RE) into the page's isolated world.
        await chrome.scripting.executeScript({
          target: {tabId: tab.id},
          files: ['/data/helper.js', '/data/hints/heuristics.js']
        });

        // Fill credentials via executeScript — password never touches content script
        await chrome.scripting.executeScript({
          target: {tabId: tab.id},
          func: (username, password) => {
            const {USER_RE} = self.__kpHints;
            const active = document.activeElement;
            // Find the form context
            const form = self.detectForm
              ? self.detectForm(active)
              : active.closest('form') || document;

            // Fill password
            const pwFields = [...form.querySelectorAll('input[type=password]')]
              .filter(e => e.offsetParent);
            for (const e of pwFields) {
              self.setInputValue(e, password);
            }

            // Fill username last: some SPAs overwrite username state when password changes.
            const userFields = [...form.querySelectorAll('input')].filter(e => {
              if (!e.offsetParent) {
                return false;
              }
              const t = (e.type || '').toLowerCase();
              return ['text', 'email', 'tel', 'search', 'url', 'number', ''].includes(t);
            });

            if (username && userFields.length) {
              const target = userFields.find(e => {
                const hint = e.name + ' ' + e.id + ' ' + (e.getAttribute('autocomplete') || '');
                return USER_RE.test(hint);
              }) || userFields[0];
              self.setInputValue(target, username);
            }
          },
          args: [username, password]
        });
      }
      catch (e) {
        console.warn('hints-fill:', e);
      }
    })();
  }
  else if (request.cmd === 'hints-report-unwanted') {
    (async () => {
      try {
        const {hintsUnwantedReports = []} = await chrome.storage.local.get('hintsUnwantedReports');
        hintsUnwantedReports.push(request.fieldMeta);
        // Keep last 500 reports max
        if (hintsUnwantedReports.length > 500) {
          hintsUnwantedReports.splice(0, hintsUnwantedReports.length - 500);
        }
        await chrome.storage.local.set({hintsUnwantedReports});
      }
      catch (e) {
        console.warn('hints-report-unwanted:', e);
      }
    })();
  }
  else if (request.cmd === 'hints-report-missed') {
    (async () => {
      try {
        const {hintsMissedReports = []} = await chrome.storage.local.get('hintsMissedReports');
        hintsMissedReports.push(request.fieldMeta);
        if (hintsMissedReports.length > 500) {
          hintsMissedReports.splice(0, hintsMissedReports.length - 500);
        }
        await chrome.storage.local.set({hintsMissedReports});
      }
      catch (e) {
        console.warn('hints-report-missed:', e);
      }
    })();
  }
});

// Context Menu
{
  const once = () => {
    if (once.done) {
      return;
    }
    once.done = true;

    chrome.contextMenus.create({
      id: 'generate-password',
      title: 'Generate a Random Password',
      contexts: ['action']
    }, () => chrome.runtime.lastError);
    chrome.contextMenus.create({
      id: 'save-form',
      title: 'Save a new Login Form in KeePass',
      contexts: ['action']
    }, () => chrome.runtime.lastError);
    chrome.contextMenus.create({
      id: 'hints-open',
      title: 'Show KeePass Suggestions',
      contexts: ['editable']
    }, () => chrome.runtime.lastError);
    chrome.contextMenus.create({
      id: 'hints-report-missed',
      title: 'Report: hint should appear here',
      contexts: ['editable']
    }, () => chrome.runtime.lastError);
    chrome.contextMenus.create({
      id: 'auto-login',
      title: 'Perform auto-login for this URL',
      contexts: ['action'],
      enabled: false
    }, () => chrome.runtime.lastError);
    chrome.contextMenus.create({
      id: 'encrypt-data',
      title: 'Encrypt or Decrypt a String',
      contexts: ['action']
    }, () => chrome.runtime.lastError);
    chrome.contextMenus.create({
      id: 'lock-secure-synced-storage',
      title: 'Lock Secure Synced Storage',
      contexts: ['action']
    }, () => chrome.runtime.lastError);
    if (/Firefox/.test(navigator.userAgent)) {
      chrome.contextMenus.create({
        id: 'open-options',
        title: 'Open Options Page',
        contexts: ['action']
      }, () => chrome.runtime.lastError);
    }
    else {
      chrome.contextMenus.create({
        id: 'open-keyboards',
        title: 'Keyboard Shortcut Settings',
        contexts: ['action']
      }, () => chrome.runtime.lastError);
    }
  };
  chrome.runtime.onInstalled.addListener(once);
  chrome.runtime.onStartup.addListener(once);
}

// Side panel is per-tab and opt-in: we enable it only after the "Save form"
// context menu sets up its payload. Manifest declares default_path so the API
// is available; this disables the global panel so the icon doesn't surface an
// empty form on tabs the user didn't trigger.
chrome.sidePanel?.setOptions?.({enabled: false}).catch(() => {});
chrome.tabs.onRemoved.addListener(tabId => {
  chrome.storage.session.remove('kp-save-form:' + tabId).catch(() => {});
});

// Register hints content script
{
  const registerHints = async () => {
    try {
      try {
        await chrome.scripting.unregisterContentScripts({ids: ['kp-hints']});
      }
      catch (e) {}
      await chrome.scripting.registerContentScripts([{
        id: 'kp-hints',
        matches: ['<all_urls>'],
        js: [
          '/data/hints/heuristics.js',
          '/data/hints/form-context.js',
          '/data/hints/ignored-fields.js',
          '/data/hints/inject.js'
        ],
        runAt: 'document_idle',
        allFrames: true
      }]);
    }
    catch (e) {
      console.warn('hints registration:', e);
    }
  };
  chrome.runtime.onInstalled.addListener(registerHints);
  chrome.runtime.onStartup.addListener(registerHints);
  registerHints();
}

// Pages we cannot script into: chrome://, edge://, the Chrome Web Store,
// view-source:, about:blank, and similar. Bail out with a friendly badge
// instead of letting chrome.scripting throw "Cannot access a chrome:// URL".
const RESTRICTED_URL_RE = /^(chrome|edge|about|view-source|chrome-extension|moz-extension|chrome-search|chrome-devtools|devtools):|^https?:\/\/chromewebstore\.google\.com/i;
const isScriptable = url => !!url && !RESTRICTED_URL_RE.test(url);

const onCommand = async (info, tab) => {
  tab = tab || await current();

  if (info.menuItemId === 'save-form') {
    if (!isScriptable(tab.url)) {
      notify(tab, 'Not available on this page', '–', '#888');
      return;
    }
    const target = {tabId: tab.id};
    const sessionKey = 'kp-save-form:' + tab.id;

    // sidePanel.open() must be called inside the same user-gesture turn — so
    // BEFORE any await. The panel will read storage.session on load and also
    // listen for changes; the heavy lifting (injecting helper, scraping form
    // fields) happens after, asynchronously.
    try {
      chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: '/data/save/index.html?tab=' + tab.id,
        enabled: true
      });
      chrome.sidePanel.open({tabId: tab.id}).catch(e => console.warn('sidePanel.open:', e));
    }
    catch (e) {
      console.warn('sidePanel setup:', e);
    }

    // Seed an empty payload so the side panel doesn't render with the URL of
    // an earlier tab if storage happens to be stale.
    chrome.storage.session.set({[sessionKey]: {pairs: [], url: tab.url}}).catch(() => {});

    try {
      await chrome.scripting.executeScript({
        target: {...target, allFrames: true},
        files: ['/data/helper.js']
      });

      // collect logins from all frames
      const r = await chrome.scripting.executeScript({
        target: {...target, allFrames: true},
        func: () => {
          const inputs = document.extendedQuerySelectorAll('input[type=password]');
          const forms = inputs
            .map(p => self.detectForm(p, 'input[type=text],input[type=email]'))
            .filter((f, i, l) => f && l.indexOf(f) === i);

          return forms.map(f => {
            const usernames = [
              ...f.extendedQuerySelectorAll('input[type=text]'),
              ...f.extendedQuerySelectorAll('input[type=email]')
            ].flat().map(e => e.value).filter(s => s);
            const passwords = inputs.map(e => e.value).filter(s => s);
            return {usernames, passwords};
          });
        }
      });
      const pairs = r.map(o => o.result).flat().filter(a => a);

      // Push final payload; storage.onChanged in the panel re-renders.
      await chrome.storage.session.set({[sessionKey]: {pairs, url: tab.url}});
    }
    catch (e) {
      console.warn(e);
      notify(tab, e);
    }
  }
  else if (info.menuItemId === 'open-options') {
    chrome.runtime.openOptionsPage();
  }
  else if (info.menuItemId === 'open-keyboards') {
    chrome.tabs.create({
      url: 'chrome://extensions/configureCommands'
    });
  }
  else if (info.menuItemId === 'encrypt-data') {
    if (!isScriptable(tab.url)) {
      notify(tab, 'Not available on this page', '–', '#888');
      return;
    }
    try {
      const target = {
        tabId: tab.id
      };
      await chrome.scripting.insertCSS({
        target,
        files: ['/data/safe/inject.css']
      });
      await chrome.scripting.executeScript({
        target,
        files: ['/data/safe/inject.js']
      });
    }
    catch (e) {
      notify(tab, e);
    }
  }
  else if (info.menuItemId === 'generate-password') {
    chrome.storage.local.get({
      'charset-1': 'qwertyuioplkjhgfdsazxcvbnmQWERTYUIOPLKJHGFDSAZXCVBNM1234567890',
      'charset-2': '!@#$%^&*()-_+=',
      'length-1': 10,
      'length-2': 2
    }, prefs => {
      const password = self.__kpPasswordGen.charset({
        charset1: prefs['charset-1'],
        charset2: prefs['charset-2'],
        length1: prefs['length-1'],
        length2: prefs['length-2']
      });
      copy(password, tab);
    });
  }
  else if (info.menuItemId === 'auto-login') {
    const {origin} = new URL(tab.url);
    chrome.storage.local.get({
      'json': []
    }, async prefs => {
      const o = prefs.json.filter(o => o.url.startsWith(origin)).shift();
      try {
        const r = await chrome.scripting.executeScript({
          target: {
            tabId: tab.id
          },
          func: (value = '') => {
            return prompt(`What is the username to match with KeePass database?

This username must exactly correspond to one of the credentials stored in your KeePass database for this URL.`, value);
          },
          args: [o?.username || '']
        });
        if (r[0].result) {
          if (o) {
            o.username = r[0].result;
          }
          else {
            prefs.json.push({
              url: origin,
              username: r[0].result
            });
          }
        }
        else {
          if (o) {
            const n = prefs.json.indexOf(o);
            prefs.json.splice(n, 1);
          }
        }
        chrome.storage.local.set(prefs);
      }
      catch (e) {
        console.warn(e);
        notify(tab, e);
      }
    });
  }
  else if (info.menuItemId === 'hints-open') {
    chrome.tabs.sendMessage(tab.id, {
      cmd: 'hints-open'
    }, {
      frameId: info.frameId || 0
    }, () => chrome.runtime.lastError);
  }
  else if (info.menuItemId === 'hints-report-missed') {
    chrome.tabs.sendMessage(tab.id, {
      cmd: 'hints-report-missed'
    }, {
      frameId: info.frameId || 0
    }, () => chrome.runtime.lastError);
  }
  else if (info.menuItemId === 'open-embedded') {
    const target = {
      tabId: tab.id
    };
    try {
      await chrome.scripting.insertCSS({
        target,
        files: ['/data/embedded/inject.css']
      });
      await chrome.scripting.executeScript({
        target,
        files: ['/data/embedded/inject.js']
      });
    }
    catch (e) {
      console.warn(e);
      notify(tab, e);
    }
  }
  else if (info.menuItemId === 'lock-secure-synced-storage') {
    chrome.storage.session.remove('ssdb-exported-key');
  }
};
chrome.contextMenus.onClicked.addListener(onCommand);
chrome.commands.onCommand.addListener(command => onCommand({
  menuItemId: command
}));

const icon = () => chrome.storage.session.get({
  'ssdb-exported-key': ''
}, prefs => {
  const b = Boolean(prefs['ssdb-exported-key']);

  chrome.action.setIcon({
    path: {
      '16': '/data/icons/' + (b ? 'ssdb/' : '') + '16.png',
      '32': '/data/icons/' + (b ? 'ssdb/' : '') + '32.png',
      '48': '/data/icons/' + (b ? 'ssdb/' : '') + '48.png'
    }
  });
});
chrome.runtime.onStartup.addListener(icon);
chrome.runtime.onInstalled.addListener(icon);

/* in KeePassXC mode check */
chrome.storage.onChanged.addListener(ps => {
  if (ps.engine) {
    hints.reset();

    if (ps.engine.newValue === 'keepassxc') {
      if (typeof chrome.runtime.sendNativeMessage === 'undefined') {
        chrome.runtime.reload();
      }
    }
  }
  if (ps['ssdb-exported-key']) {
    icon();
  }
});

/* FAQs & Feedback */
{
  const {management, runtime: {onInstalled, setUninstallURL, getManifest}, storage, tabs} = chrome;
  if (navigator.webdriver !== true) {
    const {homepage_url: page, name, version} = getManifest();
    onInstalled.addListener(({reason, previousVersion}) => {
      management.getSelf(({installType}) => installType === 'normal' && storage.local.get({
        'faqs': true,
        'last-update': 0
      }, prefs => {
        if (reason === 'install' || (prefs.faqs && reason === 'update')) {
          const doUpdate = (Date.now() - prefs['last-update']) / 1000 / 60 / 60 / 24 > 45;
          if (doUpdate && previousVersion !== version) {
            tabs.query({active: true, lastFocusedWindow: true}, tbs => tabs.create({
              url: page + '?version=' + version + (previousVersion ? '&p=' + previousVersion : '') + '&type=' + reason,
              active: reason === 'install',
              ...(tbs && tbs.length && {index: tbs[0].index + 1})
            }));
            storage.local.set({'last-update': Date.now()});
          }
        }
      }));
    });
    setUninstallURL(page + '?rd=feedback&name=' + encodeURIComponent(name) + '&version=' + version);
  }
}




