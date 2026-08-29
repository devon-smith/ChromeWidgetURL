// Google auth (launchWebAuthFlow, token/implicit flow — secret-free, works on
// Brave) + minimal Drive REST (drive.file scope). No client secret is shipped.

import { CLIENT_ID, SCOPE, DRIVE_FILENAME } from './sync-config.js';
import { log } from './logger.js';

const TOKEN_KEY = 'syncToken'; // { access_token, expiresAt } in storage.session

/** A 401 from Drive → token is dead; callers should re-auth. */
export class AuthError extends Error {}

async function getCachedToken() {
  try {
    const out = await chrome.storage.session.get(TOKEN_KEY);
    const t = out[TOKEN_KEY];
    if (t && t.access_token && t.expiresAt > Date.now() + 60_000) return t.access_token;
  } catch { /* session storage may be unavailable */ }
  return null;
}

async function cacheToken(access_token, expiresInSec) {
  try {
    await chrome.storage.session.set({ [TOKEN_KEY]: { access_token, expiresAt: Date.now() + expiresInSec * 1000 } });
  } catch { /* ignore */ }
}

export async function clearToken() {
  try { await chrome.storage.session.remove(TOKEN_KEY); } catch { /* ignore */ }
}

/**
 * Get an access token. interactive=true opens Google's consent popup (call from
 * a page, in a user gesture); interactive=false attempts a silent refresh.
 * @returns {Promise<string>}
 */
export async function getAccessToken({ interactive = false } = {}) {
  const cached = await getCachedToken();
  if (cached) return cached;

  const redirectUri = chrome.identity.getRedirectURL();
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('response_type', 'token');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('prompt', interactive ? 'consent' : 'none');

  let redirectUrl;
  try {
    redirectUrl = await chrome.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive });
  } catch (e) {
    throw new AuthError(interactive ? `Sign-in was cancelled or failed: ${e?.message ?? e}` : 'silent auth failed');
  }
  if (!redirectUrl) throw new AuthError('no redirect from auth flow');

  const frag = new URL(redirectUrl).hash.replace(/^#/, '');
  const params = new URLSearchParams(frag);
  const token = params.get('access_token');
  const expiresIn = parseInt(params.get('expires_in') || '3600', 10);
  const err = params.get('error');
  if (err) throw new AuthError(`auth error: ${err}`);
  if (!token) throw new AuthError('no access_token in redirect');
  await cacheToken(token, expiresIn);
  return token;
}

/** Best-effort token revocation on disconnect. */
export async function revoke() {
  const token = await getCachedToken();
  await clearToken();
  if (!token) return;
  try { await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }); }
  catch (e) { log.warn('revoke failed', e); }
}

/* ------------------------- Drive REST ------------------------- */

async function driveFetch(url, opts, token) {
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts?.headers || {}) } });
  if (res.status === 401) { await clearToken(); throw new AuthError('Drive returned 401'); }
  if (!res.ok) throw new Error(`Drive ${res.status}: ${await res.text().catch(() => '')}`.slice(0, 300));
  return res;
}

/** Find our library file. Returns {id, modifiedTime} or null. */
export async function findFile(token) {
  const u = new URL('https://www.googleapis.com/drive/v3/files');
  u.searchParams.set('q', `name='${DRIVE_FILENAME}' and trashed=false`);
  u.searchParams.set('spaces', 'drive');
  u.searchParams.set('fields', 'files(id,modifiedTime,name)');
  const res = await driveFetch(u.toString(), {}, token);
  const data = await res.json();
  const f = (data.files || [])[0];
  return f ? { id: f.id, modifiedTime: f.modifiedTime } : null;
}

export async function getModifiedTime(token, fileId) {
  const u = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime`;
  const res = await driveFetch(u, {}, token);
  return (await res.json()).modifiedTime;
}

/** Download + parse the JSON content of a file. */
export async function downloadJson(token, fileId) {
  const u = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await driveFetch(u, {}, token);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return null; }
}

/** Create the library file with the given JSON string. Returns {id, modifiedTime}. */
export async function createFile(token, contentString) {
  const boundary = '----localtoby' + Math.random().toString(36).slice(2);
  const metadata = { name: DRIVE_FILENAME, mimeType: 'application/json' };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${contentString}\r\n--${boundary}--`;
  const res = await driveFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime',
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, token);
  return res.json();
}

/** Replace the content of an existing file. Returns {id, modifiedTime}. */
export async function updateFile(token, fileId, contentString) {
  const res = await driveFetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,modifiedTime`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: contentString }, token);
  return res.json();
}

/* ------------------------- folders (backups) ------------------------- */

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Find (or create) a folder by name at Drive root. Returns its id. */
export async function findOrCreateFolder(token, name) {
  const u = new URL('https://www.googleapis.com/drive/v3/files');
  u.searchParams.set('q', `name='${name}' and mimeType='${FOLDER_MIME}' and trashed=false`);
  u.searchParams.set('fields', 'files(id,name)');
  const res = await driveFetch(u.toString(), {}, token);
  const existing = (await res.json()).files || [];
  if (existing[0]) return existing[0].id;
  const created = await driveFetch(
    'https://www.googleapis.com/drive/v3/files?fields=id',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME }) }, token);
  return (await created.json()).id;
}

/** Create a JSON file inside a folder. Returns {id, name}. */
export async function createInFolder(token, name, contentString, parentId) {
  const boundary = '----localtoby' + Math.random().toString(36).slice(2);
  const metadata = { name, mimeType: 'application/json', parents: [parentId] };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${contentString}\r\n--${boundary}--`;
  const res = await driveFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, token);
  return res.json();
}

/** List files in a folder, newest first. Returns [{id,name,createdTime}]. */
export async function listInFolder(token, parentId) {
  const u = new URL('https://www.googleapis.com/drive/v3/files');
  u.searchParams.set('q', `'${parentId}' in parents and trashed=false`);
  u.searchParams.set('fields', 'files(id,name,createdTime)');
  u.searchParams.set('orderBy', 'createdTime desc');
  u.searchParams.set('pageSize', '100');
  const res = await driveFetch(u.toString(), {}, token);
  return (await res.json()).files || [];
}

export async function deleteFile(token, fileId) {
  await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, { method: 'DELETE' }, token);
}
