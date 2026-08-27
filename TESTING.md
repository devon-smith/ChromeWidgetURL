# Local Toby — Test Script

A full test protocol for **Local Toby**. It's written so it can be run two ways:

1. **By hand** — walk the checklist yourself.
2. **By the Claude Chrome extension** — paste the block in [§0](#0-paste-this-into-the-claude-chrome-extension) and let Claude drive your browser and report pass/fail.

> ⚠️ **Safety first.** These tests create, save, and **close** tabs. To protect your real work, all destructive steps run in a **dedicated throwaway window** with dummy `example.com` / `wikipedia.org` tabs that the test opens itself, and in a **dedicated "QA" space**. The test must **never close your existing tabs** or touch your real collections. Clean-up at the end deletes only what the test created.

---

## 0. Paste this into the Claude Chrome extension

```
You are testing my Chrome extension "Local Toby" (a local-first tab manager). Drive
my browser and verify each step. Follow these rules strictly:

SAFETY
- Do NOT close, move, or modify any of my existing tabs or windows.
- For any test that saves or closes tabs, FIRST open a NEW window and open 4 dummy
  tabs in it: https://example.com , https://www.wikipedia.org ,
  https://example.org , https://www.iana.org . Use only that window for
  destructive actions.
- Do all work inside a new space called "QA" (create it first). Never edit my
  "My Space" or any other existing space/collection.
- At the very end, delete the "QA" space and close the dummy window.

HOW TO REPORT
- Open the dashboard first: click the Local Toby toolbar icon, or open a new tab and
  press Ctrl/Cmd+Shift+O. Keep it open in its own tab.
- Go through the numbered tests in TESTING.md §2–§14 below (I will paste them, or you
  can read them). For each test, state PASS or FAIL and one line of evidence
  (what you saw). If FAIL, describe exactly what happened vs. expected.
- When done, print a summary table: test number, name, PASS/FAIL.

Start now with §1 setup, then run §2 through §14, then §15 cleanup.
```

(Then paste §1–§15 below, or tell it to open `TESTING.md` in the repo.)

---

## 1. Setup / preconditions

- [ ] Extension loaded unpacked with **no errors** on `chrome://extensions` (or `brave://extensions`).
- [ ] Open the dashboard (toolbar icon → "Open dashboard", or `Ctrl/Cmd+Shift+O`). It shows the **Local Toby** sidebar, a "Getting Started" collection with 2 cards, and the **Open Tabs** panel on the right.
- [ ] Create a space named **QA** (sidebar → "Add space"). Click it so it's the active space. All following tests happen here unless noted.
- [ ] Open a **new browser window** and open 4 tabs: `example.com`, `wikipedia.org`, `example.org`, `iana.org`. (These are the "dummy tabs".)

---

## 2. Live Open Tabs panel

- [ ] **2.1** The right panel lists your windows grouped ("Window 1 · N tabs", etc.), each row with a favicon + title. → The dummy window appears with its 4 tabs.
- [ ] **2.2** In the dummy window, open one more tab (`https://www.mozilla.org`). → Within ~½ second the panel shows the new row **without a manual refresh**.
- [ ] **2.3** Close that tab. → The row disappears automatically.
- [ ] **2.4** Switch the active tab in the dummy window. → The active row gets a coral left-bar marker.
- [ ] **2.5** A `chrome://`/`brave://` or `about:` tab (open one) shows **greyed out** with no Save action (can't be saved), but can still be closed.

## 3. Save a single tab

- [ ] **3.1** Hover a dummy tab row in the panel → click the **save (＋)** icon → pick "New collection…" → name it **Inbox**. → A collection "Inbox" appears in QA with that one card; the card shows the correct title + favicon + source label.
- [ ] **3.2** Hover the same row → save it again to **Inbox**. → You get an "Already saved / Already in this collection" message and **no duplicate** card is added (dedupe on).
- [ ] **3.3** Right-click the card in the panel's... (skip — use the card's ⋯ menu) — open a card's ⋯ menu → "Copy link" → paste somewhere. → The exact URL is on the clipboard.

## 4. Save ALL tabs (order preservation — the important one)

- [ ] **4.1** Focus the **dummy window**. In the dashboard toolbar (or panel window header) use **Save all** for that window. → A new collection is created holding one card per **non-restricted** dummy tab.
- [ ] **4.2** **Order check:** the cards appear in the **same left-to-right order** as the tabs in the dummy window (example.com, wikipedia.org, example.org, iana.org) — **not reversed**.
- [ ] **4.3** Any restricted (`chrome://`) tabs are **not** saved (and nothing is closed by this action).

## 5. Save & close (memory reclaim + Undo)

- [ ] **5.1** In the **dummy window only**, open the popup (toolbar icon) → **Save & close all**. → The dummy tabs are saved to a new collection **and then closed**; the window stays alive (a New Tab page remains) rather than quitting.
- [ ] **5.2** An **Undo** toast appears (~8s). Click **Undo**. → The closed tabs **reopen** by URL **and** the just-created collection is **removed** — back to the prior state.
- [ ] **5.3** Repeat 5.1 but let the toast expire. → Tabs stay closed and the collection persists.

## 6. Restore / open a collection

- [ ] **6.1** On a saved collection, click **Open all in new window**. → A new window opens with all cards' URLs as tabs, **in stored order**, window focused.
- [ ] **6.2** Collection menu (⋯) → **Open all (current window)**. → Tabs append to the current window.
- [ ] **6.3** If a collection has more than 15 cards, opening prompts a **confirm** ("Open N tabs?"). (Create a big collection via §4 on a many-tab window to check, or skip.)
- [ ] **6.4** Opening does **not** modify the collection (cards still there).

## 7. Open a single card

- [ ] **7.1** Single-click a card → opens the URL in a **background tab** (you stay on the dashboard).
- [ ] **7.2** **Shift-click** a card → opens in a **new window**.
- [ ] **7.3** **Middle-click** a card → opens in a background tab.
- [ ] **7.4** Card ⋯ → "Open in new window" works.

## 8. Collections — create / rename / delete / collapse

- [ ] **8.1** Toolbar **+ Add Collection** → name it **Temp**. → Empty collection appears with a "Drag tabs here" empty state.
- [ ] **8.2** **Double-click** a collection title → inline edit → type a new name → **Enter**. → Renamed.
- [ ] **8.3** Double-click to rename again → press **Escape**. → Edit is **cancelled**; the old name remains (does **not** save the typed text).
- [ ] **8.4** Collection ⋯ → **Delete** → confirm. → Collection removed; an **Undo** toast restores it (with its cards) intact.
- [ ] **8.5** Click the collection **chevron** → collapses/expands; the collapsed state **persists** after a dashboard reload.

## 9. Spaces — create / rename / favorite / delete / switch

- [ ] **9.1** Sidebar **Add space** → **QA2**. → New space; becomes active.
- [ ] **9.2** Hover a space → **star** it. → Moves into the **Favorites** section at top.
- [ ] **9.3** Space ⋯ → **Rename** works.
- [ ] **9.4** Switch active space by clicking it. → Center pane shows that space's collections; new saves default to it.
- [ ] **9.5** Space ⋯ → **Delete** QA2 → confirm. → Removed; **Undo** restores it with the **same** collections/cards.
- [ ] **9.6** You **cannot** delete your only remaining space (guarded with a message).

## 10. Drag & drop (ensure the "Drag & drop" toolbar toggle is ON)

- [ ] **10.1** **Reorder cards** within a collection by dragging a card. → New order **persists** after reload.
- [ ] **10.2** **Move a card between collections** by dragging it onto another collection. → Removed from source, added to target; persists; a dedupe note if it's already there.
- [ ] **10.3** **Drag a live tab row** from the Open Tabs panel onto a collection. → A card is created there and the **tab stays open**.
- [ ] **10.4** **Reorder collections** by dragging a collection **header** onto another collection. → Order changes and persists. *(This was a fixed bug — verify it actually reorders.)*
- [ ] **10.5** **Move a collection to another space** by dragging its header onto a space in the sidebar. → Collection moves to that space.
- [ ] **10.6** Toggle **Drag & drop OFF** in the toolbar. → Cards are no longer draggable.

## 11. Search

- [ ] **11.1** Type part of a saved title/domain in the sidebar search. → Only matching cards/collections show, within ~150ms; match highlights.
- [ ] **11.2** Press **Escape** (or the ✕). → Search clears and the full view returns.
- [ ] **11.3** Search for gibberish. → A "No matching tabs" empty state with a **Clear filters** button.

## 12. Persistence, live sync & badges

- [ ] **12.1** Reload the dashboard tab (Cmd/Ctrl+R). → All spaces/collections/cards are **still there** (data persisted).
- [ ] **12.2** Open the dashboard in a **second tab**. Save a tab in tab A. → Tab B updates **without a manual refresh** (`storage.onChanged`).
- [ ] **12.3** In the Open Tabs panel, a tab whose URL is already saved shows a **"Saved"** badge; hovering shows which collection(s).
- [ ] **12.4** Open the same URL in two tabs. → Both get a **"Dup"** badge in the panel.

## 13. Popup, context menu, keyboard

- [ ] **13.1** Toolbar **popup** shows a saveable-tab count and "N unsaved", a target dropdown, and the 4 action buttons. "Save this tab" saves and the popup closes.
- [ ] **13.2** Popup → select "➕ New collection…" in the dropdown, then **cancel** the name prompt. → **Nothing is saved** (no stray card).
- [ ] **13.3** **Right-click a page** → "Local Toby" → "Save this page" / "Save link" / a recent collection. → Saves the right URL.
- [ ] **13.4** `Ctrl/Cmd+Shift+O` opens the dashboard; `Ctrl/Cmd+Shift+S` saves the current tab (a badge flashes ✓ briefly, then clears).

## 14. Settings, backup, security

- [ ] **14.1** Settings → toggle **Theme** System/Light/Dark. → Applies immediately and persists.
- [ ] **14.2** Settings → **Export JSON backup**. → A `local-toby-backup-*.json` file downloads; "Last backup" timestamp updates.
- [ ] **14.3** Open the JSON — your spaces/collections/**saved URLs**/settings are all there, human-readable.
- [ ] **14.4** Settings → **Import (merge)** the file you just exported. → Reports counts; your data roughly doubles with **no crash** and no duplicate IDs.
- [ ] **14.5** Storage readout shows KB used + counts.
- [ ] **14.6 (security)** Save a tab whose page `<title>` contains `<img src=x onerror=alert(1)>` (e.g. open a `data:text/html,<title>...` page — or trust the import test): the card renders the title as **literal text**, **no alert** fires.
- [ ] **14.7 (security)** Hand-edit the exported JSON to add an item with `"url":"javascript:alert(1)"`, then **Import (replace)**. → That item is **dropped/flagged**; it never becomes a clickable/openable card.
- [ ] **14.8 (favicons)** Turn on airplane mode / go offline, reload the dashboard. → Favicons for previously-visited sites **still render** (served from Chrome's cache); unknown sites show a **letter monogram**, never a broken image.

## 15. Cleanup

- [ ] Delete the **QA** space (and QA2 if it survived). Delete any leftover test collections.
- [ ] Close the dummy window(s).
- [ ] Confirm your original spaces/tabs are untouched.

---

## Known gaps to expect (not failures)

- **Tags / Tag filter:** the storage layer supports tags, but there is **no UI yet** to create or assign a tag to a card, so the "Tag filter" toolbar shows "no tags yet". Tag assignment is a planned follow-up — don't file it as a bug.
- **Responsive toolbar:** at narrow widths the space title can wrap and the "Add Collection" label can clip. Cosmetic; a polish item.

## Automated smoke test (no browser)

The storage engine has a Node test harness that mocks `chrome.storage` and exercises
seed, dedupe, ordering, move, delete+undo, tags, export/import round-trip, and the
`javascript:` scheme rejection. See the assertions in the commit history; to re-run a
similar check, load `src/lib/store.js` with a mocked `chrome` global.
