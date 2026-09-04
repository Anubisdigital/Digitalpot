# Digitalpot

Encrypted secret notes inside Obsidian.

## What's here

- `manifest.json` — plugin metadata
- `src/crypto.ts` — AES-256-GCM + PBKDF2 (Web Crypto API, no dependencies)
- `src/data.ts` — data models (blocks, settings, history)
- `src/modals.ts` — password setup/unlock, lockout notice, edit confirmation, format editor, change-password
- `src/view.ts` — the note view: toolbar dropdown, block rendering, copy/edit/delete, key upload, history panel
- `src/main.ts` — plugin lifecycle: session unlock, lockout (20 attempts → 6 day lock), focus-blur privacy blur, password change / re-encrypting all notes
- `styles.css` — theme-aware (`var(--text-normal)` etc.), responsive down to mobile widths

Notes are `.dpot` files. On disk they're either:
- `{"encrypted":{"salt","iv","ciphertext","version"}}` when security is on, or
- plain JSON of the note data when security is off (you asked for a real "turn off security" option — this is what that looks like on disk; there's no way to be encrypted-at-rest and freely readable-without-password at the same time).

## One thing this cannot do

**True screenshot blocking (like WhatsApp) is not possible from an Obsidian plugin.** WhatsApp is a native app with OS-level screen-capture entitlements. Obsidian plugins run inside Obsidian's existing Electron/WebView sandbox with no such API, on desktop or mobile. What's implemented instead: when the Obsidian window loses focus (e.g. you switch to a screenshot tool, or the OS backgrounds the app), the secret content blurs and becomes unselectable until focus returns. That covers casual shoulder-surfing and some screenshot flows, but a determined user can still capture the screen while focused.

## Build (you'll need network access + Node.js, since sandboxed builds here can't fetch packages)

```bash
npm install
npm run build      # produces main.js
```

Then copy `manifest.json`, `main.js`, and `styles.css` into:

```
<your vault>/.obsidian/plugins/digitalpot/
```

Reload Obsidian (or toggle the plugin off/on in Settings → Community plugins) and enable Digitalpot.

## First run

1. Create a new Digitalpot note: Command palette → "New Digitalpot note" (or rename any file's extension to `.dpot`).
2. You'll be asked to set a password the first time you open a `.dpot` file.
3. After that, the password is asked once per Obsidian session — it stays unlocked until you close Obsidian, not per-note.
4. The dropdown top-left of the note (Digitalpot ▾) has all 7 items: Format, Head, Secret, Description, Upload key, History, Change password / security.

## What's simplified vs. your spec, worth knowing

- **Format menu** currently sets one style per block *type* (head/secret/description) rather than per individual block — matches "set each a custom font size/color/font" for the three categories. If you want per-block overrides on top of that, it's a small extension to `ContentBlock.style`.
- **Head toggle**: while on, new entries default to head style and get added as `head` blocks; turning it off returns to the type dropdown.
- **Lockout**: 20 wrong attempts locks Digitalpot for 6 days (`LOCKOUT_DURATION_MS` in `data.ts`) — this is enforced in plugin memory/settings, so it survives Obsidian restarts (stored in the plugin's `data.json`, unencrypted, since it must be checkable before you're unlocked).
