// Convert a Toby export (various shapes) into a Local Toby backup tree that
// store.importJSON({mode:'merge'}) can ingest. Pure + DOM-free + tolerant.

/** Find the array of "lists" in a Toby export, across known shapes. */
function extractLists(toby) {
  if (Array.isArray(toby)) return toby;
  if (Array.isArray(toby?.lists)) return toby.lists;
  if (Array.isArray(toby?.groups)) return toby.groups;
  if (Array.isArray(toby?.data?.lists)) return toby.data.lists;
  if (Array.isArray(toby?.collections)) return toby.collections;
  return [];
}

/**
 * @param {object} toby parsed Toby export JSON
 * @returns {object} Local Toby backup tree (format 'local-toby-backup')
 * @throws if no recognizable lists are found
 */
export function tobyToBackup(toby) {
  const lists = extractLists(toby);
  if (!lists.length) throw new Error('No Toby lists found — is this a Toby export file?');

  const collections = [];
  for (const list of lists) {
    const cards = list.cards || list.items || list.links || [];
    const items = [];
    for (const c of cards) {
      const url = c.url || c.link || c.href;
      if (typeof url !== 'string' || !url) continue;
      const title = c.customTitle || c.title || c.name || '';
      const note = c.customDescription || c.description || null;
      items.push({ type: 'item', url, title, note });
    }
    collections.push({ type: 'collection', name: list.title || list.name || 'Untitled list', items });
  }

  return {
    format: 'local-toby-backup',
    schemaVersion: 1,
    source: 'toby-import',
    spaces: [{ type: 'space', name: 'Imported from Toby', icon: '📥', collections }],
    tags: [],
  };
}
