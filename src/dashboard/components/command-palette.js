// ⌘K / Ctrl+K command palette: fuzzy-jump to any link, collection, space, or
// action. Untrusted strings go in via textContent only (el/textContent).

import { el, icon } from '../../lib/dom.js';
import * as store from '../../lib/store.js';

let openEl = null;

/** Subsequence fuzzy match; returns a score (higher = better) or -1. */
function fuzzy(query, text) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = (text || '').toLowerCase();
  if (t.includes(q)) return 100 - t.indexOf(q); // contiguous match ranks high
  let qi = 0, score = 0, streak = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) { qi++; streak++; score += streak; } else streak = 0;
  }
  return qi === q.length ? score : -1;
}

function buildItems(app) {
  const items = [];
  // actions
  const A = (label, hint, iconName, run) => items.push({ kind: 'action', label, hint, icon: iconName, run });
  A('Save current tab', 'action', 'save', () => app.quickSaveCurrentTab());
  A('Save all tabs in this window', 'action', 'save', () => app.saveAllTabs());
  A('Save all windows as a session', 'action', 'window', () => app.saveSession());
  A('New collection', 'action', 'plus', () => app.addCollection());
  A('New space', 'action', 'plus', () => app.addSpace());
  A('Toggle Open Tabs panel', 'action', 'window', () => app.toggleTabsPanel());
  A('Toggle current-tabs bar', 'action', 'window', () => app.toggleCurrentTabsBar());
  A('Cycle theme (System / Light / Dark)', 'action', 'gear', () => cycleTheme(app));
  A('Open settings', 'action', 'gear', () => app.openSettings());

  // spaces
  for (const s of app.state.spaces) {
    items.push({ kind: 'space', label: s.name, hint: 'space', icon: 'star', run: () => app.setActiveSpace(s.id) });
  }
  // collections
  for (const s of app.state.spaces) for (const c of s.collections) {
    items.push({ kind: 'collection', label: c.name, hint: s.name, icon: 'grid', run: () => app.goToCollection(s.id, c.id) });
  }
  // links
  for (const s of app.state.spaces) for (const c of s.collections) for (const it of c.items) {
    items.push({ kind: 'link', label: it.title || it.domain || it.url, hint: it.domain || c.name, icon: 'external', run: () => app.openLink(c.id, it.id, { active: false }) });
  }
  return items;
}

function cycleTheme(app) {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(app.settings.theme) + 1) % order.length];
  store.updateSettings({ theme: next });
}

export function openCommandPalette(app) {
  if (openEl) return;
  const all = buildItems(app);
  let filtered = all.slice(0, 50);
  let active = 0;

  const input = el('input', { class: 'cmdk-input', type: 'text', placeholder: 'Search links, collections, actions…', attrs: { 'aria-label': 'Command palette' } });
  const list = el('div', { class: 'cmdk-list', attrs: { role: 'listbox' } });
  const box = el('div', { class: 'cmdk' }, [
    el('div', { class: 'cmdk-inputrow' }, [icon('search'), input]),
    list,
    el('div', { class: 'cmdk-foot' }, [el('span', { text: '↑↓ navigate · ↵ open · esc close' })]),
  ]);
  const scrim = el('div', { class: 'cmdk-scrim' }, [box]);

  const kindLabel = { action: 'Action', space: 'Space', collection: 'Collection', link: 'Link' };

  function renderList() {
    list.replaceChildren();
    filtered.forEach((item, i) => {
      const row = el('div', {
        class: `cmdk-item ${i === active ? 'is-active' : ''}`, attrs: { role: 'option', 'aria-selected': i === active ? 'true' : 'false' },
        on: { mousemove: () => { if (active !== i) { active = i; paint(); } }, click: () => run(item) },
      }, [
        icon(item.icon, { size: 16 }),
        el('span', { class: 'cmdk-label clamp-1', text: item.label }),
        el('span', { class: 'cmdk-hint', text: item.hint || kindLabel[item.kind] }),
      ]);
      list.append(row);
    });
    if (!filtered.length) list.append(el('div', { class: 'cmdk-empty', text: 'No matches' }));
  }
  function paint() {
    [...list.children].forEach((row, i) => { row.classList.toggle('is-active', i === active); row.setAttribute('aria-selected', i === active ? 'true' : 'false'); });
    list.children[active]?.scrollIntoView({ block: 'nearest' });
  }
  function filter() {
    const q = input.value.trim();
    if (!q) { filtered = all.slice(0, 50); }
    else {
      filtered = all
        .map((it) => ({ it, s: Math.max(fuzzy(q, it.label), fuzzy(q, it.hint) - 5) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 50)
        .map((x) => x.it);
    }
    active = 0; renderList();
  }
  function run(item) { close(); try { item.run(); } catch (e) { app.toast(String(e.message || e), { variant: 'error' }); } }
  function close() { if (!openEl) return; document.removeEventListener('keydown', onKey, true); scrim.remove(); openEl = null; }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) run(filtered[active]); }
  }

  input.addEventListener('input', filter);
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(scrim);
  openEl = scrim;
  renderList();
  input.focus();
}
