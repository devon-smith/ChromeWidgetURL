// Automatic timestamped backups to a Drive folder (only when sync is connected).
// Keeps the last BACKUP_KEEP files; reuses store.exportJSON + gdrive folder ops.

import * as store from './store.js';
import * as gdrive from './gdrive.js';
import { BACKUP_FOLDER, BACKUP_KEEP } from './sync-config.js';
import { log } from './logger.js';

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Write one timestamped backup and prune old ones. Requires an active sync
 * connection. Returns { status, name?, pruned? }.
 * @param {{interactive?:boolean}} [opts]
 */
export async function runBackup({ interactive = false } = {}) {
  const settings = await store.getSettings();
  if (!settings.syncConnected) return { status: 'not-connected' };
  let token;
  try { token = await gdrive.getAccessToken({ interactive }); }
  catch (e) { if (e instanceof gdrive.AuthError) return { status: 'needs-reauth' }; throw e; }

  const folderId = await gdrive.findOrCreateFolder(token, BACKUP_FOLDER);
  const json = await store.exportJSON();
  const name = `local-toby-backup-${stamp()}.json`;
  await gdrive.createInFolder(token, name, json, folderId);

  // prune: keep the newest BACKUP_KEEP
  let pruned = 0;
  try {
    const files = await gdrive.listInFolder(token, folderId); // newest first
    for (const f of files.slice(BACKUP_KEEP)) { await gdrive.deleteFile(token, f.id); pruned++; }
  } catch (e) { log.warn('backup prune failed', e); }

  await store.updateSettings({ lastBackupAt: Date.now() });
  return { status: 'ok', name, pruned };
}
