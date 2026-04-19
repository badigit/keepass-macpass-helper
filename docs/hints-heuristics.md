# Hints Heuristics

This file tracks intentional heuristics for inline KeePass suggestions.
The goal is to keep the rules explainable: each rule should map to a concrete
class of reports and should be narrow enough to avoid increasing false positives.

Process note:
- New report triage and sanitization rules live in `docs/hints-report-flow.md`.

## Rules We Intentionally Support

### 1. OTP names with separators

Why:
GitHub-style fields such as `app_totp` and `sudo_app_otp` were reported as
missed because `\botp\b` and `\btotp\b` do not match across `_`.

Implementation:
- `data/hints/inject.js`: `OTP_RE`

Expected effect:
- OTP hints appear for fields whose `name` or `id` contains `otp`, `totp`,
  `mfa`, `2fa`, or `pin` separated by `_`, `-`, or other non-alphanumeric
  characters.

### 2. Search and filter fields should stay excluded

Why:
Search inputs can mention login/email in placeholder text, for example:
- Grafana user search: "Поиск пользователя по логину..."
- Bitrix selector controls with ids ending in `_label`

Implementation:
- `data/hints/inject.js`: `NON_AUTH_RE`

Expected effect:
- Search/filter/find fields stay excluded even if their placeholder mentions
  usernames, emails, or accounts.

### 3. Positive login detection should not rely on `inputmode` or `pattern`

Why:
General-purpose forms often use `inputmode="email"` or an email regex pattern
for contact fields. Those are weak signals outside auth forms and caused
unwanted hints in CRM/request forms.

Implementation:
- `data/hints/inject.js`: `positiveHintText()`
- `data/hints/inject.js`: `negativeHintText()`

Expected effect:
- `inputmode` and `pattern` can still help reject or classify fields, but they
  do not make a field look like a login on their own.

## Cases We Are Deliberately Not Auto-Fixing Yet

### SPA login-first pages without stable field metadata

Examples:
- `m.bcc.kz/prelogin`
- `sso.saby.ru/auth-online`

Why not yet:
- The inputs in these reports do not expose reliable login markers in `name`,
  `id`, `placeholder`, or `autocomplete`.
- Any broader fallback here would likely increase entropy across unrelated text
  and telephone fields.

What we would need first:
- A repeatable DOM pattern from several sites, not a single page-specific case.

### Password-only PIN fields

Example:
- `lk.sipout.net` with `type="password"` and `id="input_pin_code"`

Why not yet:
- Treating password fields with `pin` hints as non-password or OTP fields could
  easily break legitimate password-only login forms.
- This needs a dedicated rule with stronger surrounding context, not a regex
  tweak.
