// chrome.commands handlers (global keyboard shortcuts). These fire with no UI
// open, so they do the work in the worker and finish before returning.

import * as store from '../lib/store.js';
import * as tabs from '../lib/tabs.js';
import { safeHref } from '../lib/url-safe.js';
import { openDashboard } from './message-router.js';
import { log } from '../lib/logger.js';

export async function handleCommand(command, tab) {
  // Handle side-panel opening FIRST, synchronously: chrome.sidePanel.open() must
  // run inside the command's user-gesture window, which is lost across any await.
  if (command === 'toggle-side-panel') {
    try {
      if (chrome.sidePanel && tab?.windowId != null) chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (e) { log.warn(e); }
    return;
  }
  try {
    await store.init();
    switch (command) {
      case 'open-dashboard':
        await openDashboard();
        break;
      case 'save-current-tab': {
        const tab = await tabs.getActiveTab();
        if (!tab || !safeHref(tab.url)) { await flashBadge('!'); return; }
        const state = await store.getState();
        const spaceId = state.meta.activeSpaceId || state.spaces[0]?.id;
        const space = state.spaces.find((s) => s.id === spaceId) || state.spaces[0];
        let collectionId = space?.collections[0]?.id;
        if (!collectionId) collectionId = (await store.createCollection(space.id, { name: 'Saved' })).id;
        await store.addItemsFromTabs(collectionId, [tab]);
        await flashBadge('✓');
        break;
      }
      case 'save-all-tabs': {
        const active = await tabs.getActiveTab();
        const winTabs = (await tabs.queryTabs(active?.windowId != null ? { windowId: active.windowId } : { currentWindow: true }))
          .sort((a, b) => a.index - b.index);
        const state = await store.getState();
        const spaceId = state.meta.activeSpaceId || state.spaces[0]?.id;
        const col = await store.createCollection(spaceId, { name: defaultName() });
        const created = await store.addItemsFromTabs(col.id, winTabs);
        await flashBadge(String(created.length));
        break;
      }
      default:
        log.warn('unknown command', command);
    }
  } catch (err) {
    log.error('command failed', command, err);
  }
}

function defaultName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Tabs ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function flashBadge(text) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color: '#EB5757' });
    await chrome.action.setBadgeText({ text: String(text).slice(0, 4) });
    // A ~1.5s flash: the worker is alive right after handling the command, so a
    // short setTimeout is reliable here. (chrome.alarms clamps to a ~30s floor
    // in packed builds, so it can't express a sub-30s delay.)
    setTimeout(() => { chrome.action.setBadgeText({ text: '' }).catch(() => {}); }, 1500);
  } catch { /* action badge unavailable */ }
}
