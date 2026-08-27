// MV3 service worker entry. The worker is ephemeral: it may be torn down after
// ~30s idle and re-woken by any event. Therefore:
//   - ALL chrome.*.addListener calls happen synchronously at top level (below),
//     never inside async callbacks — otherwise a woken worker misses the event.
//   - No durable state lives in worker memory; chrome.storage.local is truth.
//   - Context menus are created only from onInstalled / onStartup / a debounced
//     rebuild (never at top level → avoids duplicate-ID errors).

import { routeMessage, openDashboard } from './message-router.js';
import { handleCommand } from './commands.js';
import { setupContextMenus, handleContextMenuClick } from './context-menus.js';
import * as store from '../lib/store.js';
import { debounce } from '../lib/debounce.js';
import { log } from '../lib/logger.js';

// ---- lifecycle ---------------------------------------------------------
chrome.runtime.onInstalled.addListener((details) => {
  (async () => {
    try {
      await store.init({ withGettingStarted: details.reason === 'install' });
      await setupContextMenus();
      if (details.reason === 'install') await openDashboard();
    } catch (e) { log.error('onInstalled failed', e); }
  })();
});

chrome.runtime.onStartup.addListener(() => {
  (async () => {
    try { await store.init(); await setupContextMenus(); }
    catch (e) { log.error('onStartup failed', e); }
  })();
});

// ---- messaging (async response requires synchronous `return true`) ------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  routeMessage(msg)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
  return true;
});

// ---- commands & context menus ------------------------------------------
chrome.commands.onCommand.addListener(handleCommand);
chrome.contextMenus.onClicked.addListener(handleContextMenuClick);

// ---- keep the recent-collections submenu fresh --------------------------
// Rebuild menus when spaces/collections change (debounced; storage.onChanged
// fires in the worker too). Registered at top level so it survives wakeups.
const rebuildMenus = debounce(() => { setupContextMenus().catch((e) => log.warn(e)); }, 1500);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const touchedStructure = Object.keys(changes).some(
    (k) => k === 'meta' || k.startsWith('space:') || k.startsWith('collection:'));
  if (touchedStructure) rebuildMenus();
});

// ---- side panel behavior ------------------------------------------------
// Let clicking the toolbar icon still open the popup; the side panel is opened
// explicitly via the command / dashboard. Enable open-on-action is optional.
try {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false })?.catch(() => {});
} catch { /* older Chrome (setPanelBehavior absent) */ }

log.info('service worker loaded');
