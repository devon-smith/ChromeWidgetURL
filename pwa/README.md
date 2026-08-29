# Local Toby — iPhone PWA

A small mobile web app that reads your **Drive-synced** Local Toby library and
lets you **search, open, and add** links from your phone. It uses the **same
Google OAuth client** as the desktop extension, so `drive.file` gives it access
to the same `local-toby-library.json`.

## One-time setup

### 1. Allow the PWA's origin on your OAuth client
Google Cloud Console → **APIs & Services → Credentials →** open your existing
OAuth client (the one the extension uses) → under **Authorized JavaScript
origins** add:

```
https://devon-smith.github.io
```

Save. (No redirect URI needed — Google Identity Services uses the origin.)

### 2. Publish with GitHub Pages
Repo **Settings → Pages → Build and deployment → Deploy from a branch** →
pick this branch (or `main` after merge), folder **`/ (root)`** → Save.

Your PWA will be at:

```
https://devon-smith.github.io/ChromeWidgetURL/pwa/
```

(The repo root has a `.nojekyll` file so Pages serves the `src/` modules the PWA
imports.)

### 3. Install on iPhone
Open that URL in **Safari** → **Share → Add to Home Screen**. Launch it, tap
**Sign in with Google**, approve Drive access → your library loads.

### 4. Add links from the Share Sheet (iOS Shortcut)
Create a Shortcut named **"Save to Local Toby"**:

1. Shortcuts app → **+** → **Add Action** → *Receive* **URLs** from **Share Sheet**
   (enable "Show in Share Sheet" in the shortcut's settings; accept URLs).
2. Add **Text**:
   `https://devon-smith.github.io/ChromeWidgetURL/pwa/?add=[Shortcut Input URL]`
   (insert the Shortcut Input as the `add=` value; optionally append
   `&title=[Name]`).
3. Add **URL** (set to that Text) → **Open URLs**.

Now from any Safari page: **Share → Save to Local Toby** → the PWA opens with a
"Save this link to…" panel → pick a collection. It writes into the Drive file;
the desktop extension picks it up on its next sync.

## Notes
- Reuses the extension's pure modules (`../src/lib/dom.js`, `url-safe.js`,
  `sync-config.js`) — no duplication.
- Only talks to `accounts.google.com` (sign-in) and `www.googleapis.com` (Drive).
- Adding is safe against races: it re-downloads the latest file, appends, and
  uploads; the extension's by-id merge reconciles everything.
