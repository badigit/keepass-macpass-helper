/* KeePass Helper — inline autocomplete dropdown (content script) */
if (!self.__kpHintsInjected) {
  self.__kpHintsInjected = true;

  const FIELD_RE = /user|login|email|name|account|логин|почта/i;
  const CACHE_TTL = 30000;

  let host = null;   // Shadow DOM host element
  let shadow = null;  // closed shadow root
  let list = null;    // <div> container for rows
  let entries = [];   // cached search results
  let cacheUrl = '';
  let cacheTime = 0;
  let activeField = null;
  let contextField = null;
  let selectedIdx = -1;
  let closeTimer = null;
  let suppressUntil = 0;

  const isLoginField = el => {
    if (!el || el.tagName !== 'INPUT') return false;
    const t = (el.type || '').toLowerCase();
    if (t === 'password' || t === 'email') return true;
    if (t === 'text' || t === 'tel' || t === '') {
      const hint = [
        el.name, el.id,
        el.getAttribute('autocomplete'),
        el.getAttribute('placeholder'),
        el.getAttribute('aria-label')
      ].filter(Boolean).join(' ');
      return FIELD_RE.test(hint);
    }
    return false;
  };
  const hasValue = el => Boolean(el && typeof el.value === 'string' && el.value.trim());

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
      .kp-empty {
        padding: 6px 10px;
        color: #999;
        text-align: center;
      }
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
    const item = entries[idx];
    if (!item) return;
    // Suppress immediate re-open when autofill shifts focus to password.
    suppressUntil = Date.now() + 2000;
    hide();
    chrome.runtime.sendMessage({
      cmd: 'hints-fill',
      index: item.originalIndex,
      url: location.href
    });
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
  const search = async url => {
    if (url === cacheUrl && Date.now() - cacheTime < CACHE_TTL) return entries;
    try {
      const r = await chrome.runtime.sendMessage({cmd: 'hints-search', url});
      entries = (r && r.entries) || [];
      cacheUrl = url;
      cacheTime = Date.now();
    }
    catch (e) {
      entries = [];
    }
    return entries;
  };

  const openForField = async el => {
    if (!isLoginField(el)) return;
    if (Date.now() < suppressUntil) return;
    if (hasValue(el)) {
      hide();
      return;
    }
    createHost();
    activeField = el;
    const items = await search(location.href);
    if (!activeField.isConnected) return;
    if (hasValue(activeField)) {
      hide();
      return;
    }
    render(items);
    show();
  };

  /* ---- Focus handler ---- */
  document.addEventListener('focusin', async e => {
    clearTimeout(closeTimer);
    await openForField(e.target);
  }, true);

  document.addEventListener('input', e => {
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

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.cmd === 'hints-open') {
      const target = contextField || document.activeElement;
      openForField(target).finally(() => sendResponse(true));
      return true;
    }
  });
}
