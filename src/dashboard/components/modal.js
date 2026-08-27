// Reusable dialog: generic modal, plus confirm() and prompt() helpers. Focus is
// trapped; Esc closes; focus returns to the invoker.

import { el, iconBtn, clear } from '../../lib/dom.js';

let openInvoker = null;

/**
 * Open a modal. `build(close)` returns { title, body, footer? } DOM.
 * @param {(close:(v:any)=>void)=>{title:string, body:Node|Node[], footer?:Node}} build
 * @param {{wide?:boolean}} [opts]
 * @returns {Promise<any>} resolves with the value passed to close()
 */
export function openModal(build, opts = {}) {
  openInvoker = document.activeElement;
  return new Promise((resolve) => {
    const scrim = el('div', { class: 'scrim' });
    const close = (value) => {
      scrim.remove();
      document.removeEventListener('keydown', onKey, true);
      if (openInvoker && openInvoker.focus) openInvoker.focus();
      resolve(value);
    };
    const built = build(close);
    const modal = el('div', {
      class: `modal ${opts.wide ? 'wide' : ''}`.trim(),
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': built.title || 'Dialog' },
    }, [
      el('div', { class: 'modal-header' }, [
        el('h2', { text: built.title || '' }),
        iconBtn('x', { title: 'Close', cls: 'modal-close', onClick: () => close(undefined) }),
      ]),
      el('div', { class: 'modal-body' }, [].concat(built.body || [])),
      built.footer ? el('div', { class: 'modal-footer' }, [].concat(built.footer)) : null,
    ]);
    scrim.appendChild(modal);
    scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) close(undefined); });

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(undefined); }
      else if (e.key === 'Tab') trapTab(e, modal);
    };
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(scrim);
    // focus first field or primary button
    const focusable = modal.querySelector('input, textarea, select, button.btn-primary, button');
    if (focusable) focusable.focus();
  });
}

function trapTab(e, container) {
  const items = [...container.querySelectorAll('a[href], button:not([disabled]), input, textarea, select, [tabindex]:not([tabindex="-1"])')]
    .filter((n) => n.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

/** Confirm dialog. Resolves true/false. */
export function confirmDialog({ title = 'Are you sure?', message = '', confirmLabel = 'Confirm', danger = false } = {}) {
  return openModal((close) => ({
    title,
    body: el('p', { text: message, style: { color: 'var(--text-2)' } }),
    footer: [
      el('button', { class: 'btn btn-ghost', text: 'Cancel', on: { click: () => close(false) } }),
      el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: confirmLabel, on: { click: () => close(true) } }),
    ],
  }));
}

/** Text prompt. Resolves the entered string, or undefined if cancelled. */
export function promptDialog({ title = 'Enter a value', label = 'Name', value = '', placeholder = '', confirmLabel = 'Save' } = {}) {
  return openModal((close) => {
    const input = el('input', { type: 'text', value, placeholder, attrs: { 'aria-label': label } });
    const submit = () => { const v = input.value.trim(); if (v) close(v); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    return {
      title,
      body: el('label', {}, [el('span', { text: label }), input]),
      footer: [
        el('button', { class: 'btn btn-ghost', text: 'Cancel', on: { click: () => close(undefined) } }),
        el('button', { class: 'btn btn-primary', text: confirmLabel, on: { click: submit } }),
      ],
    };
  });
}
