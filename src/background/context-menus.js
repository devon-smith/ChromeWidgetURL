// Right-click context menus. Menus are (re)created via chrome.contextMenus.
// IMPORTANT: only create menus from onInstalled/onStartup or a debounced rebuild
// — creating them at worker top level throws duplicate-ID errors on every wake.

import * as store from '../lib/store.js';
import * as tabs from '../lib/tabs.js';
import { safeHref, sourceLabelOf } from '../lib/url-safe.js';
import { openDashboard } from './message-router.js';
import { log } from '../lib/logger.js';

const RECENT_LIMIT = 5;

/** Rebuild the whole menu tree from current data. Safe to call repeatedly. */
export async function setupContextMenus() {
  await new Promise((resolve) => chrome.contextMenus.removeAll(resolve));
  const mk = (opts) => new Promise((resolve) => chrome.contextMenus.create(opts, resolve));

  await mk({ id: 'root', title: 'Local Toby', contexts: ['page', 'link', 'selection'] });
  await mk({ id: 'save-page', parentId: 'root', title: 'Save this page', contexts: ['page'] });
  await mk({ id: 'save-link', parentId: 'root', title: 'Save link', contexts: ['link'] });
  await mk({ id: 'save-all', parentId: 'root', title: 'Save all tabs to a new collection', contexts: ['page', 'link'] });

  // Dynamic "Save this page to…" recent collections submenu.
  try {
    const state = await store.getState();
    const recents = [];
    for (const s of state.spaces) for (const c of s.collections) recents.push({ c, s, at: c.updatedAt || 0 });
    recents.sort((a, b) => b.at - a.at);
    if (recents.length) {
      await mk({ id: 'save-to', parentId: 'root', title: 'Save this page to…', contexts: ['page', 'link'] });
      for (const { c, s } of recents.slice(0, RECENT_LIMIT)) {
        await mk({ id: `save-to:${c.id}`, parentId: 'save-to', title: `${c.name}  ·  ${s.name}`.slice(0, 90), contexts: ['page', 'link'] });
      }
    }
  } catch (e) { log.warn('recent submenu build failed', e); }

  await mk({ id: 'sep', parentId: 'root', type: 'separator', contexts: ['page', 'link'] });
  await mk({ id: 'open-dashboard', parentId: 'root', title: 'Open Local Toby dashboard', contexts: ['page', 'link'] });
}

async function defaultTargetCollectionId() {
  const state = await store.getState();
  const spaceId = state.meta.activeSpaceId || state.spaces[0]?.id;
  const space = state.spaces.find((s) => s.id === spaceId) || state.spaces[0];
  if (space?.collections[0]) return space.collections[0].id;
  const c = await store.createCollection(space.id, { name: 'Saved' });
  return c.id;
}

export async function handleContextMenuClick(info, tab) {
  try {
    await store.init();
    const id = String(info.menuItemId);

    if (id === 'open-dashboard') { await openDashboard(); return; }

    if (id === 'save-link') {
      const url = info.linkUrl;
      if (!safeHref(url)) return;
      const collectionId = await defaultTargetCollectionId();
      await store.addItem(collectionId, {
        url,
        title: info.linkText || sourceLabelOf(url),
      });
      return;
    }

    if (id === 'save-page') {
      const url = info.pageUrl || tab?.url;
      if (!safeHref(url)) return;
      const collectionId = await defaultTargetCollectionId();
      await store.addItem(collectionId, { url, title: tab?.title });
      return;
    }

    if (id.startsWith('save-to:')) {
      const collectionId = id.slice('save-to:'.length);
      const url = info.linkUrl || info.pageUrl || tab?.url;
      if (!safeHref(url)) return;
      await store.addItem(collectionId, { url, title: info.linkText || tab?.title });
      return;
    }

    if (id === 'save-all') {
      const winTabs = (await tabs.queryTabs(tab?.windowId != null ? { windowId: tab.windowId } : { currentWindow: true }))
        .sort((a, b) => a.index - b.index);
      const state = await store.getState();
      const spaceId = state.meta.activeSpaceId || state.spaces[0]?.id;
      const col = await store.createCollection(spaceId, { name: newName() });
      await store.addItemsFromTabs(col.id, winTabs);
      return;
    }
  } catch (err) {
    log.error('context menu action failed', err);
  }
}

function newName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Tabs ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
