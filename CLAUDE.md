# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KeePassHelper is a cross-browser WebExtension (Manifest v3) that integrates KeePass/KeePassXC password databases into the browser. It auto-fills credentials, generates passwords, saves new logins, and handles OTP codes. Supports Chrome, Firefox, Edge, and Opera.

## Build

```bash
./build.sh        # Creates keepass-helper.zip from repo root
```

No bundler, transpiler, or package manager — the extension ships raw JS files. No test framework is configured; testing is manual via browser extension loading.

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
