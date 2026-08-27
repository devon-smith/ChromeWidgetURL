// Thin wrappers around chrome.tabs / chrome.windows used by both the worker and
// pages. All URL opens re-validate the scheme (never trust a stored string).

import { safeHref } from './url-safe.js';
import * as store from './store.js';

/** All tabs (optionally scoped to a window). */
export async function queryTabs(query = {}) {
  return chrome.tabs.query(query);
}

/** The active tab in the current/focused window. */
export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

/** All normal-window tabs grouped by windowId, each ordered by tab.index. */
export async function tabsByWindow() {
  const wins = await chrome.windows.getAll({ populate: true, windowTypes: ['normal'] });
  return wins.map((w) => ({
    windowId: w.id,
    focused: w.focused,
    incognito: w.incognito,
    tabs: (w.tabs || []).slice().sort((a, b) => a.index - b.index),
  }));
}

/**
 * Open every openable URL of a collection. mode 'new-window' opens a fresh
 * focused window; 'current-window' appends to the current window. Preserves
 * order; re-pins pinned items. Returns { openedCount, skipped }.
 */
export async function restoreCollection(collectionId, mode = 'newWindow') {
  const c = await store.getCollection(collectionId);
  if (!c) throw new Error('collection not found');
  const items = c.items.filter((it) => safeHref(it.url));
  const skipped = c.items.length - items.length;
  if (!items.length) return { openedCount: 0, skipped };

  let windowId;
  if (mode === 'newWindow' || mode === 'new-window') {
    const win = await chrome.windows.create({ url: safeHref(items[0].url), focused: true });
    windowId = win.id;
    // re-pin first if needed
    if (items[0].pinned && win.tabs && win.tabs[0]) {
      await chrome.tabs.update(win.tabs[0].id, { pinned: true });
    }
    for (let i = 1; i < items.length; i++) {
      await chrome.tabs.create({ windowId, url: safeHref(items[i].url), active: false, pinned: !!items[i].pinned });
    }
  } else {
    for (let i = 0; i < items.length; i++) {
      await chrome.tabs.create({ url: safeHref(items[i].url), active: i === 0, pinned: !!items[i].pinned });
    }
  }
  // stamp lastOpenedAt (fire-and-forget)
  for (const it of items) store.touchItemOpened(collectionId, it.id).catch(() => {});
  return { openedCount: items.length, skipped };
}

/** Open one saved item. */
export async function openLink(collectionId, itemId, { active = false, newWindow = false } = {}) {
  const it = await store.getItem(collectionId, itemId);
  if (!it) throw new Error('item not found');
  const href = safeHref(it.url);
  if (!href) throw new Error('refused: unsupported URL scheme');
  let tab;
  if (newWindow) {
    const win = await chrome.windows.create({ url: href, focused: true });
    tab = win.tabs && win.tabs[0];
  } else {
    tab = await chrome.tabs.create({ url: href, active });
  }
  store.touchItemOpened(collectionId, itemId).catch(() => {});
  return tab;
}

export async function closeTabs(tabIds) {
  const ids = (Array.isArray(tabIds) ? tabIds : [tabIds]).filter((n) => Number.isInteger(n));
  if (!ids.length) return 0;
  await chrome.tabs.remove(ids);
  return ids.length;
}

/** Reopen a set of URLs (used by Undo of save-and-close). */
export async function reopenUrls(urls, { windowId } = {}) {
  const opened = [];
  for (const u of urls) {
    const href = safeHref(u);
    if (!href) continue;
    const tab = await chrome.tabs.create(windowId ? { windowId, url: href, active: false } : { url: href, active: false });
    opened.push(tab.id);
  }
  return opened;
}

/** Focus (activate) a tab and its window. */
export async function focusTab(tabId, windowId) {
  await chrome.tabs.update(tabId, { active: true });
  if (windowId != null) await chrome.windows.update(windowId, { focused: true });
}
