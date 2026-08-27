// Lightweight anchored dropdown menu. Items are {label, icon?, danger?, onClick}
// or {separator:true} or {labelHeading:'…'}. Keyboard: ↑/↓ roving, Enter, Esc.

import { el, icon } from '../../lib/dom.js';

let current = null;

export function closeMenu() {
  if (current) { current.remove(); current = null; document.removeEventListener('keydown', onKey, true); }
}

function onKey(e) {
  if (!current) return;
  const items = [...current.querySelectorAll('button')];
  const idx = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); (items[idx + 1] || items[0]).focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); (items[idx - 1] || items[items.length - 1]).focus(); }
}

/**
 * Open a menu anchored to an element (below-left by default).
 * @param {HTMLElement} anchor
 * @param {Array} items
 */
export function openMenu(anchor, items) {
  closeMenu();
  const menu = el('div', { class: 'menu', attrs: { role: 'menu' } });
  for (const it of items) {
    if (!it) continue;
    if (it.separator) { menu.append(el('div', { class: 'menu-sep' })); continue; }
    if (it.labelHeading) { menu.append(el('div', { class: 'menu-label', text: it.labelHeading })); continue; }
    const btn = el('button', {
      class: it.danger ? 'danger' : '', attrs: { role: 'menuitem' },
      on: { click: () => { closeMenu(); it.onClick?.(); } },
    }, [it.icon ? icon(it.icon) : null, el('span', { text: it.label })]);
    menu.append(btn);
  }
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = r.left, top = r.bottom + 4;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
  if (top + mh > window.innerHeight - 8) top = r.top - mh - 4;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  current = menu;
  setTimeout(() => {
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDocDown, true);
    menu.querySelector('button')?.focus();
  }, 0);
}

function onDocDown(e) {
  if (current && !current.contains(e.target)) {
    document.removeEventListener('mousedown', onDocDown, true);
    closeMenu();
  }
}
