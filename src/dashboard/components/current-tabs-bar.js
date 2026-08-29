// Horizontal strip of the CURRENT window's open tabs, pinned at the top of the
// dashboard (old-Toby style). Lets you drop what you're looking at right now
// into a collection in one click without hunting through the side panel — the
// main reason the dashboard is also the new-tab page. Live-updates via
// chrome.tabs/windows events. Untrusted tab titles/URLs render via textContent
// only (el/faviconImg), and only safeHref() URLs are shown/saved.

import { el, icon, iconBtn } from '../../lib/dom.js';
import { faviconImg } from '../../lib/favicon.js';
import { safeHref, normalizeUrl } from '../../lib/url-safe.js';
import * as store from '../../lib/store.js';
import * as tabsLib from '../../lib/tabs.js';
import { debounce } from '../../lib/debounce.js';
import { openMenu } from './menu.js';
import { suggestCollectionId } from '../../lib/suggest.js';
import * as dnd from './dnd.js';

export function mountCurrentTabsBar(container, app) {
  let disposed = false;

  const refresh = debounce(async () => {
    if (disposed) return;
    try { render(await queryTabs()); } catch { /* window closing */ }
  }, 150);

  async function queryTabs() {
    // "Current window" is the window the dashboard tab lives in — exactly the
    // window the user means by "the tabs I have open right now".
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs.slice().sort((a, b) => a.index - b.index);
  }

  function render(tabs) {
    container.replaceChildren();
    if (app.settings.currentTabsBarVisible === false) return;

    const openable = tabs.filter((t) => safeHref(t.url));

    // Collapsed → a slim pill that expands the bar.
    if (app.settings.currentTabsBarCollapsed) {
      container.append(el('div', { class: 'curbar is-collapsed' }, [
        el('button', {
          class: 'curbar-toggle', title: 'Show current tabs',
          on: { click: () => store.updateSettings({ currentTabsBarCollapsed: false }) },
        }, [icon('window', { size: 14 }), el('span', { text: `Current tabs · ${openable.length}` }), icon('chevron', { size: 14 })]),
      ]));
      return;
    }

    const savedMap = buildSavedMap(app.state);

    const head = el('div', { class: 'curbar-head' }, [
      icon('window', { size: 14 }),
      el('span', { class: 'curbar-title', text: 'This window' }),
      el('span', { class: 'curbar-count', text: `· ${openable.length} tab${openable.length === 1 ? '' : 's'}` }),
      el('div', { class: 'curbar-actions' }, [
        openable.length ? el('button', { class: 'btn btn-ghost curbar-btn', text: 'Save all', title: 'Save every tab in this window to a new collection', on: { click: () => app.saveAllTabs() } }) : null,
        iconBtn('chevron', { title: 'Collapse', size: 15, cls: 'curbar-collapse', onClick: () => store.updateSettings({ currentTabsBarCollapsed: true }) }),
        iconBtn('x', { title: 'Hide this bar (re-enable in Settings)', size: 14, onClick: () => store.updateSettings({ currentTabsBarVisible: false }) }),
      ]),
    ]);

    const strip = el('div', { class: 'curbar-strip', attrs: { role: 'list', 'aria-label': 'Open tabs in this window' } });
    if (!openable.length) {
      strip.append(el('div', { class: 'curbar-empty', text: 'No open tabs to add yet.' }));
    } else {
      for (const t of openable) strip.append(chip(t, savedMap));
    }

    container.append(el('div', { class: 'curbar' }, [head, strip]));
  }

  function chip(tab, savedMap) {
    const norm = normalizeUrl(tab.url);
    const saved = savedMap.has(norm);
    const c = el('div', {
      class: `curchip ${tab.active ? 'is-active' : ''} ${saved ? 'is-saved' : ''}`.trim(),
      attrs: { role: 'listitem', title: tab.title || tab.url || '' },
      dataset: { tabId: String(tab.id) },
    }, [
      faviconImg({ url: tab.url || '', domain: '' }, app.settings.faviconSize),
      el('span', { class: 'curchip-title clamp-1', text: tab.title || tab.url || 'Untitled' }),
      saved ? icon('check', { size: 12, cls: 'curchip-saved' }) : null,
      el('div', { class: 'curchip-actions' }, [
        iconBtn('save', { title: saved ? 'Save again…' : 'Save to a collection', size: 13, onClick: (e) => { e.stopPropagation(); saveMenu(e.currentTarget, tab); } }),
        iconBtn('close', { title: 'Close tab', size: 13, onClick: (e) => { e.stopPropagation(); closeTab(tab, saved); } }),
      ]),
    ]);
    c.addEventListener('click', () => { if (tab.id != null) tabsLib.focusTab(tab.id, tab.windowId); });
    dnd.attachTabRow(c, tab);
    return c;
  }

  function saveMenu(anchor, tab) {
    const targets = [];
    for (const s of app.state.spaces) for (const c of s.collections) targets.push({ c, s });
    const suggestedId = suggestCollectionId(app.state, tab.url);
    targets.sort((a, b) => (b.c.id === suggestedId ? 1 : 0) - (a.c.id === suggestedId ? 1 : 0));
    openMenu(anchor, [
      { labelHeading: 'Save to' },
      ...targets.slice(0, 8).map(({ c, s }) => ({
        label: `${c.name} · ${s.name}${c.id === suggestedId ? '  · suggested' : ''}`, icon: 'save',
        onClick: async () => { const r = await store.addItemsFromTabs(c.id, [tab]); app.toast(r.length ? `Saved to ${c.name}` : 'Already saved'); },
      })),
      { separator: true },
      { label: 'New collection…', icon: 'plus', onClick: async () => { const id = await app.addCollection(); if (id) { await store.addItemsFromTabs(id, [tab]); app.toast('Saved'); } } },
    ]);
  }

  async function closeTab(tab, isSaved) {
    if (!isSaved && app.settings.closeUnsavedWarning) {
      const snapshot = { url: tab.url, windowId: tab.windowId };
      await tabsLib.closeTabs([tab.id]);
      app.toast('Tab closed', { undo: async () => { await tabsLib.reopenUrls([snapshot.url], { windowId: snapshot.windowId }); } });
    } else {
      await tabsLib.closeTabs([tab.id]);
    }
  }

  function buildSavedMap(state) {
    const map = new Map();
    for (const s of state.spaces) for (const c of s.collections) for (const it of c.items) {
      map.set(normalizeUrl(it.url), true);
    }
    return map;
  }

  // wire chrome events (same surface as the side panel)
  const evs = [];
  const on = (obj, name, fn) => { if (obj && obj[name]) { obj[name].addListener(fn); evs.push([obj[name], fn]); } };
  const trigger = () => refresh();
  on(chrome.tabs, 'onCreated', trigger); on(chrome.tabs, 'onRemoved', trigger);
  on(chrome.tabs, 'onUpdated', trigger); on(chrome.tabs, 'onMoved', trigger);
  on(chrome.tabs, 'onActivated', trigger); on(chrome.tabs, 'onAttached', trigger);
  on(chrome.tabs, 'onDetached', trigger); on(chrome.tabs, 'onReplaced', trigger);
  on(chrome.windows, 'onFocusChanged', trigger);

  refresh();

  return {
    refresh,
    dispose() { disposed = true; for (const [evt, fn] of evs) { try { evt.removeListener(fn); } catch {} } },
  };
}
