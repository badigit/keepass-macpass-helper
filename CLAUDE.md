# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KeePassHelper is a cross-browser WebExtension (Manifest v3) that integrates KeePass/KeePassXC password databases into the browser. It auto-fills credentials, generates passwords, saves new logins, and handles OTP codes. Supports Chrome, Firefox, Edge, and Opera.

## Build

```bash
./build.sh        # Creates keepass-helper.zip from repo root
```

No bundler, transpiler, or package manager — the extension ships raw JS files.

## Tests

Pure-JS modules (e.g. `data/hints/heuristics.js`) are covered by `node:test`
under `tests/`. No deps, just Node 18+:

```bash
node --test tests/hints-heuristics.test.js tests/form-context.test.js tests/password-gen.test.js
```

(`node --test tests/` without explicit files trips on Windows path globbing — pass the files individually.)

Anything that touches Chrome APIs or live DOM stays manual via browser extension
loading.

## Architecture

**Service Worker (`worker.js`)** — The background entry point. Handles context menus, content script registration, message routing between popup/content scripts, OTP generation, and Secure Synced Storage management. Lazily initializes the database connection on first use.

**Database Engine Layer (`connect/`):**
- `api.js` — Abstraction layer exposing `engine.prepare()`, `engine.search()`, `engine.set()`, `engine.asyncOTP()`. All backends implement this interface.
- `keepass/keepass.js` — KeePassHTTP protocol (AES-CBC encrypted HTTP)
- `keepassxc/keepassxc.js` — KeePassXC native messaging (NaCl public-key encryption)
- `kdbxweb/kdbxweb.js` — Local .kdbx file support (client-side decryption with Argon2/BLAKE2)
- `SecureSyncedDB.js` — Encrypted credential storage in `chrome.storage.sync` (AES-CBC-256)
- `totp.js` — TOTP/HOTP generator using WebCrypto HMAC-SHA1
- `otp-resolve.js` — Shared OTP field resolution logic used by both worker.js and popup

**UI & Content Scripts (`data/`):**
- `cmd/` — Main popup UI with `simple-list-view` web component for credential display
- `hints/inject.js` — Content script injected on all pages; creates a closed Shadow DOM autocomplete dropdown on input focus. Uses field detection heuristics (`isLoginField()`, `isOTPField()`, `isClearlyNonAuthField()`)
- `helper.js` — DOM utilities injected into pages: `extendedQuerySelectorAll()` (traverses shadow roots), `detectForm()` (intelligent form container detection), and `setInputValue()` (robust input setter for React/Vue controlled inputs)
- `options/` — Extension options page
- `save/` — Save new login form UI
- `safe/` — Encrypt/decrypt utility UI
- `passkey/` — WebAuthn passkey support

**Other:**
- `tools/tld.js` — Public suffix list for domain matching
- `_locales/` — i18n (en, de, es, fr, ja, it, nl, lv)

## Key Patterns

- **Vanilla JS, no frameworks** — ES6+ with async/await, classes for engines, web components for UI elements
- **Shadow DOM isolation** — Hints dropdown uses closed shadow root to avoid page CSS conflicts
- **Credential fill via `chrome.scripting.executeScript`** — Passwords never pass through content scripts; they are injected directly by the service worker
- **Four storage layers**: `localStorage` (prefs), `chrome.storage.local` (persistent), `chrome.storage.session` (ephemeral keys), `chrome.storage.sync` (encrypted synced credentials)
- **All crypto uses Web Crypto API** — AES-CBC, HMAC-SHA1, plus vendored noble/hashes for Argon2/BLAKE2

## OTP Field Resolution

OTP values are resolved from multiple possible entry fields in this priority: `KPH: otp`, `KPH:otp`, `otp`, `KPOTP`, `KPH: sotp` (encrypted), and built-in KeePass fields (`TimeOtp-Secret-Base32`, `TimeOtp-Period`, `TimeOtp-Length`). This logic lives in `connect/otp-resolve.js` (shared between worker and popup).

## Hints Report Policy

- This repository is public. Do not commit raw `missed` or `unwanted` hints JSON exports from real browsing sessions.
- Treat hint reports as sensitive because they can contain internal URLs, page titles, search text, and organization-specific field metadata.
- When adding or adjusting hints heuristics, document the rule boundary in `docs/hints-heuristics.md`.
- Use `docs/hints-report-flow.md` to sanitize new cases and classify them as `reliable`, `risky`, or `defer`.
- Only merge heuristics that are narrow, explainable, and supported by a repeatable pattern rather than a one-off site quirk.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
