// Tiny leveled logger. Guards console so production noise can be dialed down
// from one place. Levels: 0 silent, 1 error, 2 warn, 3 info, 4 debug.

let LEVEL = 3;

export function setLogLevel(n) { LEVEL = n; }

export const log = {
  error: (...a) => { if (LEVEL >= 1) console.error('[LocalToby]', ...a); },
  warn: (...a) => { if (LEVEL >= 2) console.warn('[LocalToby]', ...a); },
  info: (...a) => { if (LEVEL >= 3) console.info('[LocalToby]', ...a); },
  debug: (...a) => { if (LEVEL >= 4) console.debug('[LocalToby]', ...a); },
};
