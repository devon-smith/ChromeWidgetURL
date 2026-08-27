// Dashboard entry. Orchestrates the three panes, owns UI state (search, tag
// filter, view), applies the theme, and keeps everything in sync via the store
// change feed. The dashboard is a long-lived page, so it reads/writes storage
// directly through store.js and calls chrome.tabs directly for opens/restores.

import * as store from '../lib/store.js';
import * as tabsLib from '../lib/tabs.js';
import { safeHref, normalizeUrl } from '../lib/url-safe.js';
import { rafCoalesce } from '../lib/debounce.js';
import { el } from '../lib/dom.js';
import { renderSidebar } from './components/spaces-sidebar.js';
import { renderToolbar } from './components/toolbar.js';
import { renderCollections } from './components/collections-view.js';
import { mountOpenTabs } from './components/open-tabs-panel.js';
import { toast } from './components/toast.js';
import { confirmDialog, promptDialog, openModal } from './components/modal.js';
import { initDnd } from './components/dnd.js';

const els = {
  shell: document.getElementById('app-shell'),
  sidebar: document.getElementById('region-sidebar'),
  toolbar: document.getElementById('toolbar-root'),
  center: document.getElementById('center-scroll'),
  tabs: document.getElementById('region-tabs'),
};

const app = {
  state: null,
  settings: null,
  tagsById: {},
  activeSpace: null,
  search: '',
  showTagFilter: false,
  tagFilter: { ids: new Set(), mode: 'or' },
  toast,
};

let openTabsCtl = null;

/* ----------------------------- lifecycle ------------------------------ */
async function boot() {
  await store.init();
  await loadState();
  initDnd(app);
  openTabsCtl = mountOpenTabs(els.tabs, app);
  render();
  wireKeyboard();
  wireResponsiveToggles();

  const scheduleSync = rafCoalesce(async () => { await loadState(); render(); openTabsCtl?.refresh(); });
  // Skip re-render on non-structural writes (e.g. touchItemOpened bumps no rev),
  // so opening a link doesn't rebuild the whole dashboard.
  store.subscribe(({ changes }) => {
    const structural = Object.values(changes).some((c) => (c.newValue?.rev) !== (c.oldValue?.rev));
    if (structural) scheduleSync();
  });
}

async function loadState() {
  app.state = await store.getState();
  app.settings = app.state.settings;
  app.tagsById = Object.fromEntries(app.state.tags.map((t) => [t.id, t]));
  const activeId = app.state.meta.activeSpaceId;
  app.activeSpace = app.state.spaces.find((s) => s.id === activeId) || app.state.spaces[0] || null;
}

/* ----------------------------- rendering ------------------------------ */
function render() {
  applyTheme(app.settings.theme);
  updateShellClasses();
  renderSidebar(els.sidebar, app);
  renderToolbar(els.toolbar, app);
  renderCollections(els.center, computeView(), app);
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
  else delete root.dataset.theme;
}

function updateShellClasses() {
  els.shell.classList.toggle('sidebar-collapsed', !!app.settings.sidebarCollapsed);
  els.shell.classList.toggle('tabs-hidden', app.settings.openTabsPanelVisible === false);
  els.shell.classList.toggle('view-list', app.settings.defaultView === 'list');
}

/* --------------------------- filtering -------------------------------- */
function computeView() {
  if (!app.activeSpace) return [];
  const q = app.search.trim().toLowerCase();
  const filterIds = app.tagFilter.ids;
  const mode = app.tagFilter.mode;

  const itemPassesTags = (it) => {
    if (!filterIds.size) return true;
    const ids = it.tagIds || [];
    return mode === 'and'
      ? [...filterIds].every((id) => ids.includes(id))
      : ids.some((id) => filterIds.has(id));
  };
  const itemMatchesQuery = (it) => {
    if (!q) return true;
    const tagNames = (it.tagIds || []).map((id) => app.tagsById[id]?.name || '').join(' ');
    return [it.title, it.url, it.domain, it.note, it.sourceLabel, tagNames]
      .filter(Boolean).some((s) => String(s).toLowerCase().includes(q));
  };

  const out = [];
  for (const col of app.activeSpace.collections) {
    const collMatches = q && (col.name.toLowerCase().includes(q) || (col.note || '').toLowerCase().includes(q));
    const items = col.items.filter((it) => itemPassesTags(it) && (collMatches || itemMatchesQuery(it)));
    if (!q && !filterIds.size) { out.push({ col, items }); continue; }
    if (items.length || collMatches) out.push({ col, items });
  }
  return out;
}

/* ------------------------------- actions ------------------------------ */
app.findCollection = (collectionId) => {
  for (const s of app.state.spaces) { const c = s.collections.find((x) => x.id === collectionId); if (c) return c; }
  return null;
};

app.setActiveSpace = (id) => { store.setActiveSpace(id); };

app.addSpace = async () => {
  const name = await promptDialog({ title: 'New space', label: 'Space name', placeholder: 'e.g. Work', confirmLabel: 'Create' });
  if (!name) return;
  const s = await store.createSpace({ name });
  await store.setActiveSpace(s.id);
};

app.addCollection = async (spaceId) => {
  const target = spaceId || app.activeSpace?.id;
  if (!target) return null;
  const name = await promptDialog({ title: 'New collection', label: 'Collection name', placeholder: 'e.g. Research', confirmLabel: 'Create' });
  if (!name) return null;
  const c = await store.createCollection(target, { name });
  return c.id;
};

/** Pick the most relevant real browser tab to capture (never the dashboard). */
async function pickCaptureTab() {
  let [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (t && safeHref(t.url)) return t;
  const actives = await chrome.tabs.query({ active: true });
  return actives.find((x) => safeHref(x.url)) || null;
}

app.saveCurrentTabTo = async (collectionId) => {
  const tab = await pickCaptureTab();
  if (!tab) {
    // fall back to a manual URL entry
    const url = await promptDialog({ title: 'Add a link', label: 'URL', placeholder: 'https://…', confirmLabel: 'Add' });
    if (!url || !safeHref(url)) { if (url) toast('That URL can’t be added', { variant: 'error' }); return; }
    const { duplicate } = await store.addItem(collectionId, { url });
    toast(duplicate ? 'Already in this collection' : 'Link added');
    return;
  }
  const r = await store.addItemsFromTabs(collectionId, [tab]);
  toast(r.length ? 'Tab saved' : 'Already in this collection');
};

app.saveAllTabs = async () => {
  const winTabs = (await chrome.tabs.query({ currentWindow: true })).sort((a, b) => a.index - b.index);
  const openable = winTabs.filter((t) => safeHref(t.url));
  if (!openable.length) { toast('No saveable tabs in this window', { variant: 'error' }); return; }
  const spaceId = app.activeSpace?.id;
  const name = defaultName();
  const col = await store.createCollection(spaceId, { name });
  const created = await store.addItemsFromTabs(col.id, winTabs);
  const skipped = winTabs.length - created.length;
  toast(`Saved ${created.length} tab${created.length === 1 ? '' : 's'}${skipped ? ` · ${skipped} skipped` : ''}`, { variant: 'success' });
};

app.saveWindow = async (windowId) => {
  const winTabs = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
  const spaceId = app.activeSpace?.id;
  const col = await store.createCollection(spaceId, { name: defaultName() });
  const created = await store.addItemsFromTabs(col.id, winTabs);
  toast(`Saved ${created.length} tab${created.length === 1 ? '' : 's'} to new collection`, { variant: 'success' });
};

app.restore = async (collectionId, mode) => {
  const col = app.findCollection(collectionId);
  const count = col ? col.items.filter((i) => safeHref(i.url)).length : 0;
  if (!count) { toast('Nothing to open in this collection', { variant: 'error' }); return; }
  if (count > (app.settings.largeOpenThreshold || 15)) {
    const ok = await confirmDialog({ title: 'Open many tabs?', message: `This will open ${count} tabs.`, confirmLabel: `Open ${count}` });
    if (!ok) return;
  }
  try { const r = await tabsLib.restoreCollection(collectionId, mode); toast(`Opened ${r.openedCount} tab${r.openedCount === 1 ? '' : 's'}`); }
  catch (e) { toast(String(e.message || e), { variant: 'error' }); }
};

app.openLink = async (collectionId, itemId, opts = {}) => {
  try { await tabsLib.openLink(collectionId, itemId, opts); }
  catch (e) { toast(String(e.message || e), { variant: 'error' }); }
};

app.moveItemDialog = (item, fromCollectionId) => {
  const options = [];
  for (const s of app.state.spaces) for (const c of s.collections) if (c.id !== fromCollectionId) options.push({ id: c.id, label: `${c.name} · ${s.name}` });
  if (!options.length) { toast('No other collection to move to', { variant: 'error' }); return; }
  openModal((close) => {
    const select = el('select', {}, options.map((o) => el('option', { value: o.id, text: o.label })));
    return {
      title: 'Move card to…',
      body: el('label', {}, [el('span', { text: 'Collection' }), select]),
      footer: [
        el('button', { class: 'btn btn-ghost', text: 'Cancel', on: { click: () => close() } }),
        el('button', { class: 'btn btn-primary', text: 'Move', on: { click: async () => { await store.moveItem(item.id, fromCollectionId, select.value); close(); toast('Card moved'); } } }),
      ],
    };
  });
};

app.moveCollectionDialog = (col) => {
  const options = app.state.spaces.filter((s) => s.id !== col.spaceId).map((s) => ({ id: s.id, label: s.name }));
  if (!options.length) { toast('No other space to move to', { variant: 'error' }); return; }
  openModal((close) => {
    const select = el('select', {}, options.map((o) => el('option', { value: o.id, text: o.label })));
    return {
      title: 'Move collection to space…',
      body: el('label', {}, [el('span', { text: 'Space' }), select]),
      footer: [
        el('button', { class: 'btn btn-ghost', text: 'Cancel', on: { click: () => close() } }),
        el('button', { class: 'btn btn-primary', text: 'Move', on: { click: async () => { await store.moveCollection(col.id, select.value); close(); toast('Collection moved'); } } }),
      ],
    };
  });
};

app.setAllCollapsed = async (collapsed) => {
  if (!app.activeSpace) return;
  for (const c of app.activeSpace.collections) {
    if (!!c.isCollapsed !== collapsed) await store.saveCollection(c.id, { isCollapsed: collapsed });
  }
};

app.toggleSidebar = () => store.updateSettings({ sidebarCollapsed: !app.settings.sidebarCollapsed });
app.toggleTabsPanel = () => store.updateSettings({ openTabsPanelVisible: app.settings.openTabsPanelVisible === false });
app.openSettings = () => chrome.tabs.create({ url: chrome.runtime.getURL('src/dashboard/settings.html') });

app.setSearch = (q) => { app.search = q; renderCollections(els.center, computeView(), app); syncSearchInput(); };
app.toggleTagFilter = () => { app.showTagFilter = !app.showTagFilter; renderToolbar(els.toolbar, app); };
app.toggleTag = (id) => { app.tagFilter.ids.has(id) ? app.tagFilter.ids.delete(id) : app.tagFilter.ids.add(id); renderToolbar(els.toolbar, app); renderCollections(els.center, computeView(), app); };
app.toggleTagMode = () => { app.tagFilter.mode = app.tagFilter.mode === 'and' ? 'or' : 'and'; renderToolbar(els.toolbar, app); renderCollections(els.center, computeView(), app); };
app.clearFilters = () => { app.search = ''; app.tagFilter.ids.clear(); render(); };

function syncSearchInput() {
  if (app.searchInputRef && app.searchInputRef.value !== app.search) app.searchInputRef.value = app.search;
}

/* --------------------------- keyboard --------------------------------- */
function wireKeyboard() {
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
    if ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key === 'f')) {
      e.preventDefault(); app.searchInputRef?.focus(); return;
    }
    if (typing) { if (e.key === 'Escape' && document.activeElement === app.searchInputRef) app.setSearch(''); return; }
    if (e.key === 'Escape') { if (app.search || app.tagFilter.ids.size) app.clearFilters(); }
    else if (e.key === 'n') { e.preventDefault(); app.addCollection(); }
    else if (e.key === 't') { e.preventDefault(); app.toggleTabsPanel(); }
    else if (e.key === '[' || e.key === ']') { e.preventDefault(); app.toggleSidebar(); }
  });
}

function wireResponsiveToggles() {
  const reopen = document.getElementById('tabs-reopen');
  if (reopen) reopen.addEventListener('click', () => app.toggleTabsPanel());
}

function defaultName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Tabs ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

boot().catch((e) => { console.error(e); toast('Failed to load: ' + (e.message || e), { variant: 'error' }); });
