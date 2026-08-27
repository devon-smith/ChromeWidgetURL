// Center pane: renders the active space's collections as card grids, with
// inline rename, collapse, per-collection menu, add-card, and drop zones.

import { el, icon, iconBtn } from '../../lib/dom.js';
import * as store from '../../lib/store.js';
import { renderCard } from './card.js';
import { openMenu } from './menu.js';
import { confirmDialog, promptDialog } from './modal.js';
import * as dnd from './dnd.js';

/**
 * @param {HTMLElement} container
 * @param {{col:object, items:object[]}[]} viewCollections
 * @param {object} app
 */
export function renderCollections(container, viewCollections, app) {
  container.replaceChildren();

  if (!viewCollections.length) {
    container.append(emptyState(app));
    return;
  }

  container.dataset.spaceId = app.activeSpace?.id || '';
  dnd.attachCollectionsContainer(container);

  for (const { col, items } of viewCollections) {
    container.append(renderCollection(col, items, app));
  }
}

function renderCollection(col, items, app) {
  const wrap = el('section', {
    class: `collection ${col.isCollapsed ? 'is-collapsed' : ''}`,
    attrs: { role: 'region', 'aria-label': col.name },
    dataset: { collectionEl: col.id },
  });

  const titleEl = el('span', { class: 'collection-title', text: col.name });
  const chevron = el('button', {
    class: 'collection-chevron', attrs: { 'aria-expanded': String(!col.isCollapsed), 'aria-label': 'Toggle collection' },
    on: { click: () => store.saveCollection(col.id, { isCollapsed: !col.isCollapsed }) },
  }, [icon('chevronDown')]);

  const header = el('div', { class: 'collection-header' }, [
    chevron,
    col.color ? el('span', { class: 'collection-color-dot', style: { background: col.color } }) : null,
    titleEl,
    el('span', { class: 'pill collection-count', text: String(items.length), attrs: { 'aria-label': `${items.length} tabs` } }),
    el('div', { class: 'collection-actions' }, [
      iconBtn('external', { title: 'Open all in new window', size: 15, onClick: () => app.restore(col.id, 'newWindow') }),
      iconBtn('plus', { title: 'Add current tab', size: 15, onClick: () => app.saveCurrentTabTo(col.id) }),
      iconBtn('dots', { title: 'Collection menu', size: 15, onClick: (e) => collectionMenu(e.currentTarget, col, app) }),
    ]),
  ]);

  // inline rename on double-click of the title
  titleEl.addEventListener('dblclick', () => startRename(titleEl, col));
  dnd.attachCollectionHeader(header, col.id, col.spaceId);

  const body = el('div', { class: 'collection-body' });
  const grid = el('div', { class: 'card-grid' });
  if (!items.length) {
    grid.append(el('div', { class: 'collection-empty' }, [icon('plus'), 'Drag tabs here, or add the current tab']));
  } else {
    for (const item of items) {
      const card = renderCard(item, col.id, app);
      dnd.attachCard(card, item, col.id);
      grid.append(card);
    }
  }
  grid.append(el('button', {
    class: 'add-card-row', on: { click: () => app.saveCurrentTabTo(col.id) },
  }, [icon('plus'), 'Add current tab']));
  body.append(grid);

  wrap.append(header, body);
  dnd.attachCollectionDropZone(wrap, grid, col.id);
  return wrap;
}

function startRename(titleEl, col) {
  const input = el('input', { class: 'inline-input', value: col.name });
  let done = false; // guards against the blur that fires when we detach on cancel
  const commit = async () => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    input.replaceWith(titleEl);
    if (v && v !== col.name) await store.saveCollection(col.id, { name: v });
  };
  const cancel = () => { if (done) return; done = true; input.replaceWith(titleEl); };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
  titleEl.replaceWith(input);
  input.focus(); input.select();
}

function collectionMenu(anchor, col, app) {
  openMenu(anchor, [
    { label: 'Open all (current window)', icon: 'external', onClick: () => app.restore(col.id, 'currentWindow') },
    { label: 'Open all in new window', icon: 'window', onClick: () => app.restore(col.id, 'newWindow') },
    { separator: true },
    { label: 'Rename…', icon: 'gear', onClick: async () => {
      const v = await promptDialog({ title: 'Rename collection', label: 'Name', value: col.name });
      if (v) store.saveCollection(col.id, { name: v });
    } },
    { label: col.isCollapsed ? 'Expand' : 'Collapse', icon: 'chevronDown', onClick: () => store.saveCollection(col.id, { isCollapsed: !col.isCollapsed }) },
    { label: 'Move to space…', icon: 'external', onClick: () => app.moveCollectionDialog(col) },
    { separator: true },
    { label: 'Delete collection', icon: 'trash', danger: true, onClick: () => deleteCollection(col, app) },
  ]);
}

async function deleteCollection(col, app) {
  if (app.settings.confirmOnDelete) {
    const ok = await confirmDialog({
      title: 'Delete collection?',
      message: `“${col.name}” has ${col.items.length} card${col.items.length === 1 ? '' : 's'}. This can be undone.`,
      confirmLabel: 'Delete', danger: true,
    });
    if (!ok) return;
  }
  const space = app.activeSpace;
  const index = space ? space.collections.findIndex((c) => c.id === col.id) : -1;
  const snapshot = app.findCollection(col.id); // hydrated (items array)
  await store.deleteCollection(col.id);
  app.toast('Collection deleted', {
    undo: async () => { await store.reinsertCollection(col.spaceId, snapshot, index); },
  });
}

function emptyState(app) {
  const hasFilter = app.search || (app.tagFilter && app.tagFilter.ids.size);
  if (hasFilter) {
    return el('div', { class: 'empty-state' }, [
      el('h3', { text: 'No matching tabs' }),
      el('p', { text: 'Try a different search or clear your filters.' }),
      el('div', { class: 'empty-actions' }, [
        el('button', { class: 'btn btn-primary', text: 'Clear filters', on: { click: () => app.clearFilters() } }),
      ]),
    ]);
  }
  return el('div', { class: 'empty-state' }, [
    el('h3', { text: 'This space is empty' }),
    el('p', { text: 'Collections group related tabs. Create one, then save the tabs you have open — from the right panel or the toolbar.' }),
    el('div', { class: 'empty-actions' }, [
      el('button', { class: 'btn btn-primary', text: 'Save all open tabs', on: { click: () => app.saveAllTabs() } }),
      el('button', { class: 'btn btn-ghost', text: 'Add collection', on: { click: () => app.addCollection() } }),
    ]),
  ]);
}
