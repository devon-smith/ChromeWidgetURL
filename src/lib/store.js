// The ONLY module that reads/writes chrome.storage.local. Everything else goes
// through this API. Provides: seeding, migrations, CRUD for spaces/collections/
// items/tags, reorder/move, export/import, and a cross-context change feed.
//
// Concurrency model:
//  - A single in-process promise-chain mutex (_withLock) serializes every write
//    within one context, so two operations in the same page never interleave.
//  - Each shard carries a `rev` integer bumped on write (optimistic-concurrency
//    marker; also drives surgical re-render decisions).
//  - Writes are read-modify-write performed *inside* the lock against a fresh
//    read, so the stale window is minimal even across contexts.

import { KEYS, defaultSettings, seedMeta, makeSpace, makeCollection, makeItem,
  makeTag, now } from './schema.js';
import { migrations, CURRENT_SCHEMA_VERSION } from './migrations.js';
import { safeHref, hostnameOf, sourceLabelOf, normalizeUrl } from './url-safe.js';
import { log } from './logger.js';

const area = chrome.storage.local;

/* ------------------------------------------------------------------ */
/* Raw storage primitives (private)                                    */
/* ------------------------------------------------------------------ */

async function _get(key) {
  const out = await area.get(key);
  return out[key];
}
async function _getMany(keys) {
  return area.get(keys); // returns { key: value, ... }
}
async function _getAll() {
  return area.get(null);
}
async function _setMany(obj) {
  await area.set(obj);
}
async function _removeMany(keys) {
  await area.remove(keys);
}

/* ------------------------------------------------------------------ */
/* In-process mutex                                                    */
/* ------------------------------------------------------------------ */

let _lock = Promise.resolve();
function _withLock(fn) {
  const run = _lock.then(() => fn());
  _lock = run.then(() => {}, () => {}); // never let a rejection break the chain
  return run;
}

function bumpRev(obj) {
  if (obj && typeof obj === 'object' && 'rev' in obj) {
    obj.rev = (typeof obj.rev === 'number' ? obj.rev : 0) + 1;
  }
  return obj;
}

/* ------------------------------------------------------------------ */
/* Seeding & migrations                                                */
/* ------------------------------------------------------------------ */

/** Idempotent: creates meta+settings+one space if the store is empty. */
export async function ensureSeeded({ withGettingStarted = false } = {}) {
  return _withLock(async () => {
    const meta = await _get(KEYS.META);
    if (meta) return { seeded: false };

    const space = makeSpace({ name: 'My Space', icon: '🗂️', isFavorite: true });
    const m = seedMeta(0);
    m.spaceOrder = [space.id];
    m.activeSpaceId = space.id;
    m.appVersion = manifestVersion();

    const writes = {
      [KEYS.META]: m,
      [KEYS.SETTINGS]: defaultSettings(),
      [KEYS.TAGS]: { rev: 0, byId: {} },
      [KEYS.space(space.id)]: space,
    };

    if (withGettingStarted) {
      const c = makeCollection({ spaceId: space.id, name: 'Getting Started' });
      const samples = [
        { url: 'https://developer.chrome.com/docs/extensions/', title: 'Chrome Extensions docs' },
        { url: 'https://github.com/', title: 'GitHub' },
      ];
      for (const s of samples) {
        const it = makeItem(s);
        c.items[it.id] = it;
        c.itemOrder.push(it.id);
      }
      space.collectionOrder.push(c.id);
      writes[KEYS.collection(c.id)] = c;
      writes[KEYS.space(space.id)] = space;
    }

    await _setMany(writes);
    return { seeded: true, spaceId: space.id };
  });
}

/** Run any pending schema migrations. Safe to call on every context wake. */
export async function runMigrationsIfNeeded() {
  return _withLock(async () => {
    const meta = await _get(KEYS.META);
    const from = meta?.schemaVersion ?? 0;
    if (!meta || from >= CURRENT_SCHEMA_VERSION) return { migrated: false };

    const all = await _getAll();
    const db = normalizeRaw(all);
    // one-shot rollback snapshot
    await _setMany({ [`meta_backup:${from}`]: all });
    try {
      for (let v = from; v < CURRENT_SCHEMA_VERSION; v++) {
        migrations[v](db);
        db.meta.schemaVersion = v + 1;
      }
      db.meta.updatedAt = now();
      db.meta.appVersion = manifestVersion();
      await writeDenormalized(db);
      await _removeMany([`meta_backup:${from}`]);
      log.info(`migrated ${from} -> ${CURRENT_SCHEMA_VERSION}`);
      return { migrated: true, from, to: CURRENT_SCHEMA_VERSION };
    } catch (err) {
      log.error('migration failed; restoring backup', err);
      await _setMany(all); // best-effort restore
      throw err;
    }
  });
}

/** Convenience for context startup. */
export async function init({ withGettingStarted = false } = {}) {
  await ensureSeeded({ withGettingStarted });
  await runMigrationsIfNeeded();
}

function manifestVersion() {
  try { return chrome.runtime.getManifest().version; } catch { return '0.0.0'; }
}

/* ------------------------------------------------------------------ */
/* Normalization helpers                                               */
/* ------------------------------------------------------------------ */

// Raw storage map -> { meta, spaces:{}, collections:{}, tags, settings }
function normalizeRaw(all) {
  const spaces = {}, collections = {};
  let tags = { rev: 0, byId: {} };
  let settings = defaultSettings();
  let meta = all[KEYS.META] || seedMeta(0);
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith(KEYS.spacePrefix)) spaces[v.id] = v;
    else if (k.startsWith(KEYS.collectionPrefix)) collections[v.id] = v;
    else if (k === KEYS.TAGS) tags = v;
    else if (k === KEYS.SETTINGS) settings = { ...defaultSettings(), ...v };
  }
  return { meta, spaces, collections, tags, settings };
}

// Write a normalized db back out as shards (atomic multi-key set).
async function writeDenormalized(db) {
  const writes = {
    [KEYS.META]: db.meta,
    [KEYS.SETTINGS]: db.settings,
    [KEYS.TAGS]: db.tags,
  };
  for (const s of Object.values(db.spaces)) writes[KEYS.space(s.id)] = s;
  for (const c of Object.values(db.collections)) writes[KEYS.collection(c.id)] = c;
  await _setMany(writes);
}

function orderedItems(collection) {
  const order = collection.itemOrder || [];
  const items = collection.items || {};
  const seen = new Set();
  const out = [];
  for (const id of order) {
    if (items[id] && !seen.has(id)) { out.push(items[id]); seen.add(id); }
  }
  // include any items missing from itemOrder (defensive)
  for (const id of Object.keys(items)) {
    if (!seen.has(id)) out.push(items[id]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Full hydrated, ordered tree for the UI. */
export async function getState() {
  const all = await _getAll();
  const db = normalizeRaw(all);
  const spaceOrder = db.meta.spaceOrder || [];
  const spaces = [];
  const seen = new Set();
  const emit = (id) => {
    const s = db.spaces[id];
    if (!s || seen.has(id)) return;
    seen.add(id);
    const collections = (s.collectionOrder || [])
      .map((cid) => db.collections[cid])
      .filter(Boolean)
      .map((c) => ({ ...c, items: orderedItems(c) }));
    spaces.push({ ...s, collections });
  };
  for (const id of spaceOrder) emit(id);
  for (const id of Object.keys(db.spaces)) emit(id); // defensive: any not in order
  return {
    meta: db.meta,
    settings: db.settings,
    tags: Object.values(db.tags.byId || {}),
    spaces,
  };
}

export async function getSettings() {
  return { ...defaultSettings(), ...(await _get(KEYS.SETTINGS)) };
}

export async function getTags() {
  const t = await _get(KEYS.TAGS);
  return Object.values(t?.byId || {});
}

export async function getSpace(spaceId) {
  const s = await _get(KEYS.space(spaceId));
  if (!s) return null;
  const cols = await _getMany((s.collectionOrder || []).map(KEYS.collection));
  const collections = (s.collectionOrder || [])
    .map((cid) => cols[KEYS.collection(cid)])
    .filter(Boolean)
    .map((c) => ({ ...c, items: orderedItems(c) }));
  return { ...s, collections };
}

export async function getCollection(collectionId) {
  const c = await _get(KEYS.collection(collectionId));
  if (!c) return null;
  return { ...c, items: orderedItems(c) };
}

export async function getItem(collectionId, itemId) {
  const c = await _get(KEYS.collection(collectionId));
  return c?.items?.[itemId] || null;
}

/* ------------------------------------------------------------------ */
/* Spaces                                                              */
/* ------------------------------------------------------------------ */

export async function createSpace({ name, icon = null, color = null, isFavorite = false }) {
  return _withLock(async () => {
    const space = makeSpace({ name, icon, color, isFavorite });
    const meta = await _get(KEYS.META);
    meta.spaceOrder = [...(meta.spaceOrder || []), space.id];
    if (!meta.activeSpaceId) meta.activeSpaceId = space.id;
    bumpRev(meta); meta.updatedAt = now();
    await _setMany({ [KEYS.space(space.id)]: space, [KEYS.META]: meta });
    return space;
  });
}

export async function updateSpace(spaceId, patch) {
  return _withLock(async () => {
    const s = await _get(KEYS.space(spaceId));
    if (!s) throw new Error('space not found');
    const allowed = ['name', 'icon', 'color', 'isFavorite', 'collectionOrder'];
    for (const k of allowed) if (k in patch) s[k] = patch[k];
    if (typeof s.name === 'string') s.name = s.name.slice(0, 120);
    s.updatedAt = now(); bumpRev(s);
    await _setMany({ [KEYS.space(spaceId)]: s });
    return s;
  });
}

export async function deleteSpace(spaceId) {
  return _withLock(async () => {
    const meta = await _get(KEYS.META);
    if ((meta.spaceOrder || []).length <= 1) throw new Error('cannot delete the last space');
    const s = await _get(KEYS.space(spaceId));
    if (!s) return;
    const toRemove = [KEYS.space(spaceId), ...(s.collectionOrder || []).map(KEYS.collection)];
    meta.spaceOrder = (meta.spaceOrder || []).filter((id) => id !== spaceId);
    if (meta.activeSpaceId === spaceId) meta.activeSpaceId = meta.spaceOrder[0] || null;
    meta.updatedAt = now(); bumpRev(meta);
    await _removeMany(toRemove);
    await _setMany({ [KEYS.META]: meta });
  });
}

export async function reorderSpaces(orderedSpaceIds) {
  return _withLock(async () => {
    const meta = await _get(KEYS.META);
    const cur = new Set(meta.spaceOrder || []);
    if (orderedSpaceIds.length !== cur.size || !orderedSpaceIds.every((id) => cur.has(id))) {
      throw new Error('reorderSpaces: not a permutation');
    }
    meta.spaceOrder = orderedSpaceIds.slice();
    meta.updatedAt = now(); bumpRev(meta);
    await _setMany({ [KEYS.META]: meta });
  });
}

export async function setActiveSpace(spaceId) {
  return _withLock(async () => {
    const meta = await _get(KEYS.META);
    meta.activeSpaceId = spaceId;
    meta.updatedAt = now(); bumpRev(meta);
    await _setMany({ [KEYS.META]: meta });
  });
}

/* ------------------------------------------------------------------ */
/* Collections                                                         */
/* ------------------------------------------------------------------ */

export async function createCollection(spaceId, { name, color = null, note = null } = {}) {
  return _withLock(async () => {
    const s = await _get(KEYS.space(spaceId));
    if (!s) throw new Error('space not found');
    const col = makeCollection({ spaceId, name: name || 'Untitled collection', color, note });
    s.collectionOrder = [...(s.collectionOrder || []), col.id];
    s.updatedAt = now(); bumpRev(s);
    await _setMany({ [KEYS.collection(col.id)]: col, [KEYS.space(spaceId)]: s });
    return col;
  });
}

export async function saveCollection(collectionId, patch) {
  return _withLock(async () => {
    const c = await _get(KEYS.collection(collectionId));
    if (!c) throw new Error('collection not found');
    const allowed = ['name', 'color', 'note', 'isCollapsed', 'tagIds'];
    for (const k of allowed) if (k in patch) c[k] = patch[k];
    if (typeof c.name === 'string') c.name = c.name.slice(0, 120);
    c.updatedAt = now(); bumpRev(c);
    await _setMany({ [KEYS.collection(collectionId)]: c });
    return c;
  });
}

export async function deleteCollection(collectionId) {
  return _withLock(async () => {
    const c = await _get(KEYS.collection(collectionId));
    if (!c) return;
    const s = await _get(KEYS.space(c.spaceId));
    if (s) {
      s.collectionOrder = (s.collectionOrder || []).filter((id) => id !== collectionId);
      s.updatedAt = now(); bumpRev(s);
      await _setMany({ [KEYS.space(s.id)]: s });
    }
    await _removeMany([KEYS.collection(collectionId)]);
  });
}

export async function reorderCollections(spaceId, orderedCollectionIds) {
  return _withLock(async () => {
    const s = await _get(KEYS.space(spaceId));
    if (!s) throw new Error('space not found');
    const cur = new Set(s.collectionOrder || []);
    if (orderedCollectionIds.length !== cur.size || !orderedCollectionIds.every((id) => cur.has(id))) {
      throw new Error('reorderCollections: not a permutation');
    }
    s.collectionOrder = orderedCollectionIds.slice();
    s.updatedAt = now(); bumpRev(s);
    await _setMany({ [KEYS.space(spaceId)]: s });
  });
}

export async function moveCollection(collectionId, toSpaceId, toIndex = -1) {
  return _withLock(async () => {
    const c = await _get(KEYS.collection(collectionId));
    if (!c) throw new Error('collection not found');
    const fromSpaceId = c.spaceId;
    if (fromSpaceId === toSpaceId) return;
    const from = await _get(KEYS.space(fromSpaceId));
    const to = await _get(KEYS.space(toSpaceId));
    if (!from || !to) throw new Error('space not found');
    from.collectionOrder = (from.collectionOrder || []).filter((id) => id !== collectionId);
    const arr = to.collectionOrder || [];
    const idx = toIndex < 0 || toIndex > arr.length ? arr.length : toIndex;
    arr.splice(idx, 0, collectionId);
    to.collectionOrder = arr;
    c.spaceId = toSpaceId; c.updatedAt = now(); bumpRev(c);
    from.updatedAt = now(); bumpRev(from);
    to.updatedAt = now(); bumpRev(to);
    await _setMany({
      [KEYS.collection(collectionId)]: c,
      [KEYS.space(fromSpaceId)]: from,
      [KEYS.space(toSpaceId)]: to,
    });
  });
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

async function _getSettingsRaw() {
  return { ...defaultSettings(), ...(await _get(KEYS.SETTINGS)) };
}

function findDuplicate(collection, url) {
  const norm = normalizeUrl(url);
  for (const it of Object.values(collection.items || {})) {
    if (normalizeUrl(it.url) === norm) return it;
  }
  return null;
}

/**
 * Add one item. Honors dedupeOnSave unless `force` is passed. Returns
 * { item, duplicate:boolean }.
 */
export async function addItem(collectionId, data, { force = false } = {}) {
  return _withLock(async () => {
    const c = await _get(KEYS.collection(collectionId));
    if (!c) throw new Error('collection not found');
    if (!safeHref(data.url)) throw new Error('refused: unsupported URL scheme');
    const settings = await _getSettingsRaw();
    if (!force && settings.dedupeOnSave) {
      const dup = findDuplicate(c, data.url);
      if (dup) return { item: dup, duplicate: true };
    }
    const item = makeItem(data);
    c.items[item.id] = item;
    if (settings.newItemPosition === 'top') c.itemOrder.unshift(item.id);
    else c.itemOrder.push(item.id);
    c.updatedAt = now(); bumpRev(c);
    await _setMany({ [KEYS.collection(collectionId)]: c });
    return { item, duplicate: false };
  });
}

/**
 * Bulk-save from chrome.tabs.Tab[]. One shard write. Skips restricted schemes
 * and (per settings.dedupeOnSave) URLs already present. Returns created items.
 */
export async function addItemsFromTabs(collectionId, tabs, { force = false } = {}) {
  return _withLock(async () => {
    const c = await _get(KEYS.collection(collectionId));
    if (!c) throw new Error('collection not found');
    const settings = await _getSettingsRaw();
    const created = [];
    const batchSeen = new Set();
    for (const tab of tabs) {
      const url = tab.url || tab.pendingUrl;
      if (!safeHref(url)) continue;
      const norm = normalizeUrl(url);
      if (!force && settings.dedupeOnSave) {
        if (batchSeen.has(norm) || findDuplicate(c, url)) continue;
      }
      batchSeen.add(norm);
      const item = makeItem({
        url,
        title: tab.title,
        faviconUrl: tab.favIconUrl || null,
        pinned: !!tab.pinned,
      });
      c.items[item.id] = item;
      created.push(item);
    }
    if (created.length) {
      // Insert the whole batch as one ordered block so intra-batch (window)
      // order is preserved even under newItemPosition:'top'.
      const ids = created.map((i) => i.id);
      if (settings.newItemPosition === 'top') c.itemOrder = [...ids, ...c.itemOrder];
      else c.itemOrder.push(...ids);
      c.updatedAt = now(); bumpRev(c);
      await _setMany({ [KEYS.collection(collectionId)]: c });
    }
    return created;
  });
}

export async function updateItem(collectionId, itemId, patch) {
  return _withLock(async () => {
    const c = await _get(KEYS.collection(collectionId));
    if (!c || !c.items[itemId]) throw new Error('item not found');
    const it = c.items[itemId];
    const allowed = ['title', 'url', 'note', 'pinned', 'tagIds', 'faviconUrl'];
    for (const k of allowed) if (k in patch) it[k] = patch[k];
    if ('url' in patch) {
      if (!safeHref(it.url)) throw new Error('refused: unsupported URL scheme');
      it.domain = hostnameOf(it.url);
      it.sourceLabel = sourceLabelOf(it.url);
    }
    it.updatedAt = now();
    c.updatedAt = now(); bumpRev(c);
    await _setMany({ [KEYS.collection(collectionId)]: c });
    return it;
  });
}

export async function deleteItem(collectionId, itemId) {
  return _withLock(async () => {
    const c = await _get(KEYS.collection(collectionId));
    if (!c) return;
    delete c.items[itemId];
    c.itemOrder = (c.itemOrder || []).filter((id) => id !== itemId);
    c.updatedAt = now(); bumpRev(c);
    await _setMany({ [KEYS.collection(collectionId)]: c });
  });
}

/** Move an item within a collection or across two collections. Powers DnD. */
export async function moveItem(itemId, fromCollectionId, toCollectionId, toIndex = -1) {
  return _withLock(async () => {
    if (fromCollectionId === toCollectionId) {
      const c = await _get(KEYS.collection(fromCollectionId));
      if (!c || !c.items[itemId]) throw new Error('item not found');
      c.itemOrder = (c.itemOrder || []).filter((id) => id !== itemId);
      const idx = toIndex < 0 || toIndex > c.itemOrder.length ? c.itemOrder.length : toIndex;
      c.itemOrder.splice(idx, 0, itemId);
      c.updatedAt = now(); bumpRev(c);
      await _setMany({ [KEYS.collection(fromCollectionId)]: c });
      return;
    }
    const from = await _get(KEYS.collection(fromCollectionId));
    const to = await _get(KEYS.collection(toCollectionId));
    if (!from || !to || !from.items[itemId]) throw new Error('item/collection not found');
    const item = from.items[itemId];
    delete from.items[itemId];
    from.itemOrder = (from.itemOrder || []).filter((id) => id !== itemId);
    to.items[itemId] = item;
    const idx = toIndex < 0 || toIndex > (to.itemOrder || []).length ? to.itemOrder.length : toIndex;
    to.itemOrder.splice(idx, 0, itemId);
    item.updatedAt = now();
    from.updatedAt = now(); bumpRev(from);
    to.updatedAt = now(); bumpRev(to);
    await _setMany({
      [KEYS.collection(fromCollectionId)]: from,
      [KEYS.collection(toCollectionId)]: to,
    });
  });
}

export async function reorderItems(collectionId, orderedItemIds) {
  return _withLock(async () => {
    const c = await _get(KEYS.collection(collectionId));
    if (!c) throw new Error('collection not found');
    const cur = new Set(Object.keys(c.items || {}));
    if (orderedItemIds.length !== cur.size || !orderedItemIds.every((id) => cur.has(id))) {
      throw new Error('reorderItems: not a permutation');
    }
    c.itemOrder = orderedItemIds.slice();
    c.updatedAt = now(); bumpRev(c);
    await _setMany({ [KEYS.collection(collectionId)]: c });
  });
}

export async function touchItemOpened(collectionId, itemId) {
  return _withLock(async () => {
    const c = await _get(KEYS.collection(collectionId));
    if (!c || !c.items[itemId]) return;
    c.items[itemId].lastOpenedAt = now();
    // no rev bump: lastOpenedAt is non-structural; avoid re-render churn
    await _setMany({ [KEYS.collection(collectionId)]: c });
  });
}

/* ------------------------------------------------------------------ */
/* Tags                                                                */
/* ------------------------------------------------------------------ */

export async function createTag({ name, color = null }) {
  return _withLock(async () => {
    const t = (await _get(KEYS.TAGS)) || { rev: 0, byId: {} };
    const norm = String(name).trim().toLowerCase();
    const existing = Object.values(t.byId).find((x) => x.name.toLowerCase() === norm);
    if (existing) return existing;
    const tag = makeTag({ name, color });
    t.byId[tag.id] = tag; bumpRev(t);
    await _setMany({ [KEYS.TAGS]: t });
    return tag;
  });
}

export async function updateTag(tagId, patch) {
  return _withLock(async () => {
    const t = await _get(KEYS.TAGS);
    if (!t?.byId[tagId]) throw new Error('tag not found');
    if ('name' in patch) t.byId[tagId].name = String(patch.name).trim().slice(0, 60);
    if ('color' in patch) t.byId[tagId].color = patch.color;
    bumpRev(t);
    await _setMany({ [KEYS.TAGS]: t });
    return t.byId[tagId];
  });
}

export async function deleteTag(tagId) {
  return _withLock(async () => {
    const t = await _get(KEYS.TAGS);
    if (!t?.byId[tagId]) return;
    delete t.byId[tagId]; bumpRev(t);
    // cascade: strip from every collection + item
    const all = await _getAll();
    const writes = { [KEYS.TAGS]: t };
    for (const [k, v] of Object.entries(all)) {
      if (!k.startsWith(KEYS.collectionPrefix)) continue;
      let changed = false;
      if (Array.isArray(v.tagIds) && v.tagIds.includes(tagId)) {
        v.tagIds = v.tagIds.filter((id) => id !== tagId); changed = true;
      }
      for (const it of Object.values(v.items || {})) {
        if (Array.isArray(it.tagIds) && it.tagIds.includes(tagId)) {
          it.tagIds = it.tagIds.filter((id) => id !== tagId); changed = true;
        }
      }
      if (changed) { bumpRev(v); writes[k] = v; }
    }
    await _setMany(writes);
  });
}

export async function assignTag(collectionId, itemId, tagId) {
  return _withLock(async () => {
    const c = await _get(KEYS.collection(collectionId));
    if (!c || !c.items[itemId]) throw new Error('item not found');
    const it = c.items[itemId];
    if (!it.tagIds.includes(tagId)) { it.tagIds.push(tagId); it.updatedAt = now(); bumpRev(c); await _setMany({ [KEYS.collection(collectionId)]: c }); }
  });
}

export async function unassignTag(collectionId, itemId, tagId) {
  return _withLock(async () => {
    const c = await _get(KEYS.collection(collectionId));
    if (!c || !c.items[itemId]) return;
    const it = c.items[itemId];
    it.tagIds = it.tagIds.filter((id) => id !== tagId); it.updatedAt = now();
    bumpRev(c);
    await _setMany({ [KEYS.collection(collectionId)]: c });
  });
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export async function updateSettings(patch) {
  return _withLock(async () => {
    const s = { ...defaultSettings(), ...(await _get(KEYS.SETTINGS)) };
    Object.assign(s, patch); bumpRev(s);
    await _setMany({ [KEYS.SETTINGS]: s });
    return s;
  });
}

export async function getStorageBytes() {
  try { return await area.getBytesInUse(null); } catch { return null; }
}

/* ------------------------------------------------------------------ */
/* Export / import                                                     */
/* ------------------------------------------------------------------ */

/** Build the denormalized backup tree (no rev fields). */
export async function buildExportTree() {
  const all = await _getAll();
  const db = normalizeRaw(all);
  const spaceOrder = db.meta.spaceOrder || [];
  const spaces = spaceOrder.map((sid) => db.spaces[sid]).filter(Boolean).map((s) => ({
    id: s.id, type: 'space', name: s.name, icon: s.icon, color: s.color,
    isFavorite: s.isFavorite, createdAt: s.createdAt, updatedAt: s.updatedAt,
    collections: (s.collectionOrder || []).map((cid) => db.collections[cid]).filter(Boolean).map((c) => ({
      id: c.id, type: 'collection', spaceId: c.spaceId, name: c.name, color: c.color,
      note: c.note, tagIds: c.tagIds || [], isCollapsed: !!c.isCollapsed,
      createdAt: c.createdAt, updatedAt: c.updatedAt,
      items: (c.itemOrder || []).map((iid) => c.items[iid]).filter(Boolean).map(stripItem),
    })),
  }));
  return {
    format: 'local-toby-backup',
    schemaVersion: db.meta.schemaVersion ?? CURRENT_SCHEMA_VERSION,
    exportedAt: now(),
    app: { name: 'Local Toby', version: manifestVersion() },
    settings: withoutRev(db.settings),
    tags: Object.values(db.tags.byId || {}),
    spaces,
  };
}

function stripItem(it) {
  const { rev, ...rest } = it;
  return rest;
}
function withoutRev(o) { const { rev, ...rest } = o || {}; return rest; }

/** Serialize the whole store to a pretty JSON string (used to build a Blob). */
export async function exportJSON() {
  const tree = await buildExportTree();
  return JSON.stringify(tree, null, 2);
}

/* ------------------------------------------------------------------ */
/* Transient cross-context undo (e.g. popup save-&-close → dashboard)   */
/* ------------------------------------------------------------------ */

/** Stash a one-shot undo record for an open dashboard to surface. */
export async function setPendingUndo(record) {
  await area.set({ pendingUndo: record });
}
export async function getPendingUndo() {
  return (await area.get('pendingUndo')).pendingUndo || null;
}
export async function clearPendingUndo() {
  await area.remove('pendingUndo');
}

/** Record that a backup was just exported (updates meta.lastExportAt). */
export async function stampExport() {
  return _withLock(async () => {
    const meta = await _get(KEYS.META);
    if (!meta) return;
    meta.lastExportAt = now(); meta.updatedAt = now(); bumpRev(meta);
    await _setMany({ [KEYS.META]: meta });
  });
}

function isPlainObject(v) { return v && typeof v === 'object' && !Array.isArray(v); }

/** Validate + normalize a parsed backup into shards. Throws on structural error. */
function validateBackup(parsed) {
  const errors = [];
  if (!isPlainObject(parsed)) throw new Error('backup is not an object');
  if (parsed.format !== 'local-toby-backup') throw new Error('not a Local Toby backup file');
  if (typeof parsed.schemaVersion !== 'number') throw new Error('missing schemaVersion');
  if (parsed.schemaVersion > CURRENT_SCHEMA_VERSION) throw new Error('backup is from a newer version');
  if (!Array.isArray(parsed.spaces)) throw new Error('spaces must be an array');
  if (parsed.tags && !Array.isArray(parsed.tags)) throw new Error('tags must be an array');
  return errors;
}

/**
 * Import a parsed backup. mode 'replace' wipes and writes fresh; 'merge' folds
 * in additively, remapping id collisions. Returns a report.
 */
export async function importJSON(parsed, { mode = 'merge' } = {}) {
  validateBackup(parsed);
  return _withLock(async () => {
    const report = { addedSpaces: 0, addedCollections: 0, addedItems: 0, addedTags: 0, skipped: 0, remappedIds: {}, errors: [] };

    // --- Build normalized incoming db ---
    const incoming = { meta: seedMeta(parsed.schemaVersion), spaces: {}, collections: {}, tags: { rev: 0, byId: {} }, settings: { ...defaultSettings(), ...(parsed.settings || {}) } };
    const tagIdMap = new Map();
    for (const t of (parsed.tags || [])) {
      if (!t || typeof t.name !== 'string') { report.skipped++; continue; }
      const tag = makeTag({ name: t.name, color: t.color ?? null });
      if (t.id) tagIdMap.set(t.id, tag.id);
      incoming.tags.byId[tag.id] = tag;
    }
    const spaceOrder = [];
    for (const s of parsed.spaces) {
      if (!s || typeof s.name !== 'string') { report.skipped++; continue; }
      const space = makeSpace({ name: s.name, icon: s.icon ?? null, color: s.color ?? null, isFavorite: !!s.isFavorite });
      if (typeof s.createdAt === 'number') space.createdAt = s.createdAt;
      if (typeof s.updatedAt === 'number') space.updatedAt = s.updatedAt;
      incoming.spaces[space.id] = space;
      spaceOrder.push(space.id);
      for (const c of (s.collections || [])) {
        if (!c || typeof c.name !== 'string') { report.skipped++; continue; }
        const col = makeCollection({ spaceId: space.id, name: c.name, color: c.color ?? null, note: c.note ?? null });
        col.isCollapsed = !!c.isCollapsed;
        col.tagIds = remapTagList(c.tagIds, tagIdMap);
        if (typeof c.createdAt === 'number') col.createdAt = c.createdAt;
        if (typeof c.updatedAt === 'number') col.updatedAt = c.updatedAt;
        for (const raw of (c.items || [])) {
          if (!raw || typeof raw.url !== 'string') { report.skipped++; continue; }
          if (typeof raw.title === 'string' && raw.title.length > 8192) { report.skipped++; continue; }
          if (!safeHref(raw.url)) { report.skipped++; continue; }
          const item = makeItem({
            url: raw.url, title: raw.title, faviconUrl: raw.faviconUrl ?? null,
            note: raw.note ?? null, tagIds: remapTagList(raw.tagIds, tagIdMap), pinned: !!raw.pinned,
          });
          if (typeof raw.createdAt === 'number') item.createdAt = raw.createdAt;
          if (typeof raw.updatedAt === 'number') item.updatedAt = raw.updatedAt;
          if (typeof raw.lastOpenedAt === 'number') item.lastOpenedAt = raw.lastOpenedAt;
          col.items[item.id] = item; col.itemOrder.push(item.id);
        }
        incoming.collections[col.id] = col;
        space.collectionOrder.push(col.id);
      }
    }

    if (mode === 'replace') {
      const all = await _getAll();
      await _setMany({ [`meta_backup:import-${now()}`]: all });
      // wipe app keys
      const appKeys = Object.keys(all).filter((k) =>
        k === KEYS.META || k === KEYS.TAGS || k === KEYS.SETTINGS ||
        k.startsWith(KEYS.spacePrefix) || k.startsWith(KEYS.collectionPrefix));
      await _removeMany(appKeys);
      const meta = seedMeta(CURRENT_SCHEMA_VERSION);
      meta.spaceOrder = spaceOrder;
      meta.activeSpaceId = spaceOrder[0] || null;
      meta.appVersion = manifestVersion();
      incoming.meta = meta;
      await writeDenormalized(incoming);
      report.addedSpaces = Object.keys(incoming.spaces).length;
      report.addedCollections = Object.keys(incoming.collections).length;
      report.addedItems = Object.values(incoming.collections).reduce((n, c) => n + c.itemOrder.length, 0);
      report.addedTags = Object.keys(incoming.tags.byId).length;
      return report;
    }

    // --- merge ---
    const all = await _getAll();
    const db = normalizeRaw(all);
    // tags: de-dupe by case-insensitive name, remap incoming ids
    const nameToExistingTag = new Map(Object.values(db.tags.byId).map((t) => [t.name.toLowerCase(), t]));
    const mergedTagRemap = new Map(); // incomingNewId -> finalId
    for (const t of Object.values(incoming.tags.byId)) {
      const hit = nameToExistingTag.get(t.name.toLowerCase());
      if (hit) { mergedTagRemap.set(t.id, hit.id); }
      else { db.tags.byId[t.id] = t; mergedTagRemap.set(t.id, t.id); report.addedTags++; }
    }
    bumpRev(db.tags);
    const finalTagId = (id) => mergedTagRemap.get(id) || id;

    for (const sid of spaceOrder) {
      const space = incoming.spaces[sid];
      space.collectionOrder = space.collectionOrder.slice();
      db.spaces[space.id] = space;
      db.meta.spaceOrder = [...(db.meta.spaceOrder || []), space.id];
      report.addedSpaces++;
      space.collectionOrder.forEach((cid) => {
        const col = incoming.collections[cid];
        col.tagIds = (col.tagIds || []).map(finalTagId);
        for (const it of Object.values(col.items)) it.tagIds = (it.tagIds || []).map(finalTagId);
        db.collections[col.id] = col;
        report.addedCollections++;
        report.addedItems += col.itemOrder.length;
      });
    }
    if (!db.meta.activeSpaceId) db.meta.activeSpaceId = db.meta.spaceOrder[0] || null;
    db.meta.updatedAt = now(); bumpRev(db.meta);
    await writeDenormalized(db);
    return report;
  });
}

function remapTagList(list, map) {
  if (!Array.isArray(list)) return [];
  return list.map((id) => map.get(id)).filter(Boolean);
}

/** Wipe all app data (keeps nothing). Used by Settings "Delete all data". */
export async function wipeAll() {
  return _withLock(async () => {
    const all = await _getAll();
    const appKeys = Object.keys(all).filter((k) =>
      k === KEYS.META || k === KEYS.TAGS || k === KEYS.SETTINGS ||
      k.startsWith(KEYS.spacePrefix) || k.startsWith(KEYS.collectionPrefix) ||
      k.startsWith('meta_backup:'));
    await _removeMany(appKeys);
  });
}

/* ------------------------------------------------------------------ */
/* Undo helpers (exact re-insertion)                                   */
/* ------------------------------------------------------------------ */

/** Re-insert an existing item object (preserving its id) at a given index. */
export async function insertItem(collectionId, item, index = -1) {
  return _withLock(async () => {
    const c = await _get(KEYS.collection(collectionId));
    if (!c) throw new Error('collection not found');
    c.items[item.id] = item;
    c.itemOrder = (c.itemOrder || []).filter((id) => id !== item.id);
    const idx = index < 0 || index > c.itemOrder.length ? c.itemOrder.length : index;
    c.itemOrder.splice(idx, 0, item.id);
    c.updatedAt = now(); bumpRev(c);
    await _setMany({ [KEYS.collection(collectionId)]: c });
    return item;
  });
}

/**
 * Re-create a previously-deleted space (preserving its id) together with all of
 * its collections/items, and restore its position in meta.spaceOrder. `space`
 * is the hydrated form (collections as array, each with items as array) from
 * getState. Used for an exact deleteSpace undo.
 */
export async function reinsertSpace(space, index = -1) {
  return _withLock(async () => {
    const meta = await _get(KEYS.META);
    const writes = {};
    const collectionOrder = [];
    for (const c of (space.collections || [])) {
      const itemsMap = {};
      let itemOrder = [];
      if (Array.isArray(c.items)) { itemOrder = c.items.map((i) => i.id); for (const it of c.items) itemsMap[it.id] = it; }
      else { Object.assign(itemsMap, c.items || {}); itemOrder = (c.itemOrder || Object.keys(itemsMap)).slice(); }
      const col = { ...c, items: itemsMap, itemOrder, spaceId: space.id, updatedAt: now() };
      writes[KEYS.collection(col.id)] = col;
      collectionOrder.push(col.id);
    }
    const sp = { ...space, collectionOrder, updatedAt: now() };
    delete sp.collections;
    writes[KEYS.space(space.id)] = sp;
    meta.spaceOrder = (meta.spaceOrder || []).filter((id) => id !== space.id);
    const idx = index < 0 || index > meta.spaceOrder.length ? meta.spaceOrder.length : index;
    meta.spaceOrder.splice(idx, 0, space.id);
    if (!meta.activeSpaceId) meta.activeSpaceId = space.id;
    meta.updatedAt = now(); bumpRev(meta);
    writes[KEYS.META] = meta;
    await _setMany(writes);
    return sp;
  });
}

/**
 * Re-create a previously-deleted collection (with its items) and restore its
 * position in the space's collectionOrder. `collection` may be the hydrated
 * form (items as array) from getState — normalized here.
 */
export async function reinsertCollection(spaceId, collection, index = -1) {
  return _withLock(async () => {
    const s = await _get(KEYS.space(spaceId));
    if (!s) throw new Error('space not found');
    const itemsMap = {};
    let itemOrder = collection.itemOrder ? collection.itemOrder.slice() : [];
    if (Array.isArray(collection.items)) {
      itemOrder = collection.items.map((it) => it.id);
      for (const it of collection.items) itemsMap[it.id] = it;
    } else {
      Object.assign(itemsMap, collection.items || {});
    }
    const col = { ...collection, items: itemsMap, itemOrder, spaceId, updatedAt: now() };
    delete col.__index;
    s.collectionOrder = (s.collectionOrder || []).filter((id) => id !== col.id);
    const idx = index < 0 || index > s.collectionOrder.length ? s.collectionOrder.length : index;
    s.collectionOrder.splice(idx, 0, col.id);
    s.updatedAt = now(); bumpRev(s);
    await _setMany({ [KEYS.collection(col.id)]: col, [KEYS.space(spaceId)]: s });
    return col;
  });
}

/* ------------------------------------------------------------------ */
/* Change feed                                                         */
/* ------------------------------------------------------------------ */

const _listeners = new Set();
let _wired = false;
function _wireOnChanged() {
  if (_wired) return; _wired = true;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const relevant = Object.keys(changes).filter((k) =>
      k === KEYS.META || k === KEYS.TAGS || k === KEYS.SETTINGS ||
      k.startsWith(KEYS.spacePrefix) || k.startsWith(KEYS.collectionPrefix));
    if (!relevant.length) return;
    for (const cb of _listeners) {
      try { cb({ keys: relevant, changes }); } catch (e) { log.error('subscriber error', e); }
    }
  });
}

/** Subscribe to store changes across all extension contexts. Returns unsubscribe. */
export function subscribe(cb) {
  _wireOnChanged();
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}
