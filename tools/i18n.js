/* Minimal declarative i18n for extension pages.
 *
 *   <span data-i18n="save_title"></span>          -> textContent
 *   <button data-i18n-title="save_hint"></button> -> title attribute
 *   <input data-i18n-placeholder="save_login">    -> placeholder attribute
 *
 * Keys live in _locales/<lang>/messages.json; Chrome picks the locale from
 * the browser UI language and falls back to manifest default_locale.
 * Missing keys keep whatever markup already has, so pages degrade to their
 * built-in English rather than to empty strings.
 */
(function (root) {
  'use strict';

  const t = (key, substitutions) => {
    try {
      return chrome.i18n.getMessage(key, substitutions) || '';
    }
    catch (e) {
      return '';
    }
  };

  const apply = (scope = document) => {
    for (const el of scope.querySelectorAll('[data-i18n]')) {
      const msg = t(el.dataset.i18n);
      if (msg) el.textContent = msg;
    }
    for (const el of scope.querySelectorAll('[data-i18n-title]')) {
      const msg = t(el.dataset.i18nTitle);
      if (msg) el.title = msg;
    }
    for (const el of scope.querySelectorAll('[data-i18n-placeholder]')) {
      const msg = t(el.dataset.i18nPlaceholder);
      if (msg) el.placeholder = msg;
    }
    const title = document.querySelector('title[data-i18n]');
    if (title) {
      const msg = t(title.dataset.i18n);
      if (msg) document.title = msg;
    }
  };

  root.__kpI18n = {t, apply};

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => apply(), {once: true});
  }
  else {
    apply();
  }
})(typeof self !== 'undefined' ? self : globalThis);
