/* KeePass Helper — pure field-detection heuristics.
 *
 * Loaded as a content script *before* data/hints/inject.js and also `require`-d
 * by tests/hints-heuristics.test.js. Must stay free of DOM-mutation side effects
 * and chrome.* APIs — only read-only checks against an element-like object.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  else {
    root.__kpHints = api;
  }
})(typeof self !== 'undefined' ? self : globalThis, function () {
  const USER_RE = /user(name)?|login|email|e-?mail|account|signin|log.?in|логин|почта|аккаунт/i;

  // OTP reports showed that word-boundary matching misses names like "app_totp" and "sudo_app_otp".
  const OTP_RE = /(^|[^a-z0-9])(otp|2fa|totp|mfa|pin|код)([^a-z0-9]|$)|two.?factor|verification|one.?time|auth(?:entication)?\s?code/i;

  // Keep this list intentionally conservative: it exists to block known non-auth classes
  // such as search/filter fields and Bitrix selector inputs ending with "_label".
  // Word boundaries are required: NON_AUTH_RE runs against className too, and
  // Tailwind/utility classes contain English substrings (opacity → "city",
  // container → "find", etc.) that would otherwise nuke legitimate login fields.
  const NON_AUTH_RE = /(?:^|[^\p{L}\p{N}_])(?:lang|language|locale|translation|translate|i18n|l10n|currency|timezone|time.?zone|city|country|address|comment|search|filter|query|find|lookup|title|description|command|directory|folder|поиск|фильтр|найти|искать)(?:[^\p{L}\p{N}_]|$)|_label(?:[^\p{L}\p{N}_]|$)|(?<!user)name$/iu;

  const PHONE_TEXT_RE = /phone|tel(?:ephone)?|номер\s+телефона|телефон/i;

  const EMAIL_PLACEHOLDER_RE = /\S+@\S+\.\S+/;

  const positiveHintText = el => [
    el?.name,
    el?.id,
    el?.getAttribute?.('autocomplete'),
    el?.getAttribute?.('placeholder'),
    el?.getAttribute?.('aria-label')
  ].filter(Boolean).join(' ');

  const negativeHintText = el => [
    positiveHintText(el),
    el?.className,
    el?.getAttribute?.('inputmode'),
    el?.getAttribute?.('pattern')
  ].filter(Boolean).join(' ');

  const isPasswordField = el =>
    Boolean(el && el.tagName === 'INPUT' && (el.type || '').toLowerCase() === 'password');

  const isOTPField = el => {
    if (!el || el.tagName !== 'INPUT') return false;
    const t = (el.type || '').toLowerCase();
    if (!['text', 'tel', 'number', ''].includes(t)) return false;
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (autocomplete.includes('one-time-code')) return true;
    return OTP_RE.test(negativeHintText(el));
  };

  const isClearlyNonAuthField = el => {
    const autocomplete = (el?.getAttribute?.('autocomplete') || '').toLowerCase();
    const placeholder = el?.getAttribute?.('placeholder') || '';
    // Some non-auth screens (e.g. CRM phone editor) ship `autocomplete="one-time-code"`
    // on a phone input. Trust the placeholder when it explicitly asks for a phone.
    if (autocomplete.includes('one-time-code') && PHONE_TEXT_RE.test(placeholder)) {
      return true;
    }
    return NON_AUTH_RE.test(negativeHintText(el).toLowerCase());
  };

  const isLoginField = el => {
    if (!el || el.tagName !== 'INPUT') return false;
    if (isClearlyNonAuthField(el)) return false;
    const t = (el.type || '').toLowerCase();
    if (isOTPField(el)) return true;
    if (t === 'password' || t === 'email') return true;
    if (t !== 'text' && t !== 'tel' && t !== '') return false;

    const hint = positiveHintText(el);
    const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
    if (
      autocomplete.includes('username') ||
      autocomplete.includes('current-password') ||
      autocomplete.includes('new-password')
    ) {
      return true;
    }
    if (USER_RE.test(hint)) return true;

    // Email-like placeholder (e.g. "ivan@domain.ru") is a strong login signal.
    const ph = el.getAttribute('placeholder') || '';
    if (EMAIL_PLACEHOLDER_RE.test(ph)) return true;

    // Login-first flows without a visible password field: a single text-like input
    // inside a form that has a submit button is almost always the login field.
    const form = el.closest?.('form');
    if (!form) return false;
    const action = (form.getAttribute?.('action') || '').toLowerCase();
    if (/search/.test(action)) return false;
    const visibles = [...(form.querySelectorAll?.('input') || [])].filter(i => i.offsetParent);
    const textLikes = visibles.filter(i => ['text', 'email', 'tel', ''].includes((i.type || '').toLowerCase()));
    const hasSubmit = visibles.some(i => (i.type || '').toLowerCase() === 'submit' || i.tagName === 'BUTTON');
    return textLikes.length <= 2 && hasSubmit;
  };

  return {
    USER_RE,
    OTP_RE,
    NON_AUTH_RE,
    PHONE_TEXT_RE,
    positiveHintText,
    negativeHintText,
    isPasswordField,
    isOTPField,
    isClearlyNonAuthField,
    isLoginField
  };
});
