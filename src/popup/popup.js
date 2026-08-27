// Popup quick actions. Reads state directly for the target picker, but delegates
// the actual saves to the service worker (via messaging) so they complete even
// after the popup DOM is torn down on close.

import * as store from '../lib/store.js';
import { send, MessageTypes } from '../lib/messaging.js';
import { safeHref, normalizeUrl } from '../lib/url-safe.js';
import { applyThemeFromSettings } from '../lib/theme.js';

const $ = (id) => document.getElementById(id);

async function boot() {
  await store.init();
  const state = await store.getState();
  applyThemeFromSettings(state.settings);

  // populate target select
  const select = $('target');
  const opts = [];
  for (const s of state.spaces) for (const c of s.collections) opts.push({ id: c.id, label: `${c.name} · ${s.name}` });
  const NEW = '__new__';
  select.replaceChildren();
  for (const o of opts) select.append(new Option(o.label, o.id));
  select.append(new Option('➕ New collection…', NEW));
  const last = state.settings.lastTargetCollectionId;
  if (last && opts.some((o) => o.id === last)) select.value = last;

  // stats
  const winTabs = await chrome.tabs.query({ currentWindow: true });
  const saveable = winTabs.filter((t) => safeHref(t.url));
  const savedSet = new Set();
  for (const s of state.spaces) for (const c of s.collections) for (const it of c.items) savedSet.add(normalizeUrl(it.url));
  const unsaved = saveable.filter((t) => !savedSet.has(normalizeUrl(t.url))).length;
  $('stat').replaceChildren(...statNodes(saveable.length, unsaved));

  async function resolveTarget() {
    if (select.value === NEW) {
      const name = prompt('New collection name');
      if (!name) return null;
      const spaceId = state.meta.activeSpaceId || state.spaces[0]?.id;
      const c = await store.createCollection(spaceId, { name });
      return c.id;
    }
    return select.value || null;
  }

  $('save-tab').addEventListener('click', async () => {
    const collectionId = await resolveTarget();
    if (collectionId == null) return; // user cancelled the "New collection…" prompt
    try { await send(MessageTypes.SAVE_CURRENT_TAB, { collectionId }); window.close(); }
    catch (e) { flash(e.message); }
  });

  $('save-all').addEventListener('click', async () => {
    const spaceId = state.meta.activeSpaceId || state.spaces[0]?.id;
    try { await send(MessageTypes.SAVE_ALL_TABS, { spaceId, closeAfter: false }); window.close(); }
    catch (e) { flash(e.message); }
  });

  $('save-close').addEventListener('click', async () => {
    const spaceId = state.meta.activeSpaceId || state.spaces[0]?.id;
    try { await send(MessageTypes.SAVE_ALL_TABS, { spaceId, closeAfter: true }); window.close(); }
    catch (e) { flash(e.message); }
  });

  $('open-dashboard').addEventListener('click', async () => {
    await send(MessageTypes.OPEN_DASHBOARD).catch(() => {});
    window.close();
  });

  $('settings').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/settings.html') });
    window.close();
  });
}

function statNodes(total, unsaved) {
  const strong = (n) => { const b = document.createElement('b'); b.textContent = String(n); return b; };
  return [strong(total), document.createTextNode(` saveable tab${total === 1 ? '' : 's'} in this window · `), strong(unsaved), document.createTextNode(' unsaved')];
}

function flash(msg) {
  const s = $('stat');
  s.textContent = msg || 'Something went wrong';
  s.style.color = 'var(--danger)';
}

boot().catch((e) => flash(e.message));
