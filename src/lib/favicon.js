// Favicon rendering. Primary source is Chrome's own favicon cache via the
// _favicon endpoint (requires the "favicon" permission). We NEVER fetch() it,
// never hotlink third-party favicon services, and never store image bytes.

import { hostnameOf } from './url-safe.js';

/**
 * Build the chrome-extension://<id>/_favicon/ URL for a page URL. Chrome serves
 * its cached icon for that page — works offline, no host permission, no network.
 * @param {string} pageUrl the SAVED page URL (not an icon URL)
 * @param {number} size 16 | 24 | 32 | 64
 * @returns {string}
 */
export function faviconUrl(pageUrl, size = 32) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', String(size));
  return u.toString();
}

// Deterministic pleasant color from a string (hostname) — HSL, fixed S/L.
function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

/**
 * A data-URI SVG monogram tile used when the favicon cache has nothing.
 * First letter of the hostname on a hashed pastel background. Stores nothing.
 * @param {string} domainOrUrl
 * @param {number} size
 * @returns {string} data: URI
 */
export function placeholderDataUri(domainOrUrl, size = 32) {
  const host = domainOrUrl.includes('://') ? hostnameOf(domainOrUrl) : domainOrUrl;
  const letter = (host || '?').replace(/^www\./, '').charAt(0).toUpperCase() || '?';
  const hue = hashHue(host || '?');
  const bg = `hsl(${hue} 55% 55%)`;
  // Static SVG; the only interpolated values are a single letter and numbers,
  // and it is used purely as an <img> src (never inserted into the DOM as HTML).
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="7" fill="${bg}"/>` +
    `<text x="16" y="21" font-family="system-ui,Arial,sans-serif" font-size="16" ` +
    `font-weight="600" fill="#fff" text-anchor="middle">${escapeXml(letter)}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(s) {
  return s.replace(/[<>&"']/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]
  ));
}

/**
 * Create an <img> for an item's favicon with a monogram fallback wired up.
 * @param {{url:string, domain?:string}} item
 * @param {number} size
 * @returns {HTMLImageElement}
 */
export function faviconImg(item, size = 32) {
  const img = document.createElement('img');
  img.className = 'favicon';
  img.width = 16;
  img.height = 16;
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  const domain = item.domain || hostnameOf(item.url);
  img.src = faviconUrl(item.url, size);
  img.addEventListener('error', () => {
    img.src = placeholderDataUri(domain, size);
  }, { once: true });
  return img;
}
