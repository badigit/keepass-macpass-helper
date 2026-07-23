/* KeePass Helper — inline autocomplete dropdown (content script).
 *
 * Field-detection heuristics live in data/hints/heuristics.js (loaded before
 * this file via manifest content_scripts) and are exposed as self.__kpHints. */
if (!self.__kpHintsInjected) {
  self.__kpHintsInjected = true;

  const {isOTPField, isPasswordField, isLoginField} = self.__kpHints;
  const {
    normalizeLogin,
    createFormStateStore,
    rememberLoginForField: rememberLoginForFieldImpl,
    sortedEntriesForField: sortedEntriesForFieldImpl
  } = self.__kpFormContext;
  const {
    STORAGE_KEY: IGNORED_FIELDS_STORAGE_KEY,
    MAX_IGNORED_FIELDS,
    ignoredFieldKey
  } = self.__kpIgnoredFields;
  const {dropdownLayout} = self.__kpHintsLayout;

  const CACHE_TTL = 30000;

  let host = null;   // Shadow DOM host element
  let shadow = null;  // closed shadow root
  let list = null;    // <div> container for rows
  let entries = [];   // cached search results
  let visibleEntries = []; // entries currently rendered in the dropdown
  let cacheUrl = '';
  let cacheTime = 0;
  let activeField = null;
  let contextField = null;
  let selectedIdx = -1;
  let closeTimer = null;
  let suppressUntil = 0;
  let manualQuery = '';
  let manualSearchTimer = null;
  let manualSearchSequence = 0;
  const formStateStore = createFormStateStore();
  let ignoredFields = new Set();

  const loadIgnoredFields = async () => {
    try {
      if (!chrome?.runtime?.id) return;
      const stored = await chrome.storage.local.get(IGNORED_FIELDS_STORAGE_KEY);
      const keys = stored[IGNORED_FIELDS_STORAGE_KEY];
      ignoredFields = new Set(Array.isArray(keys) ? keys.filter(key => typeof key === 'string') : []);
    }
    catch {}
  };
  const ignoredFieldsReady = loadIgnoredFields();

  const keyForField = el => ignoredFieldKey(el, location.origin);
  const isIgnoredField = el => ignoredFields.has(keyForField(el));
  const rememberIgnoredField = el => {
    const key = keyForField(el);
    if (!key || ignoredFields.has(key)) return;
    ignoredFields.add(key);
    const keys = [...ignoredFields].slice(-MAX_IGNORED_FIELDS);
    ignoredFields = new Set(keys);
    chrome.storage.local.set({[IGNORED_FIELDS_STORAGE_KEY]: keys}).catch(() => {});
  };

  const hasValue = el => Boolean(el && typeof el.value === 'string' && el.value.trim());
  const rememberLoginForField = (el, login) => rememberLoginForFieldImpl(formStateStore, el, login);
  const sortedEntriesForField = (items, el) => sortedEntriesForFieldImpl(items, el, formStateStore);

  /* ---- Shadow DOM setup ---- */
  const createHost = () => {
    if (host) return;
    host = document.createElement('kp-hints-host');
    host.style.cssText = 'position:absolute;z-index:2147483647;pointer-events:none;';
    shadow = host.attachShadow({mode: 'closed'});

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; font-family: system-ui, -apple-system, sans-serif; font-size: 13px; }
      .kp-dropdown {
        box-sizing: border-box;
        position: fixed;
        background: #333;
        color: #e3e2e2;
        border: 1px solid #555;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,.4);
        max-height: 196px;
        overflow-y: auto;
        pointer-events: auto;
        display: none;
        z-index: 2147483647;
      }
      .kp-dropdown.open { display: block; }
      .kp-row {
        display: grid;
        gap: 8px;
        padding: 0 8px;
        height: 28px;
        align-items: center;
        cursor: default;
        white-space: nowrap;
        overflow: hidden;
      }
      .kp-dropdown[data-columns="login"] .kp-row {
        grid-template-columns: minmax(0, 1fr);
      }
      .kp-dropdown[data-columns="login-name"] .kp-row {
        grid-template-columns: minmax(72px, 2fr) minmax(0, 3fr);
      }
      .kp-dropdown[data-columns="login-group"] .kp-row {
        grid-template-columns: minmax(72px, 3fr) minmax(0, 2fr);
      }
      .kp-dropdown[data-columns="login-name-group"] .kp-row {
        grid-template-columns: minmax(72px, 1.2fr) minmax(0, 2fr) minmax(0, 1fr);
      }
      .kp-row > span { overflow: hidden; text-overflow: ellipsis; }
      .kp-row:hover, .kp-row.active { background: #4875bf; color: #fff; }
      .kp-search {
        display: flex;
        position: sticky;
        top: 0;
        padding: 6px;
        background: #333;
        border-bottom: 1px solid #444;
        z-index: 1;
      }
      .kp-search input {
        box-sizing: border-box;
        width: 100%;
        border: 1px solid #666;
        border-radius: 3px;
        background: #222;
        color: #eee;
        font: inherit;
        padding: 5px 7px;
        outline: none;
      }
      .kp-search input:focus { border-color: #9ec1ff; }
      .kp-mode {
        display: flex;
        justify-content: flex-end;
        padding: 6px 8px 0 8px;
      }
      .kp-mode > span {
        font-size: 11px;
        line-height: 1;
        border: 1px solid #666;
        border-radius: 10px;
        padding: 2px 6px;
        color: #ddd;
      }
      .kp-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 8px 10px;
        color: #999;
        text-align: center;
      }
      .kp-empty-action {
        background: none;
        border: 1px solid #666;
        border-radius: 3px;
        color: #bbb;
        font-size: 11px;
        cursor: pointer;
        padding: 3px 8px;
      }
      .kp-empty-action:hover { color: #fff; border-color: #aaa; }
      .kp-footer {
        display: flex;
        justify-content: space-between;
        position: sticky;
        bottom: 0;
        background: #333;
        padding: 2px 6px;
        border-top: 1px solid #444;
      }
      .kp-footer-left {
        display: flex;
        gap: 6px;
      }
      .kp-footer-btn,
      .kp-report-btn {
        background: none;
        border: 1px solid transparent;
        border-radius: 3px;
        color: #888;
        font-size: 11px;
        cursor: pointer;
        padding: 2px 6px;
        line-height: 1;
      }
      .kp-footer-btn:hover { color: #9ec1ff; border-color: #9ec1ff; }
      .kp-report-btn:hover { color: #e55; border-color: #e55; }
      .kp-report-btn.done { color: #5a5; border-color: #5a5; pointer-events: none; }
    `;
    shadow.appendChild(style);

    list = document.createElement('div');
    list.className = 'kp-dropdown';
    shadow.appendChild(list);

    document.documentElement.appendChild(host);
  };

  /* ---- Position dropdown under the focused field ---- */
  const position = () => {
    if (!activeField || !list) return;
    const r = activeField.getBoundingClientRect();
    const viewportPadding = 8;
    const minWidth = Number(list.dataset.minWidth) || 280;
    const availableWidth = Math.max(0, window.innerWidth - viewportPadding * 2);
    const width = Math.min(Math.max(r.width, minWidth), availableWidth);
    const left = Math.min(
      Math.max(r.left, viewportPadding),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding)
    );
    list.style.left = left + 'px';
    list.style.top = (r.bottom + 2) + 'px';
    list.style.width = width + 'px';
  };

  /* ---- Render entries ---- */
  const render = items => {
    createHost();
    if (!list) return;
    list.innerHTML = '';
    selectedIdx = -1;
    visibleEntries = items.slice();
    const layout = dropdownLayout(items);
    list.dataset.columns = layout.key;
    list.dataset.minWidth = layout.minWidth;

    if (!items.length || manualQuery) {
      const searchWrap = document.createElement('div');
      searchWrap.className = 'kp-search';
      const searchInput = document.createElement('input');
      searchInput.type = 'search';
      searchInput.placeholder = 'Search KeePass by login, title or URL';
      searchInput.value = manualQuery;
      searchInput.setAttribute('aria-label', searchInput.placeholder);
      searchInput.addEventListener('mousedown', ev => ev.stopPropagation());
      searchInput.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Escape') {
          ev.preventDefault();
          activeField?.focus();
          hide();
        }
      });
      searchInput.addEventListener('input', () => {
        manualQuery = searchInput.value.trim();
        clearTimeout(manualSearchTimer);
        manualSearchTimer = setTimeout(runManualSearch, 250);
      });
      searchWrap.appendChild(searchInput);
      list.appendChild(searchWrap);
    }

    if (isOTPField(activeField)) {
      const mode = document.createElement('div');
      mode.className = 'kp-mode';
      const chip = document.createElement('span');
      chip.textContent = 'OTP';
      mode.appendChild(chip);
      list.appendChild(mode);
    }

    if (!items.length) {
      const d = document.createElement('div');
      d.className = 'kp-empty';
      const message = document.createElement('span');
      message.textContent = 'No credentials found';
      const ignoreBtn = document.createElement('button');
      ignoreBtn.className = 'kp-empty-action';
      ignoreBtn.textContent = 'Hide for this field';
      ignoreBtn.title = 'Do not show KeePass hints for this field on this site';
      ignoreBtn.addEventListener('mousedown', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        const field = activeField;
        rememberIgnoredField(field);
        reportUnwanted(field);
      });
      d.append(message, ignoreBtn);
      list.appendChild(d);
    }
    items.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = 'kp-row';
      row.dataset.index = e.originalIndex;

      for (const field of layout.fields) {
        const cell = document.createElement('span');
        cell.textContent = e[field] || '';
        cell.title = e[field] || '';
        row.appendChild(cell);
      }
      list.appendChild(row);

      // mousedown fires before focusout — prevents dropdown from closing
      row.addEventListener('mousedown', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        pick(i);
      });
    });

    // Persistently ignore this field on this site and also retain a diagnostic
    // report. The footer is deliberately rendered even for an empty result.
    const footer = document.createElement('div');
    footer.className = 'kp-footer';
    const left = document.createElement('div');
    left.className = 'kp-footer-left';
    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'kp-footer-btn';
    refreshBtn.textContent = 'Refresh';
    refreshBtn.addEventListener('mousedown', async ev => {
      ev.preventDefault();
      ev.stopPropagation();
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Refreshing...';
      await refresh();
    });
    const reportBtn = document.createElement('button');
    reportBtn.className = 'kp-report-btn';
    reportBtn.textContent = isOTPField(activeField) ? 'Hide for this field' : '\u2717 not a login field';
    reportBtn.title = 'Do not show KeePass hints for this field on this site';
    reportBtn.addEventListener('mousedown', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      const field = activeField;
      rememberIgnoredField(field);
      reportUnwanted(field);
    });
    left.appendChild(refreshBtn);
    footer.appendChild(left);
    if (items.length) footer.appendChild(reportBtn);
    list.appendChild(footer);
  };

  /* ---- Report unwanted hint trigger ---- */
  const collectFieldMeta = el => {
    if (!el) return {};
    const form = el.closest('form');
    return {
      tag: el.tagName,
      type: el.type || '',
      name: el.name || '',
      id: el.id || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      placeholder: el.getAttribute('placeholder') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      inputmode: el.getAttribute('inputmode') || '',
      pattern: el.getAttribute('pattern') || '',
      className: (el.className || '').toString().slice(0, 200),
      isOTP: isOTPField(el),
      formAction: form ? (form.action || '') : null,
      formId: form ? (form.id || '') : null,
      url: location.href,
      title: document.title,
      timestamp: new Date().toISOString()
    };
  };

  const reportUnwanted = field => {
    const meta = collectFieldMeta(field);
    meta.reportType = 'unwanted';
    hide();
    try {
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage({
        cmd: 'hints-report-unwanted',
        fieldMeta: meta
      }).catch(() => {});
    } catch (e) {}
  };

  /* ---- Show / hide ---- */
  const show = () => {
    createHost();
    position();
    list.classList.add('open');
  };
  const hide = () => {
    if (list) list.classList.remove('open');
    selectedIdx = -1;
  };

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[IGNORED_FIELDS_STORAGE_KEY]) return;
    const keys = changes[IGNORED_FIELDS_STORAGE_KEY].newValue;
    ignoredFields = new Set(Array.isArray(keys) ? keys.filter(key => typeof key === 'string') : []);
    if (activeField && isIgnoredField(activeField)) hide();
  });

  /* ---- Pick entry ---- */
  const pick = idx => {
    const item = visibleEntries[idx];
    if (!item) return;
    if (!isPasswordField(activeField) && !isOTPField(activeField)) {
      rememberLoginForField(activeField, item.Login);
    }
    // Suppress immediate re-open when autofill shifts focus to password.
    suppressUntil = Date.now() + 600;
    hide();
    try {
      // During extension reload/update the content-script context may be invalidated.
      if (!chrome?.runtime?.id) {
        return;
      }
      chrome.runtime.sendMessage({
        cmd: 'hints-fill',
        index: item.originalIndex,
        uuid: item.uuid,
        lookupUrl: item.lookupUrl,
        target: isOTPField(activeField) ? 'otp' : 'credentials',
        url: location.href
      }).catch(() => {});
    }
    catch (e) {}
  };

  /* ---- Keyboard navigation ---- */
  const onKeydown = e => {
    if (!list || !list.classList.contains('open')) return;
    const rows = list.querySelectorAll('.kp-row');
    if (!rows.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = (selectedIdx + 1) % rows.length;
      updateSelection(rows);
    }
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = (selectedIdx - 1 + rows.length) % rows.length;
      updateSelection(rows);
    }
    else if (e.key === 'Enter' && selectedIdx >= 0) {
      e.preventDefault();
      pick(selectedIdx);
    }
    else if (e.key === 'Escape') {
      e.preventDefault();
      hide();
    }
  };
  const updateSelection = rows => {
    rows.forEach((r, i) => r.classList.toggle('active', i === selectedIdx));
    if (rows[selectedIdx]) rows[selectedIdx].scrollIntoView({block: 'nearest'});
  };

  /* ---- Search with cache ---- */
  const search = async (url, opts = {}) => {
    const force = opts.force === true;
    if (!force && url === cacheUrl && Date.now() - cacheTime < CACHE_TTL) return entries;
    if (!chrome?.runtime?.id) {
      entries = [];
      return entries;
    }
    try {
      const r = await chrome.runtime.sendMessage({cmd: 'hints-search', url, force});
      if (r && r.ok === false) {
        entries = [];
        if (force) {
          cacheUrl = '';
          cacheTime = 0;
        }
        return entries;
      }
      entries = (r && r.entries) || [];
      cacheUrl = url;
      cacheTime = Date.now();
    }
    catch (e) {
      entries = [];
    }
    return entries;
  };

  const refresh = async () => {
    if (!activeField) return;
    await openForField(activeField, {
      force: true,
      refresh: true
    });
  };

  const runManualSearch = async () => {
    const query = manualQuery;
    const sequence = ++manualSearchSequence;
    if (!query) {
      render(sortedEntriesForField(entries, activeField));
      shadow.querySelector('.kp-search input')?.focus();
      return;
    }
    if (query.length < 2) {
      render([]);
      shadow.querySelector('.kp-search input')?.focus();
      return;
    }
    try {
      const r = await chrome.runtime.sendMessage({cmd: 'hints-manual-search', query});
      if (sequence !== manualSearchSequence || query !== manualQuery) return;
      const items = r?.ok ? (r.entries || []) : [];
      render(sortedEntriesForField(items, activeField));
      const input = shadow.querySelector('.kp-search input');
      if (input) {
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
    catch {
      if (sequence === manualSearchSequence) {
        render([]);
        shadow.querySelector('.kp-search input')?.focus();
      }
    }
  };

  const openForField = async (el, opts = {}) => {
    const force = opts.force === true;
    const refreshSearch = opts.refresh === true;
    if (!isLoginField(el)) return;
    await ignoredFieldsReady;
    if (isIgnoredField(el)) {
      if (el === activeField) hide();
      return;
    }
    if (!force && Date.now() < suppressUntil) return;
    if (!force && hasValue(el)) {
      hide();
      return;
    }
    createHost();
    activeField = el;
    const items = await search(location.href, {
      force: refreshSearch
    });
    manualQuery = '';
    if (!activeField.isConnected) return;
    if (hasValue(activeField)) {
      hide();
      return;
    }
    render(sortedEntriesForField(items, activeField));
    show();
  };

  /* ---- Focus handler ---- */
  document.addEventListener('focusin', async e => {
    clearTimeout(closeTimer);
    await openForField(e.target);
  }, true);

  document.addEventListener('input', e => {
    if (e.target && e.target.tagName === 'INPUT' && !isPasswordField(e.target) && !isOTPField(e.target)) {
      const value = normalizeLogin(e.target.value);
      if (value) {
        rememberLoginForField(e.target, value);
      }
    }
    if (e.target === activeField && hasValue(activeField)) {
      hide();
    }
  }, true);

  document.addEventListener('contextmenu', e => {
    const t = e.target;
    if (t && t.tagName === 'INPUT') {
      contextField = t;
    }
  }, true);

  /* ---- Close on focusout (with delay to allow row clicks) ---- */
  document.addEventListener('focusout', () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (host && document.activeElement === host) return;
      hide();
    }, 150);
  }, true);

  /* ---- Close on outside mousedown ---- */
  document.addEventListener('mousedown', e => {
    if (!list || !list.classList.contains('open')) return;
    // clicks inside shadow host are handled internally
    if (host && host.contains(e.target)) return;
    if (e.target === activeField) return;
    hide();
  }, true);

  /* ---- Keyboard ---- */
  document.addEventListener('keydown', onKeydown, true);

  /* ---- Reposition on scroll/resize ---- */
  window.addEventListener('scroll', position, true);
  window.addEventListener('resize', position, true);

  /* ---- Initial focus: field may already be focused before script loaded ---- */
  {
    const el = document.activeElement;
    if (el && el.tagName === 'INPUT') openForField(el);
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.cmd === 'hints-open') {
      const target = contextField || document.activeElement;
      openForField(target, {force: true}).finally(() => sendResponse(true));
      return true;
    }
    if (message && message.cmd === 'hints-report-missed') {
      const target = contextField || document.activeElement;
      const meta = collectFieldMeta(target);
      meta.reportType = 'missed';
      try {
        if (chrome?.runtime?.id) {
          chrome.runtime.sendMessage({
            cmd: 'hints-report-missed',
            fieldMeta: meta
          }).catch(() => {});
        }
      } catch (e) {}
      sendResponse(true);
    }
  });
}
