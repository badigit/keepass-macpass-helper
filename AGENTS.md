# Agent Notes

## Hints Reports

- Treat exported `missed` and `unwanted` hints reports as sensitive input.
- Do not commit raw JSON reports from real browsing sessions to this public repository.
- Before documenting a case, sanitize URLs, titles, placeholders, ids, names, class names, form ids, and actions.
- Store only sanitized summaries, pattern descriptions, and heuristic rationale in repo docs.

## Hints Heuristic Policy

- Add a new hints heuristic only when the signal is narrow, explainable, and likely to generalize.
- Prefer explicit field-local signals such as `autocomplete`, `name`, `id`, placeholder text, or stable OTP/search markers.
- Avoid broad page-specific fallbacks unless the same DOM pattern appears across multiple independent cases.
- For every merged heuristic, update `docs/hints-heuristics.md` with:
  - what pattern it covers
  - why it is considered reliable
  - what similar-looking cases are intentionally excluded

## Triage Flow

- Use `docs/hints-report-flow.md` for the privacy-safe triage flow.
- Classify each new pattern as `reliable`, `risky`, or `defer`.
- Only implement `reliable` patterns in code.
