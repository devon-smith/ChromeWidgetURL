// Safe DOM construction helpers. Untrusted strings (titles, URLs, notes) always
// go in via textContent / setAttribute — never innerHTML. There is intentionally
// no HTML-string path in this module.

/**
 * Build an element.
 * @param {string} tag
 * @param {object} [props] - {class, text, title, href, dataset, on:{event:fn},
 *   attrs:{k:v}, style:{k:v}, and any DOM property}
 * @param {(Node|string|null|false|undefined)[]} [children]
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === 'class' || k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;           // untrusted-safe
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style') Object.assign(node.style, v);
    else if (k === 'attrs') for (const [ak, av] of Object.entries(v)) { if (av != null) node.setAttribute(ak, av); }
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
    else if (k in node) { try { node[k] = v; } catch { node.setAttribute(k, v); } }
    else node.setAttribute(k, v);
  }
  appendChildren(node, children);
  return node;
}

export function appendChildren(node, children) {
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Remove all children of a node. */
export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/** Inline SVG icon from a small named set (static path data only — no data interpolation). */
const ICONS = {
  search: 'M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10z',
  x: 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z',
  plus: 'M11 5v6H5v2h6v6h2v-6h6v-2h-6V5z',
  chevron: 'M8.1 5.3 6.7 6.7 12 12l-5.3 5.3 1.4 1.4L14.9 12z',
  chevronDown: 'M5.3 8.1 6.7 6.7 12 12l5.3-5.3 1.4 1.4L12 14.9z',
  dots: 'M12 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  external: 'M14 4v2h3.6l-8.3 8.3 1.4 1.4L19 7.4V11h2V4zM5 6v13h13v-7h-2v5H7V8h5V6z',
  copy: 'M15 1H4a2 2 0 0 0-2 2v12h2V3h11zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h10z',
  trash: 'M9 3v1H4v2h16V4h-5V3zM6 8v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8zm3 2h2v9H9zm4 0h2v9h-2z',
  save: 'M5 3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm2 2h6v4H7zm-1 8h12v6H6z',
  close: 'M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12 19 6.4 17.6 5 12 10.6z',
  window: 'M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 4v10h14V8z',
  star: 'M12 2l2.9 6.3 6.9.6-5.2 4.5 1.6 6.7L12 17.3 5.8 20.6l1.6-6.7L2.2 8.9l6.9-.6z',
  focus: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0-6v3m0 14v3M2 12h3m14 0h3',
  grid: 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z',
  list: 'M4 6h16v2H4zm0 5h16v2H4zm0 5h16v2H4z',
  tag: 'M2 12l9 9 11-11V2h-9zM17.5 7A1.5 1.5 0 1 1 17.5 4a1.5 1.5 0 0 1 0 3z',
  gear: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4-2 .3.6 2-2 1.2-1.4-1.5-1.8 1V19l-2 .8-1-1.7H10l-1 1.7-2-.8v-2.2l-1.8-1L3.8 17l-2-1.2.6-2L.4 12l.9-1.8-.6-2 2-1.2 1.4 1.5 1.8-1V4l2-.8 1 1.7h1.2l1-1.7 2 .8v2.2l1.8 1 1.4-1.5 2 1.2-.6 2z',
  check: 'M9.5 16.2 5.3 12l-1.4 1.4 5.6 5.6 12-12-1.4-1.4z',
};
export function icon(name, { size = 16, cls = 'icon' } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size); svg.setAttribute('height', size);
  svg.setAttribute('fill', 'currentColor'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || ICONS.dots);
  svg.appendChild(path);
  return svg;
}

/** Icon-only button. */
export function iconBtn(name, { title, onClick, cls = '', size = 16 } = {}) {
  return el('button', {
    class: `btn btn-icon ${cls}`.trim(),
    attrs: { 'aria-label': title || name, title: title || '' },
    on: onClick ? { click: onClick } : {},
  }, [icon(name, { size })]);
}
