// Convert a chrome.bookmarks tree into a Local Toby backup tree. Pure + DOM-free
// (the caller fetches the tree and requests the optional `bookmarks` permission).

/**
 * @param {Array} tree  result of chrome.bookmarks.getTree()
 * @returns {object} Local Toby backup tree
 */
export function bookmarksToBackup(tree) {
  const collections = [];

  const walk = (node, pathTitle) => {
    const items = [];
    for (const child of node.children || []) {
      if (child.url) items.push({ type: 'item', url: child.url, title: child.title || '' });
    }
    if (items.length) collections.push({ type: 'collection', name: pathTitle || 'Bookmarks', items });
    for (const child of node.children || []) {
      if (!child.url && child.children) {
        walk(child, pathTitle ? `${pathTitle} / ${child.title || ''}`.trim() : (child.title || 'Folder'));
      }
    }
  };

  for (const root of tree || []) {
    for (const top of root.children || []) walk(top, top.title || 'Bookmarks');
  }

  return {
    format: 'local-toby-backup',
    schemaVersion: 1,
    source: 'bookmarks-import',
    spaces: [{ type: 'space', name: 'Imported bookmarks', icon: '🔖', collections }],
    tags: [],
  };
}
