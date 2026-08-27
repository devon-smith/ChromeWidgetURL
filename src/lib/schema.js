// Data model: factory/default builders + typedefs. Single source of truth for
// entity shape. store.js and migrations.js build on this.

import { uuid } from './ids.js';
import { hostnameOf, sourceLabelOf } from './url-safe.js';

/** Bump when the persisted shape changes; must equal migrations.length. */
export const CURRENT_SCHEMA_VERSION = 1;

export const KEYS = {
  META: 'meta',
  TAGS: 'tags',
  SETTINGS: 'settings',
  spacePrefix: 'space:',
  collectionPrefix: 'collection:',
  space: (id) => `space:${id}`,
  collection: (id) => `collection:${id}`,
};

/**
 * @typedef {Object} Item
 * @property {string} id @property {'item'} type @property {string} url
 * @property {string} title @property {?string} faviconUrl @property {string} domain
 * @property {?string} sourceLabel @property {?string} note @property {string[]} tagIds
 * @property {boolean} pinned @property {number} createdAt @property {number} updatedAt
 * @property {?number} lastOpenedAt
 */

/**
 * @typedef {Object} Collection
 * @property {string} id @property {'collection'} type @property {string} spaceId
 * @property {string} name @property {?string} color @property {?string} note
 * @property {string[]} tagIds @property {boolean} isCollapsed
 * @property {string[]} itemOrder @property {Object.<string, Item>} items
 * @property {number} createdAt @property {number} updatedAt @property {number} rev
 */

/**
 * @typedef {Object} Space
 * @property {string} id @property {'space'} type @property {string} name
 * @property {?string} icon @property {?string} color @property {boolean} isFavorite
 * @property {string[]} collectionOrder
 * @property {number} createdAt @property {number} updatedAt @property {number} rev
 */

/** @typedef {Object} Tag @property {string} id @property {'tag'} type @property {string} name @property {?string} color @property {number} createdAt */

export function now() { return Date.now(); }

export function defaultSettings() {
  return {
    theme: 'system',
    defaultView: 'grid',
    defaultOpenBehavior: 'newWindow',
    newItemPosition: 'top',
    openTabsPanelVisible: true,
    dndEnabled: true,
    confirmOnDelete: true,
    closeUnsavedWarning: true,
    closeTabsAfterSaveDefault: false,
    dedupeOnSave: true,
    faviconSize: 32,
    largeOpenThreshold: 15,
    lastTargetCollectionId: null,
    newTabOverride: false,
    sidebarCollapsed: false,
    rev: 0,
  };
}

export function seedMeta(schemaVersion = 0) {
  const t = now();
  return {
    schemaVersion,
    appVersion: '0.0.0',
    createdAt: t,
    updatedAt: t,
    activeSpaceId: null,
    spaceOrder: [],
    lastExportAt: null,
    rev: 0,
  };
}

export function makeSpace({ name, icon = null, color = null, isFavorite = false }) {
  const t = now();
  return {
    id: uuid(), type: 'space', name: String(name).slice(0, 120),
    icon, color, isFavorite, collectionOrder: [],
    createdAt: t, updatedAt: t, rev: 0,
  };
}

export function makeCollection({ spaceId, name, color = null, note = null }) {
  const t = now();
  return {
    id: uuid(), type: 'collection', spaceId,
    name: String(name).slice(0, 120), color, note, tagIds: [],
    isCollapsed: false, itemOrder: [], items: {},
    createdAt: t, updatedAt: t, rev: 0,
  };
}

/**
 * @param {{url:string, title?:string, faviconUrl?:string, note?:string,
 *   tagIds?:string[], pinned?:boolean}} data
 * @returns {Item}
 */
export function makeItem(data) {
  const t = now();
  const url = data.url;
  const domain = data.domain || hostnameOf(url);
  const title = (data.title && String(data.title).trim())
    ? String(data.title).slice(0, 2000)
    : (domain || url);
  return {
    id: uuid(), type: 'item', url,
    title,
    faviconUrl: data.faviconUrl || null,
    domain,
    sourceLabel: data.sourceLabel || sourceLabelOf(url),
    note: data.note || null,
    tagIds: Array.isArray(data.tagIds) ? data.tagIds : [],
    pinned: !!data.pinned,
    createdAt: t, updatedAt: t, lastOpenedAt: null,
  };
}

export function makeTag({ name, color = null }) {
  return {
    id: uuid(), type: 'tag',
    name: String(name).trim().slice(0, 60),
    color, createdAt: now(),
  };
}
