// Central RPC dispatch for the service worker. EVERY inbound message is treated
// as untrusted: the `type` must be a known enum value and the payload shape is
// checked before acting.

import { MessageTypes } from '../lib/messaging.js';
import * as store from '../lib/store.js';
import * as tabs from '../lib/tabs.js';
import { safeHref } from '../lib/url-safe.js';
import { log } from '../lib/logger.js';

export const DASHBOARD_URL = chrome.runtime.getURL('src/dashboard/dashboard.html');

/** Open (or focus) the dashboard tab. */
export async function openDashboard() {
  const existing = await chrome.tabs.query({ url: DASHBOARD_URL });
  if (existing && existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId != null) await chrome.windows.update(existing[0].windowId, { focused: true });
    return existing[0];
  }
  return chrome.tabs.create({ url: DASHBOARD_URL });
}

/** Resolve the collection a save should land in, creating one if necessary. */
async function resolveTargetCollection(payload = {}) {
  if (payload.collectionId) return payload.collectionId;
  const state = await store.getState();
  const activeId = payload.spaceId || state.meta.activeSpaceId || state.spaces[0]?.id;
  const space = state.spaces.find((s) => s.id === activeId) || state.spaces[0];
  if (!space) {
    const s = await store.createSpace({ name: 'My Space' });
    const c = await store.createCollection(s.id, { name: 'Saved' });
    return c.id;
  }
  if (space.collections.length) return space.collections[0].id;
  const c = await store.createCollection(space.id, { name: 'Saved' });
  return c.id;
}

function defaultCollectionName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Tabs ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function handleSaveCurrentTab(payload) {
  const tab = await tabs.getActiveTab();
  if (!tab || !safeHref(tab.url)) throw new Error('current tab cannot be saved');
  const collectionId = await resolveTargetCollection(payload);
  const created = await store.addItemsFromTabs(collectionId, [tab]);
  await store.updateSettings({ lastTargetCollectionId: collectionId });
  return { itemIds: created.map((i) => i.id), collectionId, skipped: created.length ? 0 : 1 };
}

async function handleSaveTabs(payload) {
  const { tabIds } = payload;
  if (!Array.isArray(tabIds) || !tabIds.every((n) => Number.isInteger(n))) throw new Error('bad tabIds');
  const collectionId = await resolveTargetCollection(payload);
  const all = await tabs.queryTabs({});
  const wanted = new Set(tabIds);
  const chosen = all.filter((t) => wanted.has(t.id)).sort((a, b) => a.index - b.index);
  const created = await store.addItemsFromTabs(collectionId, chosen);
  return { itemIds: created.map((i) => i.id), collectionId };
}

async function handleSaveAllTabs(payload) {
  const { spaceId, name, closeAfter } = payload || {};
  const active = await tabs.getActiveTab();
  const windowId = active?.windowId;
  const winTabs = (await tabs.queryTabs(windowId != null ? { windowId } : { currentWindow: true }))
    .sort((a, b) => a.index - b.index);
  const state = await store.getState();
  const targetSpace = spaceId || state.meta.activeSpaceId || state.spaces[0]?.id;
  const col = await store.createCollection(targetSpace, { name: name || defaultCollectionName() });
  const created = await store.addItemsFromTabs(col.id, winTabs);
  let closed = 0;
  const skippedRestricted = winTabs.filter((t) => !safeHref(t.url)).length;
  if (closeAfter && created.length) {
    const savedNorms = new Set(created.map((i) => i.url));
    const toClose = winTabs.filter((t) => safeHref(t.url) && savedNorms.has(t.url)).map((t) => t.id);
    closed = await tabs.closeTabs(toClose);
  }
  return { collectionId: col.id, savedCount: created.length, closed, skippedRestricted };
}

async function handleSaveWindow(payload) {
  const { windowId, newCollectionName, spaceId } = payload;
  if (!Number.isInteger(windowId)) throw new Error('bad windowId');
  const winTabs = (await tabs.queryTabs({ windowId })).sort((a, b) => a.index - b.index);
  const state = await store.getState();
  const targetSpace = spaceId || state.meta.activeSpaceId || state.spaces[0]?.id;
  const col = await store.createCollection(targetSpace, { name: newCollectionName || defaultCollectionName() });
  const created = await store.addItemsFromTabs(col.id, winTabs);
  return { collectionId: col.id, savedCount: created.length };
}

async function handleRestore(payload) {
  const { collectionId, mode } = payload;
  if (!collectionId) throw new Error('bad collectionId');
  return tabs.restoreCollection(collectionId, mode || 'newWindow');
}

async function handleOpenLink(payload) {
  const { collectionId, itemId, active, newWindow } = payload;
  const tab = await tabs.openLink(collectionId, itemId, { active: !!active, newWindow: !!newWindow });
  return { tabId: tab?.id ?? null };
}

async function handleCloseTabs(payload) {
  const closed = await tabs.closeTabs(payload.tabIds);
  return { closed };
}

const HANDLERS = {
  [MessageTypes.PING]: async () => ({ version: chrome.runtime.getManifest().version }),
  [MessageTypes.SAVE_CURRENT_TAB]: handleSaveCurrentTab,
  [MessageTypes.SAVE_TABS]: handleSaveTabs,
  [MessageTypes.SAVE_ALL_TABS]: handleSaveAllTabs,
  [MessageTypes.SAVE_WINDOW]: handleSaveWindow,
  [MessageTypes.RESTORE_COLLECTION]: handleRestore,
  [MessageTypes.OPEN_LINK]: handleOpenLink,
  [MessageTypes.CLOSE_TABS]: handleCloseTabs,
  [MessageTypes.OPEN_DASHBOARD]: async () => { await openDashboard(); return { ok: true }; },
};

/** Route a validated message. Returns the response envelope's `data`. */
export async function routeMessage(msg) {
  if (!msg || typeof msg.type !== 'string') throw new Error('malformed message');
  const handler = HANDLERS[msg.type];
  if (!handler) throw new Error(`unknown message type: ${msg.type}`);
  await store.init();
  const data = await handler(msg.payload || {});
  log.debug('routed', msg.type, data);
  return data;
}
