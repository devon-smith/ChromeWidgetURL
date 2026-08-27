// Right pane: mirrors the browser's open tabs in real time, grouped by window.
// Marks duplicates and already-saved tabs; supports save / save-all / close /
// focus and dragging a tab into a collection. Listens to chrome.tabs/windows.

import { el, icon, iconBtn } from '../../lib/dom.js';
import { faviconImg } from '../../lib/favicon.js';
import { safeHref, normalizeUrl } from '../../lib/url-safe.js';
import * as store from '../../lib/store.js';
import * as tabsLib from '../../lib/tabs.js';
import { debounce } from '../../lib/debounce.js';
import { openMenu } from './menu.js';
import * as dnd from './dnd.js';

export function mountOpenTabs(container, app) {
  let currentWindowId = null;
  let disposed = false;

  const refresh = debounce(async () => {
    if (disposed) return;
    try { render(await tabsLib.tabsByWindow()); } catch { /* windows closing */ }
  }, 200);

  async function render(windows) {
    const savedMap = buildSavedMap(app.state);           // normUrl -> [collection names]
    const dupCounts = new Map();
    for (const w of windows) for (const t of w.tabs) {
      if (!safeHref(t.url)) continue;
      const n = normalizeUrl(t.url);
      dupCounts.set(n, (dupCounts.get(n) || 0) + 1);
    }

    const scroll = el('div', { class: 'panel-scroll' });
    const totalOpen = windows.reduce((n, w) => n + w.tabs.length, 0);
    if (!totalOpen) {
      scroll.append(el('div', { class: 'empty-state' }, [
        el('h3', { text: 'All caught up' }), el('p', { text: 'No open tabs to show.' }),
      ]));
    }
    let wi = 0;
    for (const w of windows) {
      wi++;
      const isThis = w.windowId === currentWindowId;
      const group = el('div', { class: 'win-group' });
      group.append(el('div', { class: 'win-header' }, [
        icon('window', { size: 14 }),
        el('span', { text: isThis ? 'This window' : `Window ${wi}` }),
        el('span', { class: 'win-count', text: `· ${w.tabs.length} tab${w.tabs.length === 1 ? '' : 's'}` }),
        el('div', { class: 'win-actions' }, [
          el('button', { class: 'btn btn-ghost win-save', text: 'Save all', on: { click: () => app.saveWindow(w.windowId) } }),
          el('button', { class: 'btn btn-ghost win-save', text: '& close', title: 'Save all tabs then close them', on: { click: () => app.saveWindowAndClose(w.windowId) } }),
        ]),
      ]));
      for (const t of w.tabs) group.append(tabRow(t, savedMap, dupCounts, app));
      scroll.append(group);
    }
    container.querySelector('.panel-scroll')?.remove();
    container.append(scroll);
  }

  function tabRow(tab, savedMap, dupCounts, app) {
    const openable = !!safeHref(tab.url);
    const norm = openable ? normalizeUrl(tab.url) : null;
    const savedIn = norm ? savedMap.get(norm) : null;
    const isDup = norm && dupCounts.get(norm) > 1;

    const row = el('div', {
      class: `tab-row ${tab.active ? 'is-active' : ''} ${openable ? '' : 'restricted'}`,
      attrs: { title: tab.url || '', role: 'listitem' },
    }, [
      faviconImg({ url: tab.url || '', domain: '' }, app.settings.faviconSize),
      el('span', { class: 'tab-title clamp-1', text: tab.title || tab.url || 'Untitled' }),
    ]);

    const badges = el('div', { class: 'tab-badges' });
    if (savedIn) badges.append(el('span', { class: 'mini-badge badge-saved', text: 'Saved', attrs: { title: `Saved in: ${savedIn.join(', ')}` } }));
    if (isDup) badges.append(el('span', { class: 'mini-badge badge-dupe', text: 'Dup' }));
    row.append(badges);

    const actions = el('div', { class: 'tab-actions' });
    if (openable) {
      actions.append(iconBtn('save', { title: 'Save this tab', size: 14, onClick: (e) => { e.stopPropagation(); saveMenu(e.currentTarget, tab, app); } }));
    }
    actions.append(iconBtn('close', { title: 'Close tab', size: 14, onClick: (e) => { e.stopPropagation(); closeTab(tab, !!savedIn, app); } }));
    row.append(actions);

    row.addEventListener('click', () => { if (tab.id != null) tabsLib.focusTab(tab.id, tab.windowId); });
    if (openable) dnd.attachTabRow(row, tab);
    return row;
  }

  function saveMenu(anchor, tab, app) {
    const targets = [];
    for (const s of app.state.spaces) for (const c of s.collections) targets.push({ c, s });
    const items = [
      { labelHeading: 'Save to' },
      ...targets.slice(0, 8).map(({ c, s }) => ({
        label: `${c.name} · ${s.name}`, icon: 'save',
        onClick: async () => { const r = await store.addItemsFromTabs(c.id, [tab]); app.toast(r.length ? `Saved to ${c.name}` : 'Already saved'); },
      })),
      { separator: true },
      { label: 'New collection…', icon: 'plus', onClick: async () => { const id = await app.addCollection(); if (id) { await store.addItemsFromTabs(id, [tab]); app.toast('Saved'); } } },
    ];
    openMenu(anchor, items);
  }

  async function closeTab(tab, isSaved, app) {
    if (!isSaved && app.settings.closeUnsavedWarning) {
      // capture for undo
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
      const n = normalizeUrl(it.url);
      if (!map.has(n)) map.set(n, []);
      const arr = map.get(n);
      if (!arr.includes(c.name)) arr.push(c.name);
    }
    return map;
  }

  // header
  container.replaceChildren(el('div', { class: 'panel-header' }, [
    el('span', { class: 'panel-title', text: 'Open Tabs' }),
    el('div', { class: 'panel-actions' }, [
      iconBtn('chevron', { title: 'Hide panel', size: 15, onClick: () => app.toggleTabsPanel() }),
    ]),
  ]));

  // wire chrome events
  const evs = [];
  const on = (obj, name, fn) => { if (obj && obj[name]) { obj[name].addListener(fn); evs.push([obj[name], fn]); } };
  const trigger = () => refresh();
  on(chrome.tabs, 'onCreated', trigger); on(chrome.tabs, 'onRemoved', trigger);
  on(chrome.tabs, 'onUpdated', trigger); on(chrome.tabs, 'onMoved', trigger);
  on(chrome.tabs, 'onActivated', trigger); on(chrome.tabs, 'onAttached', trigger);
  on(chrome.tabs, 'onDetached', trigger); on(chrome.tabs, 'onReplaced', trigger);
  on(chrome.windows, 'onCreated', trigger); on(chrome.windows, 'onRemoved', trigger);
  on(chrome.windows, 'onFocusChanged', trigger);

  chrome.windows.getCurrent().then((w) => { currentWindowId = w.id; refresh(); });

  return {
    refresh,
    dispose() { disposed = true; for (const [evt, fn] of evs) { try { evt.removeListener(fn); } catch {} } },
  };
}
