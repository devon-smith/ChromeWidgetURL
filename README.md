# Local Toby — Tab Collections

A **local-first** rebuild of the Toby tab manager as an unpacked Manifest V3
Chrome extension. Save the tabs you have open into named **collections** grouped
into **spaces**, close them to reclaim memory, and restore them later — in order,
into a new window.

There is **no account, no cloud, no backend**. Every byte lives in
`chrome.storage.local` on your machine, and a complete JSON **export/import** is
your backup. That's the whole point: no storage-limit ceiling, no sync service to
depend on.

> This is an independent, from-scratch implementation. It ships its own icons,
> CSS, and code, and stores no data off-device.

---

## Features

- **Save all open tabs** in a window to a new collection — one click / one shortcut.
- **Save & close** — writes the collection first, then closes the tabs to free RAM,
  with an 8-second **Undo** that reopens them and removes the collection.
- **Save a single tab** (popup, context menu, keyboard) to any collection.
- **Restore** a whole collection into a new window (order preserved, pinned tabs
  re-pinned) or open individual cards.
- **Live Open Tabs panel** that mirrors your browser in real time and flags
  **duplicates** and **already-saved** tabs.
- **Spaces** (workspaces) → **Collections** → **cards**, with **drag & drop** to
  reorder and move between collections/spaces.
- **Search** across everything (with match highlighting) and **tags** — add/assign
  tags on any card and **filter** by them (AND/OR).
- **Bulk multi-select** in the Open Tabs panel and in collections (save / move /
  tag / close many at once) and **auto-suggested** save targets by domain.
- **Export / import** the whole library as one JSON file.
- **Optional Google Drive sync** across devices — into *your own* Drive (a single
  `local-toby-library.json`, scope `drive.file`), with tombstone-based deletion
  propagation and last-write-wins merge. Opt-in; nothing touches the network
  until you connect.
- **Light / dark / system** theme.
- Strict, **network-free** security model (see below).

## Install (load unpacked)

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this project folder
   (`ChromeWidgetURL/`, the one containing `manifest.json`).
4. Pin the coral **Local Toby** icon. Click it for the popup, or press
   **Ctrl/Cmd+Shift+O** to open the dashboard.

After editing any source file, return to `chrome://extensions` and click the
**reload ↻** icon on the Local Toby card (manifest and service-worker changes
require a reload).

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl/Cmd + Shift + O` | Open the dashboard |
| `Ctrl/Cmd + Shift + S` | Save the current tab |
| *(unbound)* | Save all tabs in the window — assign at `chrome://extensions/shortcuts` |

In the dashboard: `/` focus search · `n` new collection · `t` toggle Open Tabs
panel · `[` / `]` toggle sidebar · `Esc` clear search.

## Use Local Toby as your new tab page (optional)

The main extension **never** takes over your new tab page. If you want that
Toby-like experience, load the tiny companion in `companion-newtab/` as a second
unpacked extension:

1. `chrome://extensions` → **Load unpacked** → select `companion-newtab/`.
2. Open a new tab. Paste your **Local Toby** extension ID (shown on its card at
   `chrome://extensions`) once, and save.
3. Every new tab now opens your dashboard. Toggle it on/off any time by
   enabling/disabling the companion — your data is untouched either way.

## Backups

Settings → **Export JSON backup** downloads your entire library as one file.
**Import** restores it (merge or replace) on any machine. Do this periodically —
it is the only copy of your data.

## How it's built

No build step — plain ES modules loaded directly by Chrome.

```
manifest.json            MV3 manifest
icons/                   extension icons
src/
  background/            service worker (commands, context menus, message router)
  lib/                   DOM-free core: store, schema, migrations, url-safe, favicon, tabs…
  dashboard/             the 3-pane dashboard + settings + components
  popup/                 toolbar popup
  sidepanel/             optional native side panel
  styles/                design tokens + CSS
companion-newtab/        optional new-tab override (separate extension)
```

- **`src/lib/store.js` is the only module that touches `chrome.storage`.** It
  shards data by collection, serializes writes through an in-process mutex, keeps
  a `rev` per shard, and runs versioned migrations. Everything else calls it.
- Open dashboards/popups stay in sync via `chrome.storage.onChanged`; the Open
  Tabs panel stays live via `chrome.tabs`/`chrome.windows` events.
- Favicons render through Chrome's own cache (`_favicon`) — no third-party
  requests, works offline — with a monogram fallback. Image bytes are never
  stored.

## Security & privacy

- No host permissions, no content scripts — the extension never reads page
  content, only tab metadata (title/URL/favicon) and its own pages.
- Strict CSP: no remote or inline scripts, no remote fonts. `connect-src` is
  `'self'` plus **only** Google's API endpoints (`www.googleapis.com`,
  `oauth2.googleapis.com`) — used solely by the opt-in Drive sync, which stays
  inert until you connect. No other network access is possible.
- Sync uses OAuth via `chrome.identity.launchWebAuthFlow` (token flow, **no
  client secret shipped**) and the least-privilege `drive.file` scope, so the
  extension can only see the one file it creates.
- Saved titles/URLs are treated as untrusted: rendered via `textContent` only
  (never `innerHTML`), and only `http/https/ftp/file` URLs can be saved or opened
  (`javascript:`, `data:`, etc. are refused).

## Regenerating the icons

Icons are generated by a dependency-free Node script:

```
node scripts/gen-icons.mjs icons
```
