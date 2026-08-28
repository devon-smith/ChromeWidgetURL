// Floating action bar shown while cards and/or open tabs are multi-selected.
// Rebuilt from the dashboard's selection maps via updateSelectionBar(app).

import { el, icon } from '../../lib/dom.js';

let bar;
function ensureBar() {
  if (!bar) {
    bar = el('div', { class: 'selection-bar', attrs: { role: 'toolbar', 'aria-label': 'Selection actions' }, hidden: true });
    document.body.appendChild(bar);
  }
  return bar;
}

export function updateSelectionBar(app) {
  const b = ensureBar();
  const nCards = app.selectedCards.size;
  const nTabs = app.selectedTabs.size;
  if (!nCards && !nTabs) { b.hidden = true; b.replaceChildren(); return; }

  const parts = [];
  const count = nTabs && nCards ? `${nTabs} tabs · ${nCards} cards` : nTabs ? `${nTabs} tab${nTabs === 1 ? '' : 's'}` : `${nCards} card${nCards === 1 ? '' : 's'}`;
  parts.push(el('span', { class: 'sel-count', text: `${count} selected` }));

  if (nTabs) {
    parts.push(actionBtn('save', 'Save…', (e) => app.saveSelectedTabs(e.currentTarget)));
    parts.push(actionBtn('save', 'Save & close', (e) => app.saveSelectedTabs(e.currentTarget, { close: true })));
    parts.push(actionBtn('close', 'Close', () => app.closeSelectedTabs()));
  }
  if (nCards) {
    parts.push(actionBtn('external', 'Move…', (e) => app.moveSelectedCards(e.currentTarget)));
    parts.push(actionBtn('tag', 'Tag…', (e) => app.tagSelectedCards(e.currentTarget)));
    parts.push(actionBtn('trash', 'Delete', () => app.deleteSelectedCards(), 'btn-danger'));
  }
  parts.push(el('button', { class: 'btn btn-ghost sel-clear', title: 'Clear selection', on: { click: () => app.clearSelection() } }, [icon('x', { size: 14 }), 'Clear']));

  b.replaceChildren(...parts);
  b.hidden = false;
}

function actionBtn(iconName, label, onClick, extra = '') {
  return el('button', { class: `btn ${extra}`.trim(), on: { click: onClick } }, [icon(iconName, { size: 14 }), label]);
}
