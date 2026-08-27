// Stable unique-ID generation. Single wrapper so the source is swappable.

/** @returns {string} an RFC-4122 v4 UUID. */
export function uuid() {
  // crypto.randomUUID is available in extension pages and MV3 workers (Chrome 92+).
  return crypto.randomUUID();
}

/**
 * Short, human-glanceable id with a type prefix (used in logs / debugging only —
 * persisted ids always use full uuid()).
 * @param {string} prefix
 */
export function shortId(prefix = 'id') {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}
