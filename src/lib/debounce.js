// Debounce / throttle helpers for coalescing writes and render passes.

/**
 * Trailing-edge debounce. Returns a wrapped function; call .flush()/.cancel().
 * @param {Function} fn
 * @param {number} wait ms
 */
export function debounce(fn, wait = 150) {
  let t = null;
  let lastArgs = null;
  const wrapped = (...args) => {
    lastArgs = args;
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn(...lastArgs); }, wait);
  };
  wrapped.flush = () => { if (t) { clearTimeout(t); t = null; fn(...(lastArgs || [])); } };
  wrapped.cancel = () => { if (t) { clearTimeout(t); t = null; } };
  return wrapped;
}

/**
 * Coalesce many calls in a frame into one, using rAF when available
 * (pages) and a microtask fallback (worker, no rAF).
 * @param {Function} fn
 */
export function rafCoalesce(fn) {
  let scheduled = false;
  const schedule = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb) => Promise.resolve().then(cb);
  return (...args) => {
    if (scheduled) return;
    scheduled = true;
    schedule(() => { scheduled = false; fn(...args); });
  };
}
