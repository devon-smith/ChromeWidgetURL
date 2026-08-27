// Typed message contract shared by UI pages and the service worker.
// Every message is { type, payload }; every response is
// { ok:true, data } | { ok:false, error }.

export const MessageTypes = Object.freeze({
  PING: 'PING',
  SAVE_CURRENT_TAB: 'SAVE_CURRENT_TAB',
  SAVE_TABS: 'SAVE_TABS',
  SAVE_WINDOW: 'SAVE_WINDOW',
  SAVE_ALL_TABS: 'SAVE_ALL_TABS',
  RESTORE_COLLECTION: 'RESTORE_COLLECTION',
  OPEN_LINK: 'OPEN_LINK',
  CLOSE_TABS: 'CLOSE_TABS',
  OPEN_DASHBOARD: 'OPEN_DASHBOARD',
  REFRESH_CONTEXT_MENUS: 'REFRESH_CONTEXT_MENUS',
});

/**
 * Send a message to the service worker and unwrap the {ok,data|error} envelope.
 * @param {string} type
 * @param {object} [payload]
 * @returns {Promise<any>} resolves with `data`, rejects with the error string.
 */
export async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, payload });
  if (!res) throw new Error('no response from background worker');
  if (res.ok) return res.data;
  throw new Error(res.error || 'unknown error');
}
