// Optional native side panel. Reuses the dashboard's Open Tabs component with a
// minimal app context.

import * as store from '../lib/store.js';
import { applyThemeFromSettings } from '../lib/theme.js';
import { toast } from '../dashboard/components/toast.js';
import { mountOpenTabs } from '../dashboard/components/open-tabs-panel.js';
import { initDnd } from '../dashboard/components/dnd.js';

async function boot() {
  await store.init();
  const container = document.getElementById('region-tabs');

  const app = {
    state: await store.getState(),
    get settings() { return this.state.settings; },
    toast,
    saveWindow: async (windowId) => {
      const winTabs = (await chrome.tabs.query({ windowId })).sort((a, b) => a.index - b.index);
      const spaceId = app.state.meta.activeSpaceId || app.state.spaces[0]?.id;
      const col = await store.createCollection(spaceId, { name: defaultName() });
      const created = await store.addItemsFromTabs(col.id, winTabs);
      toast(`Saved ${created.length} tabs`);
    },
    addCollection: async () => {
      const name = prompt('New collection name');
      if (!name) return null;
      const spaceId = app.state.meta.activeSpaceId || app.state.spaces[0]?.id;
      return (await store.createCollection(spaceId, { name })).id;
    },
    toggleTabsPanel: () => { try { window.close(); } catch {} },
  };

  applyThemeFromSettings(app.settings);
  initDnd(app);
  const ctl = mountOpenTabs(container, app);

  store.subscribe(async () => { app.state = await store.getState(); applyThemeFromSettings(app.settings); ctl.refresh(); });
}

function defaultName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `Tabs ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

boot().catch((e) => console.error(e));
