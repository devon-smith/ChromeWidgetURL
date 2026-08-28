// Heuristic: which collection is the most natural home for a URL, based on the
// domain a collection already holds the most of. Pure + DOM-free.

import { hostnameOf } from './url-safe.js';

/**
 * Suggest a collection id to save `url` into.
 * Preference order:
 *   1. The collection whose items most often share this URL's domain.
 *   2. settings.lastTargetCollectionId (if it still exists).
 *   3. The active space's first collection.
 *   4. Any first collection.
 * @param {object} state  getState() result ({ meta, settings, spaces:[...] })
 * @param {string} url
 * @returns {string|null} collectionId
 */
export function suggestCollectionId(state, url) {
  const domain = hostnameOf(url);
  const collections = [];
  for (const s of state.spaces) for (const c of s.collections) collections.push(c);

  if (domain) {
    let best = null, bestScore = 0;
    for (const c of collections) {
      const score = c.items.reduce((n, it) => n + ((it.domain || hostnameOf(it.url)) === domain ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (best && bestScore > 0) return best.id;
  }

  const last = state.settings?.lastTargetCollectionId;
  if (last && collections.some((c) => c.id === last)) return last;

  const activeId = state.meta?.activeSpaceId;
  const activeSpace = state.spaces.find((s) => s.id === activeId) || state.spaces[0];
  return activeSpace?.collections[0]?.id || collections[0]?.id || null;
}
