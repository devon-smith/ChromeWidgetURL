// Browser twin of the extension's gdrive.js — Google Identity Services token
// flow + minimal Drive REST (drive.file). Uses the SAME OAuth client as the
// extension, so drive.file grants access to the same library file.

import { CLIENT_ID, SCOPE, DRIVE_FILENAME } from '../src/lib/sync-config.js';

let _tokenClient = null;
let _token = null;
let _tokenExp = 0;

function initClient() {
  if (_tokenClient) return;
  // eslint-disable-next-line no-undef
  _tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: () => {} });
}

/** Get an access token via GIS. interactive=false attempts a silent grant. */
export function getToken({ interactive = true } = {}) {
  if (_token && _tokenExp > Date.now() + 60_000) return Promise.resolve(_token);
  return new Promise((resolve, reject) => {
    initClient();
    _tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error));
      _token = resp.access_token;
      _tokenExp = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
      resolve(_token);
    };
    try { _tokenClient.requestAccessToken({ prompt: interactive ? '' : 'none' }); }
    catch (e) { reject(e); }
  });
}

export function signOut() { _token = null; _tokenExp = 0; }

async function api(url, opts, token) {
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...(opts?.headers || {}) } });
  if (res.status === 401) { signOut(); throw new Error('unauthorized'); }
  if (!res.ok) throw new Error(`Drive ${res.status}`);
  return res;
}

export async function findLibrary(token) {
  const u = new URL('https://www.googleapis.com/drive/v3/files');
  u.searchParams.set('q', `name='${DRIVE_FILENAME}' and trashed=false`);
  u.searchParams.set('spaces', 'drive');
  u.searchParams.set('fields', 'files(id,modifiedTime,name)');
  const res = await api(u.toString(), {}, token);
  const f = (await res.json()).files || [];
  return f[0] ? { id: f[0].id, modifiedTime: f[0].modifiedTime } : null;
}

export async function download(token, fileId) {
  const res = await api(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {}, token);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return null; }
}

export async function upload(token, fileId, contentString) {
  await api(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: contentString }, token);
}
