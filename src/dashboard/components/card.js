// Renders one Item as a card. Untrusted fields (title, url, source, note) go in
// via textContent only. The card opens its URL on click; action buttons and the
// drag handle are revealed on hover/focus.

import { el, icon, iconBtn } from '../../lib/dom.js';
import { faviconImg } from '../../lib/favicon.js';
import { safeHref } from '../../lib/url-safe.js';
import * as store from '../../lib/store.js';
import { openMenu } from './menu.js';
import { openModal } from './modal.js';
import { tagInput } from './tag-input.js';

/**
 * @param {object} item
 * @param {string} collectionId
 * @param {object} app - dashboard context (toast, confirm, openLink, tagsById)
 */
export function renderCard(item, collectionId, app) {
  const href = safeHref(item.url);
  const card = el('article', {
    class: 'card',
    attrs: {
      role: 'button', tabindex: '0',
      'aria-label': item.title || item.url,
      title: item.url,
      draggable: app.settings.dndEnabled ? 'true' : 'false',
    },
    dataset: { itemId: item.id, collectionId },
  });

  if (app.isCardSelected?.(item.id)) card.classList.add('selected');

  const selectBox = el('button', {
    class: 'card-select', attrs: { 'aria-label': 'Select card', title: 'Select', type: 'button' },
    on: { click: (e) => { e.stopPropagation(); app.toggleCardSelection?.(collectionId, item); } },
  }, [icon('check', { size: 12 })]);

  const handle = el('span', { class: 'card-handle', attrs: { 'aria-hidden': 'true' } }, [icon('dots')]);

  const titleSpan = el('span', { class: 'card-title clamp-2' });
  appendHighlighted(titleSpan, item.title || item.domain || item.url, app.search);
  const sourceSpan = el('span', { class: 'card-source clamp-1' });
  appendHighlighted(sourceSpan, item.sourceLabel || item.domain || '', app.search);
  const body = el('div', { class: 'card-body' }, [titleSpan, sourceSpan]);
  if (item.note) body.append(el('span', { class: 'card-note clamp-2', text: item.note }));

  // tags — clicking a chip adds it to the active tag filter
  const tagChips = (item.tagIds || []).map((id) => ({ id, tag: app.tagsById?.[id] })).filter((x) => x.tag);
  if (tagChips.length) {
    const wrap = el('div', { class: 'card-tags' });
    for (const { id, tag } of tagChips) {
      wrap.append(el('button', {
        class: 'chip tag-chip-btn', text: `#${tag.name}`, attrs: { title: `Filter by #${tag.name}`, type: 'button' },
        on: { click: (e) => { e.stopPropagation(); app.toggleTag?.(id); if (!app.showTagFilter) app.toggleTagFilter?.(); } },
      }));
    }
    body.append(wrap);
  }

  const actions = el('div', { class: 'card-actions' }, [
    iconBtn('external', { title: 'Open in new tab', size: 14, onClick: (e) => { e.stopPropagation(); app.openLink(collectionId, item.id, { active: false }); } }),
    iconBtn('copy', { title: 'Copy link', size: 14, onClick: (e) => { e.stopPropagation(); copyUrl(item, app); } }),
    iconBtn('dots', { title: 'More', size: 14, onClick: (e) => { e.stopPropagation(); cardMenu(e.currentTarget, item, collectionId, app); } }),
  ]);

  card.append(selectBox, handle, faviconImg(item, app.settings.faviconSize), body, actions);

  // open on click / Enter (ignore clicks on action buttons)
  const open = (opts) => { if (href) app.openLink(collectionId, item.id, opts); else app.toast('This link can’t be opened (unsupported URL).', { variant: 'error' }); };
  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-actions')) return;
    if (e.button === 1) return; // middle handled below
    open({ active: false, newWindow: e.shiftKey });
  });
  card.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); open({ active: false }); } });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); open({ active: true }); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteCard(item, collectionId, app); }
  });

  return card;
}

// Append `text` to `parent` as text nodes, wrapping case-insensitive matches of
// `query` in <mark>. Untrusted-safe: only textContent + createElement, no HTML.
function appendHighlighted(parent, text, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) { parent.append(document.createTextNode(text)); return; }
  const lower = text.toLowerCase();
  let i = 0, idx;
  while ((idx = lower.indexOf(q, i)) !== -1) {
    if (idx > i) parent.append(document.createTextNode(text.slice(i, idx)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(idx, idx + q.length);
    parent.append(mark);
    i = idx + q.length;
  }
  if (i < text.length) parent.append(document.createTextNode(text.slice(i)));
}

async function copyUrl(item, app) {
  try { await navigator.clipboard.writeText(item.url); app.toast('Link copied'); }
  catch { app.toast('Couldn’t copy link', { variant: 'error' }); }
}

function cardMenu(anchor, item, collectionId, app) {
  openMenu(anchor, [
    { label: 'Open', icon: 'external', onClick: () => app.openLink(collectionId, item.id, { active: true }) },
    { label: 'Open in new window', icon: 'window', onClick: () => app.openLink(collectionId, item.id, { newWindow: true }) },
    { label: 'Copy link', icon: 'copy', onClick: () => copyUrl(item, app) },
    { separator: true },
    { label: 'Edit…', icon: 'gear', onClick: () => editCard(item, collectionId, app) },
    { label: 'Move to…', icon: 'external', onClick: () => app.moveItemDialog(item, collectionId) },
    { separator: true },
    { label: 'Delete', icon: 'trash', danger: true, onClick: () => deleteCard(item, collectionId, app) },
  ]);
}

async function editCard(item, collectionId, app) {
  const allTags = [...(app.state?.tags || [])];
  await openModal((close) => {
    const titleInput = el('input', { type: 'text', value: item.title || '', attrs: { 'aria-label': 'Title' } });
    const noteInput = el('textarea', { attrs: { 'aria-label': 'Note', placeholder: 'Optional note…' } });
    noteInput.value = item.note || '';
    const tags = tagInput({ collectionId, itemId: item.id, item, allTags });
    const save = async () => {
      const patch = {};
      const t = titleInput.value.trim();
      if (t && t !== item.title) patch.title = t;
      if (noteInput.value !== (item.note || '')) patch.note = noteInput.value.trim() || null;
      if (Object.keys(patch).length) await store.updateItem(collectionId, item.id, patch);
      close();
      app.toast('Card updated');
    };
    return {
      title: 'Edit card',
      body: [
        el('label', {}, [el('span', { text: 'Title' }), titleInput]),
        el('label', {}, [el('span', { text: 'Note' }), noteInput]),
        el('label', {}, [el('span', { text: 'Tags' }), tags]),
      ],
      footer: [
        el('button', { class: 'btn btn-ghost', text: 'Done', on: { click: () => close() } }),
        el('button', { class: 'btn btn-primary', text: 'Save', on: { click: save } }),
      ],
    };
  });
}

async function deleteCard(item, collectionId, app) {
  const col = app.findCollection(collectionId);
  const index = col ? col.items.findIndex((i) => i.id === item.id) : -1;
  await store.deleteItem(collectionId, item.id);
  app.toast('Card deleted', {
    variant: 'neutral',
    undo: async () => { await store.insertItem(collectionId, item, index); },
  });
}
