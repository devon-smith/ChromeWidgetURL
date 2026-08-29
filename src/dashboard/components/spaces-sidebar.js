// Left pane: workspace header, search, favorites + spaces list, add-space,
// footer actions (settings / export).

import { el, icon, iconBtn } from '../../lib/dom.js';
import * as store from '../../lib/store.js';
import { openMenu } from './menu.js';
import { confirmDialog, promptDialog } from './modal.js';
import * as dnd from './dnd.js';

export function renderSidebar(container, app) {
  container.replaceChildren();
  const inner = el('div', { class: 'sidebar-inner' });

  // workspace switcher
  inner.append(el('div', { class: 'workspace-switcher', attrs: { role: 'button', tabindex: '0' } }, [
    el('span', { class: 'workspace-avatar', text: '🧭' }),
    el('span', { class: 'workspace-name clamp-1', text: 'Local Toby' }),
    iconBtn('list', { title: 'Toggle sidebar', cls: 'sidebar-collapse-btn', size: 15, onClick: () => app.toggleSidebar() }),
  ]));

  // search
  const searchInput = el('input', {
    type: 'search', placeholder: 'Search spaces & tabs…', value: app.search || '',
    attrs: { 'aria-label': 'Search' },
    on: { input: (e) => app.setSearch(e.target.value) },
  });
  app.searchInputRef = searchInput;
  const searchBox = el('div', { class: 'search-input' }, [
    icon('search', { cls: 'icon' }),
    searchInput,
    app.search ? iconBtn('x', { title: 'Clear', cls: 'search-clear', size: 14, onClick: () => app.setSearch('') }) : null,
  ]);
  inner.append(el('div', { class: 'sidebar-search' }, [searchBox]));

  const spaces = app.state.spaces;
  const favorites = spaces.filter((s) => s.isFavorite);
  const others = spaces.filter((s) => !s.isFavorite);

  if (favorites.length) {
    inner.append(sectionTitle('Favorites'));
    inner.append(spaceList(favorites, app));
  }
  inner.append(sectionTitle('Spaces', () => app.addSpace()));
  inner.append(spaceList(others, app));

  // add space
  inner.append(el('button', {
    class: 'add-space-row', on: { click: () => app.addSpace() },
  }, [icon('plus'), 'Add space']));

  // footer
  inner.append(el('div', { class: 'sidebar-footer' }, [
    syncPill(app),
    el('button', { class: 'btn btn-ghost', on: { click: () => app.openSettings() } }, [icon('gear'), 'Settings']),
  ]));

  container.append(inner);
}

function relTime(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function syncPill(app) {
  const s = app.settings || {};
  const connected = !!s.syncConnected;
  const rel = connected ? relTime(s.lastSyncAt) : '';
  return el('button', {
    class: `sync-pill ${connected ? 'is-on' : ''}`,
    attrs: { title: connected ? 'Synced to Google Drive — open Settings' : 'Sync is off — open Settings' },
    on: { click: () => app.openSettings() },
  }, [
    el('span', { class: 'sync-dot' }),
    el('span', { class: 'clamp-1', text: connected ? `Synced${rel ? ' · ' + rel : ''}` : 'Sync off' }),
  ]);
}

function sectionTitle(text, onAdd) {
  return el('div', { class: 'sidebar-section-title' }, [
    el('span', { text }),
    onAdd ? iconBtn('plus', { title: 'Add space', size: 14, onClick: onAdd }) : null,
  ]);
}

function spaceList(spaces, app) {
  const list = el('ul', { class: 'space-list' });
  for (const s of spaces) list.append(spaceItem(s, app));
  return list;
}

function spaceItem(s, app) {
  const active = s.id === app.state.meta.activeSpaceId;
  const count = s.collections.length;
  const li = el('li', {
    class: `space-item ${active ? 'is-active' : ''}`,
    attrs: { role: 'button', tabindex: '0', 'aria-current': active ? 'page' : null, title: s.name },
    dataset: { spaceId: s.id },
    on: {
      click: () => app.setActiveSpace(s.id),
      keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); app.setActiveSpace(s.id); } },
      contextmenu: (e) => { e.preventDefault(); spaceMenu(e.currentTarget, s, app); },
    },
  }, [
    el('span', { class: 'space-icon', text: s.icon || '🗂️' }),
    el('span', { class: 'space-label clamp-1', text: s.name }),
    el('span', { class: 'space-count', text: String(count) }),
    el('button', {
      class: `btn btn-icon space-star ${s.isFavorite ? 'is-fav' : ''}`,
      attrs: { title: s.isFavorite ? 'Unfavorite' : 'Favorite', 'aria-label': 'Toggle favorite' },
      on: { click: (e) => { e.stopPropagation(); store.updateSpace(s.id, { isFavorite: !s.isFavorite }); } },
    }, [icon('star', { size: 14 })]),
    el('button', {
      class: 'btn btn-icon space-menu',
      attrs: { title: 'Space menu', 'aria-label': 'Space menu' },
      on: { click: (e) => { e.stopPropagation(); spaceMenu(e.currentTarget, s, app); } },
    }, [icon('dots', { size: 14 })]),
  ]);
  dnd.attachSpaceDropTarget(li, s.id);
  return li;
}

function spaceMenu(anchor, s, app) {
  openMenu(anchor, [
    { label: 'Rename…', icon: 'gear', onClick: async () => {
      const v = await promptDialog({ title: 'Rename space', label: 'Name', value: s.name });
      if (v) store.updateSpace(s.id, { name: v });
    } },
    { label: s.isFavorite ? 'Remove from favorites' : 'Add to favorites', icon: 'star', onClick: () => store.updateSpace(s.id, { isFavorite: !s.isFavorite }) },
    { label: 'New collection here…', icon: 'plus', onClick: () => app.addCollection(s.id) },
    { label: 'Open all as windows', icon: 'window', onClick: () => app.restoreSessionSpace(s.id) },
    { separator: true },
    { label: 'Delete space', icon: 'trash', danger: true, onClick: () => deleteSpace(s, app) },
  ]);
}

async function deleteSpace(s, app) {
  if (app.state.spaces.length <= 1) { app.toast('You can’t delete your only space', { variant: 'error' }); return; }
  const ok = await confirmDialog({
    title: 'Delete space?',
    message: s.collections.length
      ? `“${s.name}” contains ${s.collections.length} collection(s). Deleting removes them too. This can be undone.`
      : `Delete “${s.name}”? This can be undone.`,
    confirmLabel: 'Delete', danger: true,
  });
  if (!ok) return;
  const index = app.state.meta.spaceOrder.indexOf(s.id);
  const snapshot = s; // hydrated space with collections
  await store.deleteSpace(s.id);
  app.toast('Space deleted', {
    undo: async () => { await store.reinsertSpace(snapshot, index); },
  });
}
