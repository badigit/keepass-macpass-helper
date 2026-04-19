/* KeePass Helper — inline autocomplete dropdown (content script) */
if (!self.__kpHintsInjected) {
  self.__kpHintsInjected = true;

  const USER_RE = /user(name)?|login|email|e-?mail|account|signin|log.?in|логин|почта|аккаунт/i;
  // OTP reports showed that word-boundary matching misses names like "app_totp" and "sudo_app_otp".
  const OTP_RE = /(^|[^a-z0-9])(otp|2fa|totp|mfa|pin|код)([^a-z0-9]|$)|two.?factor|verification|one.?time|auth(?:entication)?\s?code/i;
  // Keep this list intentionally conservative: it exists to block known non-auth classes
  // such as search/filter fields and Bitrix selector inputs ending with "_label".
  const NON_AUTH_RE = /lang|language|locale|translation|translate|i18n|l10n|currency|timezone|time.?zone|city|country|address|comment|search|filter|query|find|lookup|title|description|command|directory|folder|поиск|фильтр|найти|искать|_label$|(?<!user)name$/i;
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
  const formState = new WeakMap();

  const positiveHintText = el => [
    el?.name,
    el?.id,
    el?.getAttribute?.('autocomplete'),
    el?.getAttribute?.('placeholder'),
    el?.getAttribute?.('aria-label')
  ].filter(Boolean).join(' ');

  const negativeHintText = el => [
    positiveHintText(el),
    el?.getAttribute?.('inputmode'),
    el?.getAttribute?.('pattern')
  ].filter(Boolean).join(' ');

  const isOTPField = el => {
    if (!el || el.tagName !== 'INPUT') return false;
    const t = (el.type || '').toLowerCase();
    if (!['text', 'tel', 'number', ''].includes(t)) return false;
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (autocomplete.includes('one-time-code')) return true;
    return OTP_RE.test(negativeHintText(el));
  };

  const isClearlyNonAuthField = el => {
    const hint = negativeHintText(el).toLowerCase();
    return NON_AUTH_RE.test(hint);
  };

  const isPasswordField = el => Boolean(el && el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'password');

  const isLoginField = el => {
    if (!el || el.tagName !== 'INPUT') return false;
    if (isClearlyNonAuthField(el)) return false;
    const t = (el.type || '').toLowerCase();
    if (isOTPField(el)) return true;
    if (t === 'password' || t === 'email') return true;
    if (t === 'text' || t === 'tel' || t === '') {
      const hint = positiveHintText(el);
      const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
      if (autocomplete.includes('username') || autocomplete.includes('current-password') || autocomplete.includes('new-password')) {
        return true;
      }
      if (USER_RE.test(hint)) {
        return true;
      }
      // email-like placeholder (e.g. "ivan@domain.ru") is a strong login signal
      const ph = (el.getAttribute('placeholder') || '');
      if (/\S+@\S+\.\S+/.test(ph)) return true;
      // login-first flows without password: single visible text-like input in the form
      const form = el.closest('form');
      if (form) {
        const action = (form.getAttribute('action') || '').toLowerCase();
        if (/search/.test(action)) return false;
        const visibles = [...form.querySelectorAll('input')].filter(i => i.offsetParent);
        const textLikes = visibles.filter(i => ['text', 'email', 'tel', ''].includes((i.type || '').toLowerCase()));
        if (textLikes.length <= 2 && visibles.some(i => (i.type || '').toLowerCase() === 'submit' || i.tagName === 'BUTTON')) {
          return true;
        }
      }
    }
    return false;
  };
  const hasValue = el => Boolean(el && typeof el.value === 'string' && el.value.trim());
  const normalizeLogin = value => String(value || '').trim().toLowerCase();

  const formContextRoot = el => {
    if (!el) return document.body;
    const form = el.closest('form');
    if (form) return form;

    let parent = el;
    for (let i = 0; i < 10; i += 1) {
      if (parent.parentElement) {
        parent = parent.parentElement;
      }
      else {
        const root = parent.getRootNode?.();
        if (root instanceof ShadowRoot && root.host) {
          parent = root.host;
        }
      }

      if (!parent) break;
      const hasPassword = parent.querySelector?.('input[type=password]');
      const hasTextLike = parent.querySelector?.('input[type=text],input[type=email],input[type=tel],input:not([type])');
      if (hasPassword || hasTextLike) {
        return parent;
      }
    }
    return document.body;
  };

  const getFormState = el => {
    const root = formContextRoot(el);
    let state = formState.get(root);
    if (!state) {
      state = {};
      formState.set(root, state);
    }
    return state;
  };

  const rememberLoginForField = (el, login) => {
    const normalized = normalizeLogin(login);
    if (!normalized) return;
    getFormState(el).preferredLogin = normalized;
  };

  const inferLoginFromForm = el => {
    const state = getFormState(el);
    if (state.preferredLogin) {
      return state.preferredLogin;
    }

    const root = formContextRoot(el);
    const inputs = [...root.querySelectorAll?.('input') || []].filter(input => input !== el && input.offsetParent);
    const userField = inputs.find(input => {
      const type = (input.type || '').toLowerCase();
      if (!['text', 'email', 'tel', ''].includes(type)) return false;
      return isLoginField(input) && !isPasswordField(input) && !isOTPField(input);
    });

    const value = normalizeLogin(userField?.value);
    if (value) {
      state.preferredLogin = value;
      return value;
    }
    return '';
  };

  const sortedEntriesForField = (items, el) => {
    if (!isPasswordField(el)) {
      return items.slice();
    }

    const preferredLogin = inferLoginFromForm(el);
    if (!preferredLogin) {
      return items.slice();
    }

    return items
      .map((entry, index) => {
        const login = normalizeLogin(entry.Login);
        let score = 0;
        if (login === preferredLogin) {
          score = 3;
        }
        else if (login.startsWith(preferredLogin) || preferredLogin.startsWith(login)) {
          score = 2;
        }
        else if (login.includes(preferredLogin) || preferredLogin.includes(login)) {
          score = 1;
        }
        return {entry, index, score};
      })
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(item => item.entry);
  };

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
        grid-template-columns: 2fr 1fr 1fr;
        gap: 8px;
        padding: 0 10px;
        height: 28px;
        align-items: center;
        cursor: default;
        white-space: nowrap;
        overflow: hidden;
      }
      .kp-row > span { overflow: hidden; text-overflow: ellipsis; }
      .kp-row:hover, .kp-row.active { background: #4875bf; color: #fff; }
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
        padding: 6px 10px;
        color: #999;
        text-align: center;
      }
      .kp-footer {
        display: flex;
        justify-content: space-between;
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
    list.style.left = r.left + 'px';
    list.style.top = (r.bottom + 2) + 'px';
    list.style.width = Math.max(r.width, 280) + 'px';
  };

  /* ---- Render entries ---- */
  const render = items => {
    createHost();
    if (!list) return;
    list.innerHTML = '';
    selectedIdx = -1;
    visibleEntries = items.slice();

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
      d.textContent = 'No credentials found';
      list.appendChild(d);
      return;
    }
    items.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = 'kp-row';
      row.dataset.index = e.originalIndex;

      const s1 = document.createElement('span');
      s1.textContent = e.Login;
      s1.title = e.Login;
      const s2 = document.createElement('span');
      s2.textContent = e.Name;
      s2.title = e.Name;
      const s3 = document.createElement('span');
      s3.textContent = e.group;
      s3.title = e.group;

      row.append(s1, s2, s3);
      list.appendChild(row);

      // mousedown fires before focusout — prevents dropdown from closing
      row.addEventListener('mousedown', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        pick(i);
      });
    });

    // Report "unwanted hint" footer
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
    reportBtn.textContent = '\u2717 not a login field';
    reportBtn.addEventListener('mousedown', ev => {
      ev.preventDefault();
      ev.stopPropagation();
      reportUnwanted();
      reportBtn.textContent = '\u2713 reported';
      reportBtn.classList.add('done');
    });
    left.appendChild(refreshBtn);
    footer.append(left, reportBtn);
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

  const reportUnwanted = () => {
    const meta = collectFieldMeta(activeField);
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

  const openForField = async (el, opts = {}) => {
    const force = opts.force === true;
    const refreshSearch = opts.refresh === true;
    if (!isLoginField(el)) return;
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
    closeTimer = setTimeout(hide, 150);
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
