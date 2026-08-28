// Sync reconciler. Merges two export trees (buildExportTree shape) by ENTITY ID
// with last-write-wins on updatedAt, honoring deletion tombstones. Pure + DOM-free.
//
// Unlike importJSON({mode:'merge'}) — which remints ids to import a *foreign*
// backup — this preserves ids so "same id" means "same entity" across devices.
//
// Policy:
//  - settings: keep LOCAL (device-specific prefs must not clobber across devices).
//  - tags: union by id; a tombstone deletes a tag (tags carry no updatedAt).
//  - spaces / collections / items: newest updatedAt wins; a tombstone wins when
//    its deletedAt >= the entity's updatedAt.
//  - ordering: the side with the newer container updatedAt supplies the order;
//    survivors missing from that order are appended (stable).
//  - deletions: unioned (newest deletedAt), pruned after PRUNE_MS in the output.

const PRUNE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function mergeRemote(local, remote, nowMs = Date.now()) {
  local = local || emptyTree();
  remote = remote || emptyTree();

  // ---- deletions: union, newest wins ----
  const deletions = {};
  for (const src of [local.deletions || {}, remote.deletions || {}]) {
    for (const [id, rec] of Object.entries(src)) {
      if (!rec) continue;
      if (!deletions[id] || (rec.deletedAt || 0) > (deletions[id].deletedAt || 0)) deletions[id] = rec;
    }
  }
  const tombstoned = (id, updatedAt) => deletions[id] && (deletions[id].deletedAt || 0) >= (updatedAt || 0);

  // ---- flatten both trees into id maps (newest wins) ----
  const spacesMap = {};   // id -> space + {updatedAt, __order:collectionOrder}
  const collMap = {};     // id -> collection + {spaceId, updatedAt, __order:itemOrder}
  const itemMap = {};     // id -> {item, parentCollectionId, updatedAt}
  const tagMap = {};      // id -> tag

  const ingest = (tree) => {
    for (const t of (tree.tags || [])) if (t && t.id && !tagMap[t.id]) tagMap[t.id] = t;
    for (const s of (tree.spaces || [])) {
      if (!s || !s.id) continue;
      const su = s.updatedAt || 0;
      if (!spacesMap[s.id] || su >= spacesMap[s.id].updatedAt) {
        spacesMap[s.id] = { ...s, updatedAt: su, __order: (s.collections || []).map((c) => c.id) };
      }
      for (const c of (s.collections || [])) {
        if (!c || !c.id) continue;
        const cu = c.updatedAt || 0;
        if (!collMap[c.id] || cu >= collMap[c.id].updatedAt) {
          collMap[c.id] = { ...c, spaceId: s.id, updatedAt: cu, __order: (c.items || []).map((i) => i.id) };
        }
        for (const it of (c.items || [])) {
          if (!it || !it.id) continue;
          const iu = it.updatedAt || 0;
          if (!itemMap[it.id] || iu >= itemMap[it.id].updatedAt) {
            itemMap[it.id] = { item: it, parentCollectionId: c.id, updatedAt: iu };
          }
        }
      }
    }
  };
  ingest(local); ingest(remote);

  // ---- apply tombstones ----
  for (const id of Object.keys(tagMap)) if (deletions[id]) delete tagMap[id];
  for (const id of Object.keys(spacesMap)) if (tombstoned(id, spacesMap[id].updatedAt)) delete spacesMap[id];
  for (const id of Object.keys(collMap)) if (tombstoned(id, collMap[id].updatedAt)) delete collMap[id];
  for (const id of Object.keys(itemMap)) if (tombstoned(id, itemMap[id].updatedAt)) delete itemMap[id];

  // ---- ordering authority = the side with the newer meta.updatedAt ----
  const remoteMetaNewer = (remote.meta?.updatedAt || 0) > (local.meta?.updatedAt || 0);
  const orderSrc = remoteMetaNewer ? remote : local;
  const spaceOrder = (orderSrc.spaces || []).map((s) => s.id).filter((id) => spacesMap[id]);
  for (const id of Object.keys(spacesMap)) if (!spaceOrder.includes(id)) spaceOrder.push(id);

  const orderedItemsFor = (cid) => {
    const survivors = Object.keys(itemMap).filter((id) => itemMap[id].parentCollectionId === cid);
    const survSet = new Set(survivors);
    const order = (collMap[cid].__order || []).filter((id) => survSet.has(id));
    for (const id of survivors) if (!order.includes(id)) order.push(id);
    return order.map((id) => ({ ...itemMap[id].item, type: 'item' }));
  };

  const buildCollection = (cid) => {
    const c = collMap[cid];
    return {
      id: c.id, type: 'collection', spaceId: c.spaceId, name: c.name, color: c.color ?? null,
      note: c.note ?? null, tagIds: c.tagIds || [], isCollapsed: !!c.isCollapsed,
      createdAt: c.createdAt, updatedAt: c.updatedAt, items: orderedItemsFor(cid),
    };
  };

  const placed = new Set();
  const collectionsFor = (sid) => {
    const survivors = Object.keys(collMap).filter((id) => collMap[id].spaceId === sid);
    const survSet = new Set(survivors);
    const order = (spacesMap[sid].__order || []).filter((id) => survSet.has(id));
    for (const id of survivors) if (!order.includes(id)) order.push(id);
    order.forEach((id) => placed.add(id));
    return order.map(buildCollection);
  };

  const spaces = spaceOrder.map((sid) => {
    const s = spacesMap[sid];
    return {
      id: s.id, type: 'space', name: s.name, icon: s.icon ?? null, color: s.color ?? null,
      isFavorite: !!s.isFavorite, createdAt: s.createdAt, updatedAt: s.updatedAt, collections: collectionsFor(sid),
    };
  });

  // safety: any surviving collection whose space is gone → attach to the first space
  const orphans = Object.keys(collMap).filter((id) => !placed.has(id));
  if (orphans.length && spaces[0]) {
    for (const id of orphans) { collMap[id].spaceId = spaces[0].id; spaces[0].collections.push(buildCollection(id)); }
  }

  // ---- prune old tombstones from the output ----
  const outDeletions = {};
  for (const [id, rec] of Object.entries(deletions)) {
    if (nowMs - (rec.deletedAt || 0) <= PRUNE_MS) outDeletions[id] = rec;
  }

  return {
    format: 'local-toby-backup',
    schemaVersion: Math.max(local.schemaVersion || 1, remote.schemaVersion || 1),
    exportedAt: nowMs,
    app: local.app || remote.app || { name: 'Local Toby' },
    meta: {
      updatedAt: Math.max(local.meta?.updatedAt || 0, remote.meta?.updatedAt || 0),
      activeSpaceId: (remoteMetaNewer ? remote.meta?.activeSpaceId : local.meta?.activeSpaceId) || local.meta?.activeSpaceId || null,
    },
    settings: local.settings || {},
    tags: Object.values(tagMap),
    deletions: outDeletions,
    spaces,
  };
}

function emptyTree() {
  return { format: 'local-toby-backup', schemaVersion: 1, meta: { updatedAt: 0, activeSpaceId: null }, settings: {}, tags: [], deletions: {}, spaces: [] };
}
