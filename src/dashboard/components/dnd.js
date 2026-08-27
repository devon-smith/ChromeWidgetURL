// Drag & drop wiring. Uses HTML5 DnD. A module-level dragState carries the
// payload (dataTransfer.getData is unavailable during dragover). Supports:
//  - moving/reordering cards within and across collections
//  - dropping a live open-tab row into a collection (saves it)
//  - reordering collections by their header
//  - moving a collection onto a sidebar space
// Globally gated by settings.dndEnabled.

import * as store from '../../lib/store.js';
import { normalizeUrl } from '../../lib/url-safe.js';

let dragState = null; // { kind:'item'|'tab'|'collection', ... }
let app = null;

export function initDnd(context) { app = context; }

function enabled() { return app?.settings?.dndEnabled !== false; }

/* ----------------------------- cards ----------------------------- */
export function attachCard(cardEl, item, collectionId) {
  if (!enabled()) return;
  cardEl.addEventListener('dragstart', (e) => {
    dragState = { kind: 'item', itemId: item.id, fromCollectionId: collectionId };
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', item.url || ''); } catch {}
    cardEl.classList.add('dragging');
  });
  cardEl.addEventListener('dragend', () => { cardEl.classList.remove('dragging'); dragState = null; clearDropTargets(); });
}

/* --------------------------- tab rows ---------------------------- */
export function attachTabRow(rowEl, tab) {
  if (!enabled()) return;
  rowEl.setAttribute('draggable', 'true');
  rowEl.addEventListener('dragstart', (e) => {
    dragState = { kind: 'tab', tab };
    e.dataTransfer.effectAllowed = 'copy';
    try { e.dataTransfer.setData('text/plain', tab.url || ''); } catch {}
    rowEl.classList.add('dragging');
  });
  rowEl.addEventListener('dragend', () => { rowEl.classList.remove('dragging'); dragState = null; clearDropTargets(); });
}

/* --------------------- collection drop zone ---------------------- */
export function attachCollectionDropZone(collectionEl, bodyEl, collectionId) {
  const over = (e) => {
    if (!dragState || (dragState.kind !== 'item' && dragState.kind !== 'tab')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = dragState.kind === 'tab' ? 'copy' : 'move';
    collectionEl.classList.add('drop-target-header');
  };
  const leave = (e) => { if (!collectionEl.contains(e.relatedTarget)) collectionEl.classList.remove('drop-target-header'); };
  const drop = async (e) => {
    // Only handle card/tab drops here. Collection-header drags must bubble up to
    // attachCollectionsContainer with dragState intact.
    if (!dragState || (dragState.kind !== 'item' && dragState.kind !== 'tab')) return;
    e.preventDefault();
    collectionEl.classList.remove('drop-target-header');
    const index = resolveDropIndex(bodyEl, e.clientX, e.clientY, collectionId);
    const s = dragState; dragState = null;
    try {
      if (s.kind === 'item') {
        if (s.fromCollectionId === collectionId) {
          await store.moveItem(s.itemId, collectionId, collectionId, index);
        } else {
          // Note (don't block) if the target already holds this URL.
          const src = app.findCollection?.(s.fromCollectionId);
          const target = app.findCollection?.(collectionId);
          const moving = src?.items.find((i) => i.id === s.itemId);
          const dup = moving && target && target.items.some((i) => normalizeUrl(i.url) === normalizeUrl(moving.url));
          await store.moveItem(s.itemId, s.fromCollectionId, collectionId, index);
          if (dup) app.toast('Moved — note: that link is already in this collection');
        }
      } else if (s.kind === 'tab') {
        const { item, duplicate } = await store.addItem(collectionId, {
          url: s.tab.url, title: s.tab.title, faviconUrl: s.tab.favIconUrl || null,
        });
        if (duplicate) app.toast('Already saved to this collection');
        else { if (index >= 0) await store.moveItem(item.id, collectionId, collectionId, index); app.toast('Tab saved'); }
      }
    } catch (err) { app.toast(String(err.message || err), { variant: 'error' }); }
  };
  collectionEl.addEventListener('dragover', over);
  collectionEl.addEventListener('dragleave', leave);
  collectionEl.addEventListener('drop', drop);
}

/* ------------------ collection header reorder -------------------- */
export function attachCollectionHeader(headerEl, collectionId, spaceId) {
  if (!enabled()) return;
  headerEl.setAttribute('draggable', 'true');
  headerEl.addEventListener('dragstart', (e) => {
    dragState = { kind: 'collection', collectionId, spaceId };
    e.dataTransfer.effectAllowed = 'move';
    e.stopPropagation();
  });
  headerEl.addEventListener('dragend', () => { dragState = null; });
}

/**
 * Register the center container so collections can be reordered by header drop.
 * Idempotent: binds listeners once (the container element persists across
 * re-renders). The current space id is read from containerEl.dataset.spaceId,
 * and the new order is computed against the space's FULL collection order so it
 * stays a valid permutation even when a search/tag filter is showing a subset.
 */
export function attachCollectionsContainer(containerEl) {
  if (containerEl.__dndBound) return;
  containerEl.__dndBound = true;
  containerEl.addEventListener('dragover', (e) => {
    if (dragState?.kind === 'collection') { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  });
  containerEl.addEventListener('drop', async (e) => {
    if (dragState?.kind !== 'collection') return;
    e.preventDefault();
    const spaceId = containerEl.dataset.spaceId;
    const targetEl = e.target.closest('[data-collection-el]');
    const s = dragState; dragState = null;
    if (!spaceId || s.spaceId !== spaceId) return;
    const space = app.state.spaces.find((x) => x.id === spaceId);
    if (!space) return;
    const order = space.collections.map((c) => c.id).filter((id) => id !== s.collectionId);
    let to = order.length;
    if (targetEl) { const ti = order.indexOf(targetEl.dataset.collectionEl); if (ti >= 0) to = ti; }
    order.splice(to, 0, s.collectionId);
    try { await store.reorderCollections(spaceId, order); } catch (err) { app.toast(String(err.message || err), { variant: 'error' }); }
  });
}

/* --------------------- space as drop target ---------------------- */
export function attachSpaceDropTarget(spaceEl, spaceId) {
  spaceEl.addEventListener('dragover', (e) => {
    if (dragState?.kind === 'collection' && dragState.spaceId !== spaceId) {
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'; spaceEl.classList.add('drop-target');
    }
  });
  spaceEl.addEventListener('dragleave', () => spaceEl.classList.remove('drop-target'));
  spaceEl.addEventListener('drop', async (e) => {
    spaceEl.classList.remove('drop-target');
    if (dragState?.kind !== 'collection') return;
    e.preventDefault();
    const s = dragState; dragState = null;
    try { await store.moveCollection(s.collectionId, spaceId); app.toast('Collection moved'); }
    catch (err) { app.toast(String(err.message || err), { variant: 'error' }); }
  });
}

/* ----------------------------- utils ----------------------------- */

// Map a drop position to an index in the collection's REAL itemOrder. When a
// search/tag filter is active only a subset of cards is rendered, so the visual
// slot is translated via the anchor card's id to the real position (otherwise a
// drop would land relative to the filtered subset, not the full list).
function resolveDropIndex(bodyEl, clientX, clientY, collectionId) {
  const visualIndex = computeDropIndex(bodyEl, clientX, clientY);
  const filtering = app && (app.search || (app.tagFilter && app.tagFilter.ids.size));
  if (!filtering) return visualIndex;
  const col = app.findCollection?.(collectionId);
  if (!col) return visualIndex;
  const realOrder = col.items.map((i) => i.id);
  const cards = [...bodyEl.querySelectorAll('.card')].filter((c) => !c.classList.contains('dragging'));
  if (visualIndex >= cards.length) return realOrder.length; // append
  const anchorId = cards[visualIndex]?.dataset.itemId;
  const ri = realOrder.indexOf(anchorId);
  return ri >= 0 ? ri : realOrder.length;
}

function computeDropIndex(bodyEl, clientX, clientY) {
  const cards = [...bodyEl.querySelectorAll('.card')].filter((c) => !c.classList.contains('dragging'));
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (r.top - clientY > 8) return i;                          // card starts below pointer row
    const inRow = clientY >= r.top - 8 && clientY <= r.bottom + 8;
    if (inRow && clientX < r.left + r.width / 2) return i;      // same row, left of center
  }
  return cards.length;
}

function clearDropTargets() {
  document.querySelectorAll('.drop-target, .drop-target-header')
    .forEach((n) => n.classList.remove('drop-target', 'drop-target-header'));
}
