// Ordered schema migrations. Each entry migrates FROM version (index) to
// (index+1). It receives a mutable, normalized snapshot:
//   { meta, spaces:{id:Space}, collections:{id:Collection(with items map)}, tags, settings }
// and mutates it in place. NO I/O here. Migrations are append-only: once a
// version ships, its function is never edited.

import { hostnameOf, sourceLabelOf } from './url-safe.js';

export const migrations = [
  // v0 -> v1 : baseline. Backfill fields on stores created before schemaVersion
  // existed, and normalize any partially-shaped data.
  (db) => {
    db.meta.schemaVersion = 1;
    for (const c of Object.values(db.collections)) {
      if (!Array.isArray(c.itemOrder)) c.itemOrder = Object.keys(c.items || {});
      if (!c.items) c.items = {};
      if (!Array.isArray(c.tagIds)) c.tagIds = [];
      for (const it of Object.values(c.items)) {
        if (!Array.isArray(it.tagIds)) it.tagIds = [];
        if (it.domain == null) it.domain = hostnameOf(it.url);
        if (it.sourceLabel == null) it.sourceLabel = sourceLabelOf(it.url);
        if (typeof it.pinned !== 'boolean') it.pinned = false;
        if (it.lastOpenedAt === undefined) it.lastOpenedAt = null;
      }
    }
  },
  // Future: (db) => { /* v1 -> v2 */ },
];

/** Current version = number of migrations that have shipped. */
export const CURRENT_SCHEMA_VERSION = migrations.length;
