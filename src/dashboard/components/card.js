// Renders one Item as a card. Untrusted fields (title, url, source, note) go in
// via textContent only. The card opens its URL on click; action buttons and the
// drag handle are revealed on hover/focus.

import { el, icon, iconBtn } from '../../lib/dom.js';
import { faviconImg } from '../../lib/favicon.js';
import { safeHref } from '../../lib/url-safe.js';
import * as store from '../../lib/store.js';
import { openMenu } from './menu.js';
import { promptDialog } from './modal.js';

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

  const handle = el('span', { class: 'card-handle', attrs: { 'aria-hidden': 'true' } }, [icon('dots')]);

  const body = el('div', { class: 'card-body' }, [
    el('span', { class: 'card-title clamp-2', text: item.title || item.domain || item.url }),
    el('span', { class: 'card-source clamp-1', text: item.sourceLabel || item.domain || '' }),
  ]);
  if (item.note) body.append(el('span', { class: 'card-note clamp-2', text: item.note }));

  // tags
  const tagNames = (item.tagIds || []).map((id) => app.tagsById?.[id]?.name).filter(Boolean);
  if (tagNames.length) {
    const wrap = el('div', { class: 'card-tags' });
    for (const name of tagNames) wrap.append(el('span', { class: 'chip', text: `#${name}` }));
    body.append(wrap);
  }

  const actions = el('div', { class: 'card-actions' }, [
    iconBtn('external', { title: 'Open in new tab', size: 14, onClick: (e) => { e.stopPropagation(); app.openLink(collectionId, item.id, { active: false }); } }),
    iconBtn('copy', { title: 'Copy link', size: 14, onClick: (e) => { e.stopPropagation(); copyUrl(item, app); } }),
    iconBtn('dots', { title: 'More', size: 14, onClick: (e) => { e.stopPropagation(); cardMenu(e.currentTarget, item, collectionId, app); } }),
  ]);

  card.append(handle, faviconImg(item, app.settings.faviconSize), body, actions);

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
  const title = await promptDialog({
    title: 'Edit title', label: 'Title', value: item.title, confirmLabel: 'Save',
  });
  if (title && title !== item.title) {
    await store.updateItem(collectionId, item.id, { title });
    app.toast('Card updated');
  }
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
