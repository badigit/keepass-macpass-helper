# Hints Report Flow

This repository is public, so raw hint reports must not be committed as-is.
Use this flow to turn exported `missed` and `unwanted` reports into safe,
actionable heuristic changes.

## 1. Data Handling Rule

Never commit raw exported JSON from real browsing sessions.

Reason:
- Reports may contain internal URLs, titles, query text, CRM field ids, and
  other organization-specific metadata.

Allowed in repo:
- Sanitized examples
- Aggregated patterns
- Short case summaries
- Generic host/category labels

Not allowed in repo:
- Real hostnames or IPs
- Internal page titles
- Query text copied from placeholders if it reveals user/org data
- Raw form ids, app ids, or tokens

## 2. Sanitization Checklist

Before a case is documented in this repo, replace:

- `url` with a generic label such as `internal-grafana`, `public-github`, or
  `bank-login-spa`
- `title` with a functional description such as `user search page` or
  `2FA confirmation page`
- `placeholder` with either:
  - a generic semantic label like `search users`, `email contact field`,
    `verification code`
  - or the minimal safe fragment needed for the heuristic, such as `contains
    "search"` or `contains "login"`
- `id`, `name`, `className`, `formAction`, and `formId` with either:
  - a sanitized pattern summary like `ends with _label`
  - or a generic token like `crm_email_field`

Keep only attributes that are necessary to justify the rule.

## 3. Triage Decision Flow

For each new pattern, classify it into one of three buckets.

### Reliable

A heuristic is reliable when:
- the signal is explicit and local to the field
- the same pattern appears across multiple sites or products
- the fix can be described in one sentence without page-specific exceptions
- the likely blast radius is small and understandable

Typical examples:
- `otp` or `totp` in `name`/`id`
- `search`/`filter` markers in placeholder or field id
- `autocomplete="one-time-code"`

Action:
- implement the rule
- add a short comment in code if the motivation is not obvious
- document the case in `docs/hints-heuristics.md`

### Risky

A heuristic is risky when:
- it depends on page structure more than field metadata
- it works on one site but has unclear generality
- it requires broad fallback logic such as "small form with one text field"
- it may affect many normal text or email inputs

Action:
- do not merge a heuristic yet
- collect more examples
- document the pattern as "not auto-fixed yet"

### Defer

Defer when:
- the case contains too little signal
- the site is too custom or too sensitive to generalize from
- the safest possible fix is still likely to raise entropy elsewhere

Action:
- keep it out of code
- record only a sanitized note if it helps future clustering

## 4. Case Template

When a new cluster is worth tracking, add a short sanitized entry using this
shape:

```md
### Case: OTP field with underscore-separated name

Type:
- missed

Observed pattern:
- `name` or `id` contains `app_otp`, `app_totp`, or similar
- field type is `text`, `tel`, or `number`

Why it happens:
- current regex depends on word boundaries and misses `_otp`

Decision:
- reliable

Action:
- widen OTP token matching to treat non-alphanumeric separators as boundaries

Blast radius:
- low
```

## 5. Minimal Review Standard For Heuristic Changes

Before merging a heuristic change, confirm all of the following:

- The rule is tied to a named pattern, not just a single raw report.
- The rule can be explained in `docs/hints-heuristics.md`.
- The rule uses the narrowest signal that solves the case.
- There is an explicit note if similar-looking cases are intentionally excluded.
- No raw user or organization data was copied into code, docs, or commit text.

## 6. Recommended Working Loop

1. Export reports locally.
2. Cluster them by pattern, not by domain.
3. Write a sanitized case summary.
4. Classify as `reliable`, `risky`, or `defer`.
5. Only implement `reliable`.
6. Update `docs/hints-heuristics.md` with the motivation and boundary.
7. Keep the raw JSON outside the repository.
