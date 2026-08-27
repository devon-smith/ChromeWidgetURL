// URL safety + parsing. Saved URLs are UNTRUSTED (a page controls what we save,
// and backup files are hand-editable). Validate scheme before storing, before
// rendering an href, and again before opening. There is no code path that
// executes a stored string.

const ALLOWED = new Set(['http:', 'https:', 'ftp:', 'file:']);

/**
 * Return a safe, normalized href string, or null if the scheme is not allowed
 * or the URL is unparseable. Blocks javascript:, data:, blob:, vbscript:, etc.
 * @param {string} raw
 * @returns {string|null}
 */
export function safeHref(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const u = new URL(raw);
    return ALLOWED.has(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

/** @returns {boolean} whether the URL is safe to open/store. */
export function isOpenable(raw) {
  return safeHref(raw) !== null;
}

/**
 * Hostname of a URL, or '' if unparseable. Used for domain grouping / labels.
 * @param {string} raw
 */
export function hostnameOf(raw) {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// A few well-known hostnames get a friendlier label than the bare domain.
const KNOWN_LABELS = new Map([
  ['mail.google.com', 'Gmail'],
  ['docs.google.com', 'Google Docs'],
  ['drive.google.com', 'Google Drive'],
  ['sheets.google.com', 'Google Sheets'],
  ['calendar.google.com', 'Google Calendar'],
  ['github.com', 'GitHub'],
  ['gist.github.com', 'GitHub Gist'],
  ['figma.com', 'Figma'],
  ['notion.so', 'Notion'],
  ['linear.app', 'Linear'],
  ['youtube.com', 'YouTube'],
  ['stackoverflow.com', 'Stack Overflow'],
]);

/**
 * A friendly source label derived from a URL's hostname (e.g. "Figma",
 * "Google Docs"). Falls back to a Title-Cased second-level domain.
 * @param {string} raw
 * @returns {string}
 */
export function sourceLabelOf(raw) {
  const host = hostnameOf(raw);
  if (!host) {
    // Non-http schemes (file:, ftp:) — label by scheme.
    try { return new URL(raw).protocol.replace(':', '') || 'Link'; }
    catch { return 'Link'; }
  }
  if (KNOWN_LABELS.has(host)) return KNOWN_LABELS.get(host);
  const bare = host.replace(/^www\./, '');
  // registrable-ish label: second-level for two-part hosts, else the sub.
  const parts = bare.split('.');
  const core = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return core.charAt(0).toUpperCase() + core.slice(1);
}

/**
 * Normalize a URL for duplicate detection: lowercase host, strip trailing
 * slash, drop the hash (query kept). Returns the raw string if unparseable.
 * @param {string} raw
 * @param {{ignoreHash?: boolean}} [opts]
 */
export function normalizeUrl(raw, { ignoreHash = true } = {}) {
  try {
    const u = new URL(raw);
    u.hostname = u.hostname.toLowerCase();
    if (ignoreHash) u.hash = '';
    let s = u.href;
    // strip a single trailing slash on the path (but keep "https://host/")
    if (u.pathname !== '/' && s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return raw;
  }
}
