// Transient toasts with an optional Undo action. Single-level undo per toast.

import { el, iconBtn } from '../../lib/dom.js';

let stack;
function ensureStack() {
  if (!stack) {
    stack = el('div', { class: 'toast-stack', attrs: { 'aria-live': 'polite', role: 'status' } });
    document.body.appendChild(stack);
  }
  return stack;
}

/**
 * Show a toast.
 * @param {string} message
 * @param {{variant?:'success'|'error'|'info'|'neutral', duration?:number,
 *   undo?:()=>void}} [opts]
 */
export function toast(message, opts = {}) {
  const { variant = 'neutral', undo } = opts;
  const duration = opts.duration ?? (undo ? 8000 : 4000);
  const node = el('div', {
    class: `toast ${variant}`,
    attrs: { role: variant === 'error' ? 'alert' : 'status' },
  }, [
    el('span', { class: 'toast-msg', text: message }),
  ]);

  let timer = null;
  const dismiss = () => {
    if (timer) clearTimeout(timer);
    node.remove();
  };
  if (undo) {
    node.append(el('button', {
      class: 'toast-undo', text: 'Undo',
      on: { click: () => { try { undo(); } finally { dismiss(); } } },
    }));
  }
  node.append(iconBtn('x', { title: 'Dismiss', onClick: dismiss, size: 14 }));

  ensureStack().appendChild(node);
  const start = () => { timer = setTimeout(dismiss, duration); };
  start();
  node.addEventListener('mouseenter', () => { if (timer) clearTimeout(timer); });
  node.addEventListener('mouseleave', start);
  return { dismiss };
}
