// Drive sync orchestration. Pull remote → merge → write local → push merged.
// Loop-safe: a content signature means a converged store writes/uploads nothing,
// so replaceAll-driven storage events don't cause an infinite sync loop.

import * as store from './store.js';
import * as gdrive from './gdrive.js';
import { mergeRemote } from './sync-merge.js';
import { log } from './logger.js';

let _inFlight = null;
let _syncing = false;

/** True while a sync is writing local storage (worker push handlers should skip). */
export function isSyncing() { return _syncing; }

export async function isConnected() {
  const s = await store.getSettings();
  return !!s.syncConnected;
}

/** Interactive connect (call from a page, in a user gesture). */
export async function connect() {
  await gdrive.getAccessToken({ interactive: true }); // throws AuthError on cancel
  await store.updateSettings({ syncConnected: true });
  return syncNow({ interactive: true });
}

export async function disconnect() {
  await gdrive.revoke();
  await store.updateSettings({ syncConnected: false });
}

// Content signature: meaningful fields only (ignores timestamps/lastOpenedAt),
// so opening links / collapsing doesn't trigger uploads, and a converged store
// produces identical signatures → no writes.
function contentSignature(tree) {
  const parts = [];
  for (const s of tree.spaces || []) {
    parts.push('S', s.id, s.name || '', s.icon || '', s.color || '', s.isFavorite ? 1 : 0);
    for (const c of s.collections || []) {
      parts.push('C', c.id, c.name || '', c.color || '', c.note || '', (c.tagIds || []).join(','), c.isCollapsed ? 1 : 0);
      for (const it of c.items || []) {
        parts.push('I', it.id, it.url || '', it.title || '', it.note || '', (it.tagIds || []).join(','), it.pinned ? 1 : 0);
      }
    }
  }
  const tags = (tree.tags || []).map((t) => 'T' + t.id + (t.name || '') + (t.color || '')).sort();
  const dels = Object.keys(tree.deletions || {}).sort().map((id) => 'D' + id);
  return JSON.stringify([parts, tags, dels]);
}

/**
 * Run one sync pass. interactive controls whether auth may prompt.
 * @returns {Promise<{status:string, uploaded?:boolean, applied?:boolean}>}
 */
export function syncNow({ interactive = false } = {}) {
  if (_inFlight) return _inFlight;
  _inFlight = (async () => {
    const token = await gdrive.getAccessToken({ interactive });
    const local = await store.buildExportTree();

    let file = await gdrive.findFile(token);
    if (!file) {
      await gdrive.createFile(token, JSON.stringify(local));
      await store.updateSettings({ lastSyncAt: Date.now() });
      return { status: 'created' };
    }

    let remote = await gdrive.downloadJson(token, file.id) || undefined;
    let merged = mergeRemote(local, remote);

    const sigLocal = contentSignature(local);
    const sigMerged = contentSignature(merged);
    const sigRemote = contentSignature(remote || { spaces: [] });

    let applied = false;
    if (sigMerged !== sigLocal) {
      _syncing = true;
      try { await store.replaceAll(merged); } finally { _syncing = false; }
      applied = true;
    }

    let uploaded = false;
    if (sigMerged !== sigRemote) {
      // clobber guard: if the remote changed since we downloaded, re-merge once
      const mt = await gdrive.getModifiedTime(token, file.id).catch(() => null);
      if (mt && file.modifiedTime && mt !== file.modifiedTime) {
        remote = await gdrive.downloadJson(token, file.id) || undefined;
        merged = mergeRemote(merged, remote);
      }
      await gdrive.updateFile(token, file.id, JSON.stringify(merged));
      uploaded = true;
    }

    await store.updateSettings({ lastSyncAt: Date.now() });
    return { status: 'synced', applied, uploaded };
  })().finally(() => { _inFlight = null; });
  return _inFlight;
}

/** Silent background sync (no prompt). Swallows auth failures (user reconnects). */
export async function autoSync() {
  if (!(await isConnected())) return { status: 'not-connected' };
  try {
    return await syncNow({ interactive: false });
  } catch (e) {
    if (e instanceof gdrive.AuthError) { log.info('autoSync needs reconnect'); return { status: 'needs-reauth' }; }
    log.warn('autoSync failed', e);
    return { status: 'error', error: String(e?.message ?? e) };
  }
}
