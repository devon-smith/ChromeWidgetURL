// Settings page: reads/writes settings, export/import, storage usage, wipe.

import * as store from '../lib/store.js';
import * as sync from '../lib/sync.js';
import { runBackup } from '../lib/backup.js';
import { tobyToBackup } from '../lib/import-toby.js';
import { bookmarksToBackup } from '../lib/import-bookmarks.js';
import { applyThemeFromSettings } from '../lib/theme.js';
import { toast } from './components/toast.js';
import { confirmDialog } from './components/modal.js';

const $ = (id) => document.getElementById(id);
const SELECTS = ['theme', 'defaultView', 'defaultOpenBehavior', 'newItemPosition'];
const NUMBERS = ['largeOpenThreshold'];
const SWITCHES = ['dedupeOnSave', 'dndEnabled', 'confirmOnDelete', 'closeUnsavedWarning', 'currentTabsBarVisible'];

async function boot() {
  await store.init();
  const settings = await store.getSettings();
  applyThemeFromSettings(settings);

  for (const id of SELECTS) { $(id).value = settings[id]; $(id).addEventListener('change', () => save(id, $(id).value)); }
  for (const id of NUMBERS) { $(id).value = settings[id]; $(id).addEventListener('change', () => save(id, clampInt($(id).value, 1, 100))); }
  for (const id of SWITCHES) { $(id).checked = !!settings[id]; $(id).addEventListener('change', () => save(id, $(id).checked)); }

  $('theme').addEventListener('change', () => applyThemeFromSettings({ theme: $('theme').value }));

  $('back').addEventListener('click', () => { location.href = chrome.runtime.getURL('src/dashboard/dashboard.html'); });

  $('export').addEventListener('click', doExport);
  $('import-merge').addEventListener('click', () => triggerImport('merge'));
  $('import-replace').addEventListener('click', () => triggerImport('replace'));
  $('import-file').addEventListener('change', onFileChosen);
  $('wipe').addEventListener('click', doWipe);

  $('sync-connect').addEventListener('click', doConnect);
  $('sync-now').addEventListener('click', doSyncNow);
  $('sync-disconnect').addEventListener('click', doDisconnect);
  $('backup-now').addEventListener('click', doBackupNow);
  $('import-toby').addEventListener('click', () => { $('toby-file').value = ''; $('toby-file').click(); });
  $('toby-file').addEventListener('change', onTobyFile);
  $('import-bookmarks').addEventListener('click', doImportBookmarks);
  await refreshSync();

  await refreshUsage();
  const meta = (await store.getState()).meta;
  if (meta.lastExportAt) $('last-export').textContent = `Last backup: ${new Date(meta.lastExportAt).toLocaleString()}`;
}

async function save(key, value) {
  await store.updateSettings({ [key]: value });
  toast('Saved');
}

function clampInt(v, min, max) { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; }

async function doExport() {
  const json = await store.exportJSON();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  a.href = url;
  a.download = `local-toby-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  await store.stampExport();
  toast('Backup downloaded', { variant: 'success' });
  $('last-export').textContent = `Last backup: ${new Date().toLocaleString()}`;
}

let pendingMode = 'merge';
function triggerImport(mode) { pendingMode = mode; $('import-file').value = ''; $('import-file').click(); }

async function onFileChosen(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch { toast('That file isn’t valid JSON', { variant: 'error' }); return; }

  if (pendingMode === 'replace') {
    const ok = await confirmDialog({ title: 'Replace all data?', message: 'This wipes your current data and replaces it with the backup. A safety snapshot is kept internally.', confirmLabel: 'Replace', danger: true });
    if (!ok) return;
  }
  try {
    const report = await store.importJSON(parsed, { mode: pendingMode });
    const added = `${report.addedSpaces} space(s), ${report.addedCollections} collection(s), ${report.addedItems} tab(s)`;
    toast(`Imported ${added}${report.skipped ? ` · ${report.skipped} skipped` : ''}`, { variant: 'success' });
    await refreshUsage();
  } catch (err) {
    toast('Import failed: ' + (err.message || err), { variant: 'error' });
  }
}

async function refreshUsage() {
  const bytes = await store.getStorageBytes();
  if (bytes == null) { $('usage').textContent = 'Storage: unavailable'; return; }
  const kb = bytes / 1024;
  const human = kb > 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${kb.toFixed(1)} KB`;
  const state = await store.getState();
  let items = 0, cols = 0;
  for (const s of state.spaces) { cols += s.collections.length; for (const c of s.collections) items += c.items.length; }
  $('usage').textContent = `Storage: ${human} used · ${state.spaces.length} spaces · ${cols} collections · ${items} tabs (unlimited on this device)`;
}

async function doWipe() {
  const ok = await confirmDialog({ title: 'Delete all data?', message: 'This permanently removes every space, collection, and saved tab. This cannot be undone. Export a backup first if you might want it later.', confirmLabel: 'Delete everything', danger: true });
  if (!ok) return;
  await store.wipeAll();
  await store.init();
  toast('All data deleted', { variant: 'success' });
  await refreshUsage();
}

/* ------------------------------ sync ------------------------------ */
async function refreshSync() {
  const s = await store.getSettings();
  const connected = !!s.syncConnected;
  $('sync-connect').hidden = connected;
  $('sync-now').hidden = !connected;
  $('sync-disconnect').hidden = !connected;
  $('backup-now').hidden = !connected;
  if (connected) {
    const when = s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : 'never';
    $('sync-status').textContent = `Connected · last synced: ${when}`;
  } else {
    $('sync-status').textContent = 'Not connected — your library stays on this device only.';
  }
  $('last-backup').textContent = s.lastBackupAt ? `Last Drive backup: ${new Date(s.lastBackupAt).toLocaleString()}` : '';
}

async function doBackupNow() {
  try {
    const r = await runBackup({ interactive: true });
    if (r.status === 'ok') toast(`Backed up${r.pruned ? ` · pruned ${r.pruned} old` : ''}`, { variant: 'success' });
    else if (r.status === 'not-connected') toast('Connect Google Drive first', { variant: 'error' });
    else toast('Backup: ' + r.status, { variant: 'error' });
  } catch (e) { toast('Backup failed: ' + (e.message || e), { variant: 'error' }); }
  await refreshSync();
}

async function onTobyFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch { toast('That file isn’t valid JSON', { variant: 'error' }); return; }
  try {
    const tree = tobyToBackup(parsed);
    const report = await store.importJSON(tree, { mode: 'merge' });
    toast(`Imported ${report.addedCollections} list(s), ${report.addedItems} link(s) from Toby`, { variant: 'success' });
    await refreshUsage();
  } catch (err) { toast('Toby import failed: ' + (err.message || err), { variant: 'error' }); }
}

async function doImportBookmarks() {
  let granted = false;
  try { granted = await chrome.permissions.request({ permissions: ['bookmarks'] }); }
  catch (e) { toast('Could not request permission: ' + (e.message || e), { variant: 'error' }); return; }
  if (!granted) { toast('Bookmarks permission denied'); return; }
  try {
    const tree = await chrome.bookmarks.getTree();
    const backup = bookmarksToBackup(tree);
    const report = await store.importJSON(backup, { mode: 'merge' });
    toast(`Imported ${report.addedCollections} folder(s), ${report.addedItems} bookmark(s)`, { variant: 'success' });
    await refreshUsage();
  } catch (err) { toast('Bookmark import failed: ' + (err.message || err), { variant: 'error' }); }
}

async function doConnect() {
  $('sync-status').textContent = 'Connecting…';
  try {
    await sync.connect();
    toast('Connected & synced', { variant: 'success' });
  } catch (e) {
    toast('Connect failed: ' + (e.message || e), { variant: 'error' });
  }
  await refreshSync();
}

async function doSyncNow() {
  $('sync-status').textContent = 'Syncing…';
  try {
    const r = await sync.syncNow({ interactive: true });
    toast(r.uploaded || r.applied || r.status === 'created' ? 'Synced' : 'Already up to date', { variant: 'success' });
  } catch (e) {
    toast('Sync failed: ' + (e.message || e), { variant: 'error' });
  }
  await refreshSync();
}

async function doDisconnect() {
  const ok = await confirmDialog({ title: 'Disconnect Google Drive?', message: 'Local Toby will stop syncing. Your local data and the Drive file are both kept.', confirmLabel: 'Disconnect' });
  if (!ok) return;
  await sync.disconnect();
  toast('Disconnected');
  await refreshSync();
}

boot().catch((e) => toast('Failed to load settings: ' + (e.message || e), { variant: 'error' }));
