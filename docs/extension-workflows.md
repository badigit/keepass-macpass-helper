# Shared extension workflows

## Entry saving

`worker.js:openSaveForm` owns opening and preparing a save request. Inline hints,
the context menu and the `save-form` keyboard command use this function.
The command handler passes the tab supplied by Chrome to preserve user activation.
There is one `sidePanel.open` call and no save-window fallback.

Each request writes a pending payload before preparing credentials. It publishes
the final payload only while it remains the latest request for that tab.
`tools/save-state.js` rejects older revisions and duplicate payloads. The panel
clears the previous request, waits for the final data and preserves individual
fields edited by the user. Empty pending data never triggers password generation.
Form scraping keeps each password inside its corresponding form.
`form-context.js:readLoginFromForm` reads a filled login for both inline actions
and menu/keyboard scraping. It preserves case, includes the initiating login field,
skips empty/hidden/OTP candidates and stays inside the selected form. The panel
orders its main fields as Login, Password, URL.

`KeePass.set` rejects responses without an explicit successful `Success` value.
This covers the save panel, passkey writes and UUID site linking, including direct
client calls. KeePassXC already rejects unsuccessful `set-login` responses.
Synced-storage writes propagate Chrome storage failures to the caller.

## Secure Synced Storage

The worker imports the same `Safe` implementation as extension pages.
`engine.prepare` catches constructor and key-import failures, clears an unusable
session key and continues preparing the selected backend. Crypto uses the existing
base64 representation of IV plus AES-CBC ciphertext, without `FileReader`.
Both old prefixed ciphertext and the previous decoder remain compatible.

## Clipboard fallback

The worker stores a temporary copy payload in `chrome.storage.session`.
The copy page receives only a random identifier in its URL. The worker checks the
requesting extension page and identifier, then removes the payload when consumed.
Payloads expire after two minutes. Worker startup removes expired payloads, and
failed window creation removes its payload immediately. The copy page retains
its received value locally so a user can retry a denied clipboard operation.
Selection-based clipboard fallbacks inside extension pages remain intentional.

## Preferences

`tools/password-prefs.js` owns generator defaults, loading and migration.
Options, the save panel, inline registration and the generator menu/shortcut use
`kp-password-generator-prefs` and `password-gen.js:generate`.
Migration preserves legacy character pools and zero symbol counts, gives existing
canonical values precedence, then removes the four obsolete generator keys.
The open panel accepts subsequent generator preference updates without replacing
the current password.

The save panel applies the existing `save-dialog-style` CSS setting.
The working popup `auto-login` and `auto-submit` settings remain available.
The unfinished JSON auto-login controls and disabled menu command were removed,
along with a stale permission handler targeting a missing element. Stored JSON
configuration is left intact.

## Verification

Run unit and integration fixtures with a deadline:

```powershell
node --test --test-timeout=10000 "tests/*.test.js"
npm run lint
```

Two manual smoke scripts require Playwright and an installed Chrome executable.
Set `KMH_PLAYWRIGHT` to an available Playwright module path when it is not installed
in the project. Set `KMH_CHROME` to the Chrome executable. Then run:

```powershell
node "tests/browser-smoke.cjs"
node "tests/extension-smoke.cjs"
```

`browser-smoke.cjs` runs real extension HTML with synthetic Chrome APIs and rejected
backend responses. `extension-smoke.cjs` loads the real unpacked extension through
CDP into a disposable Chrome profile, disables its backend and clicks the injected
registration action. It checks the actual side-panel context, matching generated
password and absence of a popup. It requires CDP `Extensions.loadUnpacked`.
Neither script opens the user's profile or connects to a real vault.

After bumping `manifest.json`, run `build.sh` and check archive contents against
the source files. Browser scripts have a 60-second process deadline.
