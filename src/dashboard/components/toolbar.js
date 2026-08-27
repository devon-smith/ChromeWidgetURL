// Center-pane toolbar + tag-filter bar.

import { el, icon, iconBtn } from '../../lib/dom.js';
import * as store from '../../lib/store.js';

export function renderToolbar(container, app) {
  container.replaceChildren();
  const space = app.activeSpace;
  const collectionCount = space ? space.collections.length : 0;

  const actions = el('div', { class: 'toolbar-actions' }, [
    iconBtn(app.settings.defaultView === 'list' ? 'grid' : 'list', {
      title: app.settings.defaultView === 'list' ? 'Grid view' : 'List view', size: 16,
      onClick: () => store.updateSettings({ defaultView: app.settings.defaultView === 'list' ? 'grid' : 'list' }),
    }),
    toggleBtn('tag', 'Tag filter', app.showTagFilter, () => app.toggleTagFilter()),
    toggleBtn('external', 'Drag & drop', app.settings.dndEnabled, () => store.updateSettings({ dndEnabled: !app.settings.dndEnabled })),
    el('button', { class: 'btn btn-ghost', title: 'Collapse all', on: { click: () => app.setAllCollapsed(true) } }, [icon('chevron'), 'Collapse']),
    el('button', { class: 'btn btn-ghost', title: 'Expand all', on: { click: () => app.setAllCollapsed(false) } }, [icon('chevronDown'), 'Expand']),
    el('button', { class: 'btn btn-primary', on: { click: () => app.addCollection() } }, [icon('plus'), 'Add Collection']),
  ]);

  container.append(el('div', { class: 'toolbar' }, [
    el('h1', { class: 'toolbar-title' }, [
      space ? space.name : 'My Collections',
      el('span', { class: 'count', text: `${collectionCount} collection${collectionCount === 1 ? '' : 's'}` }),
    ]),
    actions,
  ]));

  if (app.showTagFilter) container.append(renderTagFilter(app));
}

function toggleBtn(iconName, label, active, onClick) {
  return el('button', {
    class: 'btn btn-ghost', attrs: { 'aria-pressed': String(!!active), title: label },
    on: { click: onClick },
  }, [icon(iconName), label]);
}

function renderTagFilter(app) {
  const bar = el('div', { class: 'filter-bar' });
  bar.append(el('span', { class: 'filter-label', text: 'Tags' }));
  const tags = app.state.tags;
  if (!tags.length) {
    bar.append(el('span', { class: 'filter-label', text: '— no tags yet' }));
    return bar;
  }
  for (const t of tags) {
    const on = app.tagFilter.ids.has(t.id);
    bar.append(el('button', {
      class: `chip tag-chip ${on ? 'is-active' : ''}`, text: `#${t.name}`,
      on: { click: () => app.toggleTag(t.id) },
    }));
  }
  bar.append(el('button', {
    class: 'btn btn-ghost filter-mode-toggle',
    text: app.tagFilter.mode === 'and' ? 'Match ALL' : 'Match ANY',
    title: 'Toggle AND / OR', on: { click: () => app.toggleTagMode() },
  }));
  if (app.tagFilter.ids.size) {
    bar.append(el('button', { class: 'btn btn-ghost', text: 'Clear', on: { click: () => app.clearFilters() } }));
  }
  return bar;
}
