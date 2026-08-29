// Local Toby — mobile companion PWA. Reads your Drive-synced library and opens
// links; can add a shared link (iOS Share Sheet) back into a collection.
// Reuses the extension's pure modules (dom.js, url-safe.js) via relative import.

import { el } from '../src/lib/dom.js';
import { safeHref, hostnameOf, sourceLabelOf, normalizeUrl } from '../src/lib/url-safe.js';
import * as drive from './drive.js';

const $ = (id) => document.getElementById(id);
const state = { token: null, fileId: null, tree: null, query: '', add: null };

/* ------------------------------ boot ------------------------------ */
async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

  // pending share-sheet add?
  const params = new URLSearchParams(location.search);
  const addUrl = params.get('add');
  if (addUrl && safeHref(addUrl)) state.add = { url: addUrl, title: params.get('title') || '' };

  $('signin').addEventListener('click', () => signIn(true));
  $('search').addEventListener('input', (e) => { state.query = e.target.value; renderLibrary(); });
  $('signout').addEventListener('click', () => { drive.signOut(); state.token = null; state.tree = null; showAuth('Signed out.'); });

  // try silent sign-in
  try { await signIn(false); } catch { showAuth(); }
}

async function signIn(interactive) {
  setStatus('Signing in…');
  state.token = await drive.getToken({ interactive });
  await load();
}

async function load() {
  setStatus('Loading your library…');
  const file = await drive.findLibrary(state.token);
  if (!file) {
    showApp();
    setStatus('No library found in Drive yet. Connect & sync on the desktop extension first.');
    return;
  }
  state.fileId = file.id;
  state.tree = await drive.download(state.token, file.id) || { spaces: [] };
  showApp();
  setStatus('');
  if (state.add) renderAddPanel();
  renderLibrary();
}

/* ---------------------------- rendering --------------------------- */
function monogram(text) {
  const host = text && text.includes('://') ? hostnameOf(text) : (text || '');
  const letter = (host || '?').replace(/^www\./, '').charAt(0).toUpperCase() || '?';
  let h = 0; for (let i = 0; i < (host || '?').length; i++) h = (h * 31 + host.charCodeAt(i)) % 360;
  return el('span', { class: 'mono', text: letter, style: { background: `hsl(${h} 55% 50%)` } });
}

function card(item) {
  const href = safeHref(item.url);
  const c = el('a', {
    class: 'card', attrs: { href: href || '#', target: '_blank', rel: 'noopener', title: item.url },
  }, [
    monogram(item.domain || item.url),
    el('span', { class: 'card-body' }, [
      el('span', { class: 'card-title', text: item.title || item.domain || item.url }),
      el('span', { class: 'card-sub', text: item.sourceLabel || item.domain || hostnameOf(item.url) }),
    ]),
  ]);
  if (!href) c.addEventListener('click', (e) => e.preventDefault());
  return c;
}

function renderLibrary() {
  const root = $('library');
  root.replaceChildren();
  const q = state.query.trim().toLowerCase();
  const match = (it) => !q || [it.title, it.url, it.domain, it.sourceLabel].filter(Boolean).some((s) => String(s).toLowerCase().includes(q));

  let shown = 0;
  for (const space of state.tree.spaces || []) {
    for (const col of space.collections || []) {
      const items = (col.items || []).filter(match);
      if (!items.length) continue;
      shown += items.length;
      root.append(el('div', { class: 'collection' }, [
        el('div', { class: 'collection-h' }, [
          el('span', { class: 'collection-name', text: col.name }),
          el('span', { class: 'collection-space', text: space.name }),
          el('span', { class: 'collection-count', text: String(items.length) }),
        ]),
        el('div', { class: 'cards' }, items.map(card)),
      ]));
    }
  }
  if (!shown) root.append(el('div', { class: 'empty', text: q ? `No matches for “${state.query}”` : 'Your library is empty.' }));
}

/* ----------------------------- add flow --------------------------- */
function renderAddPanel() {
  const panel = $('add-panel');
  panel.replaceChildren();
  panel.hidden = false;
  const collections = [];
  for (const s of state.tree.spaces || []) for (const c of s.collections || []) collections.push({ c, s });

  const last = localStorage.getItem('lt-last-collection');
  collections.sort((a, b) => (b.c.id === last ? 1 : 0) - (a.c.id === last ? 1 : 0));

  panel.append(
    el('div', { class: 'add-head', text: 'Save this link to…' }),
    el('div', { class: 'add-link' }, [
      el('span', { class: 'add-link-title', text: state.add.title || state.add.url }),
      el('span', { class: 'add-link-url', text: state.add.url }),
    ]),
    el('div', { class: 'add-list' }, collections.map(({ c, s }) => el('button', {
      class: 'add-target', on: { click: () => addTo(c.id) },
    }, [el('span', { text: c.name }), el('span', { class: 'add-target-space', text: s.name })]))),
    el('button', { class: 'add-cancel', text: 'Cancel', on: { click: dismissAdd } }),
  );
}

async function addTo(collectionId) {
  try {
    setStatus('Saving…');
    // re-download fresh so we never clobber remote changes, then append + upload
    const fresh = await drive.download(state.token, state.fileId) || state.tree;
    let target = null;
    for (const s of fresh.spaces || []) for (const c of s.collections || []) if (c.id === collectionId) target = c;
    if (!target) throw new Error('collection not found');
    const url = state.add.url;
    const dup = (target.items || []).some((it) => normalizeUrl(it.url) === normalizeUrl(url));
    if (!dup) {
      const now = Date.now();
      (target.items ||= []).push({
        id: crypto.randomUUID(), type: 'item', url,
        title: state.add.title || hostnameOf(url), domain: hostnameOf(url),
        sourceLabel: sourceLabelOf(url), note: null, tagIds: [], pinned: false,
        createdAt: now, updatedAt: now, lastOpenedAt: null,
      });
      target.updatedAt = now;
      fresh.meta = { ...(fresh.meta || {}), updatedAt: now };
      await drive.upload(state.token, state.fileId, JSON.stringify(fresh));
    }
    localStorage.setItem('lt-last-collection', collectionId);
    state.tree = fresh;
    dismissAdd();
    setStatus(dup ? 'Already saved there.' : 'Saved ✓ — it’ll appear on desktop after sync.');
    renderLibrary();
  } catch (e) { setStatus('Save failed: ' + (e.message || e)); }
}

function dismissAdd() {
  state.add = null;
  $('add-panel').hidden = true;
  history.replaceState(null, '', location.pathname);
}

/* ------------------------------ ui ------------------------------- */
function setStatus(msg) { $('status').textContent = msg || ''; $('status').hidden = !msg; }
function showAuth(msg) { $('auth').hidden = false; $('app').hidden = true; setStatus(msg || ''); }
function showApp() { $('auth').hidden = true; $('app').hidden = false; }

boot();
