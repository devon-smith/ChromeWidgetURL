// A chip-style tag editor. Type + Enter/comma to create/assign a tag, click ✕ to
// remove it, and pick from an autocomplete of existing tags. All text goes in via
// textContent (untrusted-safe). Persists through store.js immediately.

import { el, icon } from '../../lib/dom.js';
import * as store from '../../lib/store.js';

/**
 * Build a tag editor bound to one item.
 * @param {{collectionId:string, itemId:string, item:object, allTags:object[]}} opts
 * @returns {HTMLElement}
 */
export function tagInput({ collectionId, itemId, item, allTags }) {
  const wrap = el('div', { class: 'tag-input' });
  const chips = el('div', { class: 'tag-input-chips' });
  const field = el('input', {
    type: 'text', class: 'tag-input-field', placeholder: 'Add tag…',
    attrs: { 'aria-label': 'Add tag', autocomplete: 'off' },
  });
  const menu = el('div', { class: 'tag-input-menu', hidden: true });

  // live copy of assigned tag ids (kept in sync locally for snappy UI)
  let assigned = [...(item.tagIds || [])];
  const byId = new Map(allTags.map((t) => [t.id, t]));

  function renderChips() {
    chips.replaceChildren();
    for (const id of assigned) {
      const t = byId.get(id);
      if (!t) continue;
      chips.append(el('span', { class: 'chip tag-chip' }, [
        el('span', { text: `#${t.name}` }),
        el('button', {
          class: 'tag-chip-x', attrs: { 'aria-label': `Remove ${t.name}`, type: 'button' },
          on: { click: async () => { assigned = assigned.filter((x) => x !== id); renderChips(); await store.unassignTag(collectionId, itemId, id); } },
        }, [icon('x', { size: 12 })]),
      ]));
    }
    chips.append(field);
  }

  async function assignExisting(tag) {
    if (!assigned.includes(tag.id)) { assigned.push(tag.id); renderChips(); await store.assignTag(collectionId, itemId, tag.id); }
    field.value = ''; hideMenu(); field.focus();
  }

  async function createAndAssign(name) {
    const clean = name.trim();
    if (!clean) return;
    const tag = await store.createTag({ name: clean }); // returns existing if same name
    byId.set(tag.id, tag);
    if (!allTags.some((t) => t.id === tag.id)) allTags.push(tag);
    await assignExisting(tag);
  }

  function candidates() {
    const q = field.value.trim().toLowerCase();
    return allTags
      .filter((t) => !assigned.includes(t.id))
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .slice(0, 8);
  }

  function showMenu() {
    const list = candidates();
    const q = field.value.trim();
    menu.replaceChildren();
    for (const t of list) {
      menu.append(el('button', {
        class: 'tag-input-opt', attrs: { type: 'button' },
        on: { mousedown: (e) => { e.preventDefault(); assignExisting(t); } },
      }, [el('span', { text: `#${t.name}` })]));
    }
    if (q && !allTags.some((t) => t.name.toLowerCase() === q.toLowerCase())) {
      menu.append(el('button', {
        class: 'tag-input-opt tag-input-create', attrs: { type: 'button' },
        on: { mousedown: (e) => { e.preventDefault(); createAndAssign(q); } },
      }, [icon('plus', { size: 12 }), el('span', { text: `Create “${q}”` })]));
    }
    menu.hidden = menu.childElementCount === 0;
  }
  function hideMenu() { menu.hidden = true; }

  field.addEventListener('input', showMenu);
  field.addEventListener('focus', showMenu);
  field.addEventListener('blur', () => setTimeout(hideMenu, 120));
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const q = field.value.trim();
      if (q) createAndAssign(q);
    } else if (e.key === 'Backspace' && !field.value && assigned.length) {
      const last = assigned[assigned.length - 1];
      assigned = assigned.slice(0, -1); renderChips();
      store.unassignTag(collectionId, itemId, last);
    } else if (e.key === 'Escape') { hideMenu(); }
  });

  renderChips();
  wrap.append(chips, menu);
  return wrap;
}
