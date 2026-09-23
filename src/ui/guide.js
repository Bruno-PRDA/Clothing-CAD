// src/ui/guide.js — the in-app user guide: a modal overlay with a contents list, search, and one long
// scrolling article built from src/ui/guideContent.js.
//
// Opened by the toolbar's "? Guide" button and the ? key (both arrive as ui:action {action:'guide'} and
// wiring calls `toggle`), and by any element anywhere in the app that carries data-guide="<section-id>"
// (the small "?" buttons in the dock panels and the fit banner), which opens straight at that section.
//
// The content is our own static module, but it is still rendered through an allow-list sanitizer: the
// guide is prose written by hand (and by agents), and a stray tag or inline handler in it must not become
// part of the app. Only the tags and attributes the content contract allows survive.

import { GUIDE_SECTIONS } from './guideContent.js';
import { SHORTCUTS } from './shortcuts.js';
import { byId } from './ids.js';

/** @typedef {import('../core/store.js').Store} Store */
/** @typedef {import('../core/events.js').EventBus} EventBus */
/** @typedef {{id: string, title: string, keywords?: string[], html: string}} GuideSection */

/** Tags the content may use, and the attributes each keeps. Everything else is unwrapped or dropped. */
const ALLOWED = Object.freeze({
  H3: [], H4: [], P: [], UL: [], OL: [], LI: [], STRONG: [], EM: [], CODE: [], KBD: [], BR: [],
  TABLE: [], THEAD: [], TBODY: [], TR: [], TH: [], TD: [],
  DIV: ['class'], SPAN: ['class'], A: ['data-guide'],
});
/** Allowed values of `class`. */
const CLASSES = Object.freeze(['guide-tip', 'guide-warn', 'guide-ui', 'guide-shortcuts']);
/** Elements whose whole subtree is dropped rather than unwrapped. */
const DROP = Object.freeze(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'SVG', 'MATH', 'TEMPLATE', 'LINK', 'META', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT']);

/**
 * What each shortcut does, in words, keyed by action (and tool / mode / tab where the action has one).
 * @type {Readonly<Record<string, string>>}
 */
const SHORTCUT_LABELS = Object.freeze({
  'tool:select': 'Select tool', 'tool:draw': 'Draw tool', 'tool:edit': 'Edit points tool', 'tool:split': 'Split edge tool',
  'tool:seam': 'Seam tool', 'tool:notch': 'Notch tool', 'tool:grainline': 'Grainline tool', 'tool:measure': 'Measure tool',
  mirror: 'Set or clear the fold edge of the selected piece',
  togglePlay: 'Play or pause the simulation',
  reset: 'Reset the simulation',
  drape: 'Drape: arrange, sew and play',
  fit2d: 'Fit the pieces in the 2D view',
  frame3d: 'Frame the body in the 3D view',
  undo: 'Undo', redo: 'Redo', save: 'Save the project', open: 'Open a project',
  delete: 'Delete the selection (while drawing: remove the last point)',
  cancel: 'Cancel what you are doing, or clear the selection',
  confirm: 'Close the piece you are drawing',
  nudge: 'Nudge the selection 1 mm (with Shift: 10 mm)',
  'layout:2d': '2D pattern only', 'layout:3d': '3D view only', 'layout:split': 'Split view',
  'zoom:in': 'Zoom the 2D view in', 'zoom:out': 'Zoom the 2D view out', 'zoom:fit': 'Fit the pieces in the 2D view',
  'dockTab:pieces': 'Pieces tab', 'dockTab:body': 'Body tab', 'dockTab:fabric': 'Fabric tab', 'dockTab:sizes': 'Sizes tab',
  guide: 'Open or close this guide',
});

const KEY_NAMES = Object.freeze({
  ' ': 'Space', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', delete: 'Delete', backspace: 'Backspace',
  escape: 'Esc', enter: 'Enter',
});

/**
 * Rows of the shortcut table, derived from the live SHORTCUTS table so it can never drift from it.
 * @returns {Array<{label: string, keys: string[]}>}
 */
export function shortcutRows() {
  /** @type {Map<string, {label: string, keys: string[]}>} */
  const rows = new Map();
  for (const b of SHORTCUTS) {
    const p = typeof b.payload === 'function' ? { action: b.action } : /** @type {any} */ (b.payload);
    let id = b.action;
    if (b.action === 'tool') id = 'tool:' + p.tool;
    else if (b.action === 'layout') id = 'layout:' + p.mode;
    else if (b.action === 'dockTab') id = 'dockTab:' + p.tab;
    else if (b.action === 'zoom') id = 'zoom:' + (p.factor === 'fit' ? 'fit' : Number(p.factor) > 1 ? 'in' : 'out');
    const label = SHORTCUT_LABELS[id] || id;
    const base = KEY_NAMES[b.key] || (b.key.length === 1 ? b.key.toUpperCase() : b.key.toUpperCase());
    const key = (b.ctrl ? 'Ctrl+' : '') + (b.shift && !b.shiftAny ? 'Shift+' : '') + base;
    if (!rows.has(label)) rows.set(label, { label, keys: [] });
    const row = /** @type {{label: string, keys: string[]}} */ (rows.get(label));
    if (!row.keys.includes(key)) row.keys.push(key);
  }
  return [...rows.values()];
}

/**
 * Parse `html` and keep only what the content contract allows.
 * @param {Document} doc @param {string} html @returns {DocumentFragment}
 */
export function sanitizeGuideHtml(doc, html) {
  const tpl = doc.createElement('template');
  tpl.innerHTML = String(html || '');
  const frag = tpl.content;
  /** @param {Node} node */
  const clean = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) continue;                           // text
      if (child.nodeType !== 1) { child.remove(); continue; }       // comments, processing instructions
      const el = /** @type {Element} */ (child);
      const tag = el.tagName.toUpperCase();
      if (DROP.includes(tag)) { el.remove(); continue; }
      const keep = /** @type {any} */ (ALLOWED)[tag];
      if (!keep) {                                                   // unknown tag: keep its text, lose the tag
        clean(el);
        el.replaceWith(...el.childNodes);
        continue;
      }
      for (const attr of [...el.attributes]) {
        if (!keep.includes(attr.name)) { el.removeAttribute(attr.name); continue; }
        if (attr.name === 'class') {
          const cls = attr.value.split(/\s+/).filter((c) => CLASSES.includes(c));
          if (cls.length) el.setAttribute('class', cls.join(' ')); else el.removeAttribute('class');
        }
        if (attr.name === 'data-guide' && !/^[a-z0-9-]{1,64}$/.test(attr.value)) el.removeAttribute(attr.name);
      }
      if (tag === 'A') {
        el.setAttribute('href', '#');                                // keyboard-focusable, handled by click
        el.setAttribute('role', 'link');
      }
      clean(el);
    }
  };
  clean(frag);
  return frag;
}

/**
 * @param {Store} store @param {EventBus} bus @param {Document|HTMLElement} [root=document]
 * @returns {{open(section?: string): void, close(): void, toggle(section?: string): void, isOpen(): boolean,
 *   search(q: string): number, current(): string|null, sections(): string[], refresh(): void, destroy(): void}}
 */
export function createGuide(store, bus, root = document) {
  const doc0 = /** @type {Document} */ (root.ownerDocument || root);
  const overlay = byId(root, 'guide');
  const toc = byId(root, 'guide-toc');
  const body = byId(root, 'guide-body');
  const search = /** @type {HTMLInputElement|null} */ (byId(root, 'inp-guide-search'));
  const btnClose = byId(root, 'btn-guide-close');
  const btnOpen = byId(root, 'btn-guide');
  /** @type {Array<() => void>} */
  const offs = [];
  let destroyed = false;
  /** @type {Element|null} */
  let returnFocus = null;
  /** @type {string|null} */
  let currentId = null;

  /** @type {ReadonlyArray<GuideSection>} */
  const SECTIONS = GUIDE_SECTIONS;
  const ids = SECTIONS.map((s) => s.id);

  /** @param {EventTarget|null} t @param {string} type @param {(e: any) => void} fn @param {any} [opt] */
  function on(t, type, fn, opt) {
    if (!t) return;
    t.addEventListener(type, /** @type {EventListener} */ (fn), opt);
    offs.push(() => t.removeEventListener(type, /** @type {EventListener} */ (fn), opt));
  }

  // ------------------------------------------------------------------ build once
  /** @type {Map<string, {sec: HTMLElement, link: HTMLElement, content: HTMLElement, pristine: string, text: string}>} */
  const parts = new Map();
  if (toc && body) {
    toc.textContent = '';
    body.textContent = '';
    const list = doc0.createElement('ol');
    for (const s of SECTIONS) {
      const li = doc0.createElement('li');
      const a = doc0.createElement('a');
      a.href = '#';
      a.textContent = s.title;
      a.dataset.section = s.id;
      li.appendChild(a);
      list.appendChild(li);

      const sec = doc0.createElement('section');
      sec.className = 'guide-section';
      sec.dataset.section = s.id;
      const h = doc0.createElement('h2');
      h.textContent = s.title;
      sec.appendChild(h);
      const content = doc0.createElement('div');
      content.className = 'guide-content';
      content.appendChild(sanitizeGuideHtml(doc0, s.html));
      sec.appendChild(content);
      body.appendChild(sec);
      parts.set(s.id, { sec, link: a, content, pristine: '', text: (s.title + ' ' + (s.keywords || []).join(' ')).toLowerCase() });
    }
    toc.appendChild(list);
    fillShortcutTables();
    // Keep the pristine markup so a search can highlight and then restore it, and index the text.
    for (const p of parts.values()) {
      p.pristine = p.content.innerHTML;
      p.text = p.text + ' ' + (p.content.textContent || '').toLowerCase();
    }
    const empty = doc0.createElement('p');
    empty.className = 'guide-empty';
    empty.hidden = true;
    body.appendChild(empty);
  }

  /** The shortcuts section carries a placeholder that is filled from the live SHORTCUTS table. */
  function fillShortcutTables() {
    if (!body) return;
    for (const holder of body.querySelectorAll('.guide-shortcuts')) {
      const table = doc0.createElement('table');
      const head = doc0.createElement('thead');
      head.innerHTML = '<tr><th>Keys</th><th>Does</th></tr>';
      table.appendChild(head);
      const tb = doc0.createElement('tbody');
      for (const row of shortcutRows()) {
        const tr = doc0.createElement('tr');
        const k = doc0.createElement('td');
        row.keys.forEach((key, i) => {
          if (i) k.appendChild(doc0.createTextNode(' or '));
          key.split('+').forEach((part, j) => {
            if (j) k.appendChild(doc0.createTextNode('+'));
            const kbd = doc0.createElement('kbd');
            kbd.textContent = part;
            k.appendChild(kbd);
          });
        });
        const d = doc0.createElement('td');
        d.textContent = row.label;
        tr.append(k, d);
        tb.appendChild(tr);
      }
      table.appendChild(tb);
      holder.replaceWith(table);
    }
  }

  // ------------------------------------------------------------------ navigation
  /** @param {string} id @param {boolean} [smooth] */
  function goTo(id, smooth = false) {
    const p = parts.get(id);
    if (!p || !body) return;
    if (p.sec.hidden && search && search.value) { search.value = ''; runSearch(''); }
    setCurrent(id);
    const top = p.sec.offsetTop - body.offsetTop;
    if (typeof body.scrollTo === 'function') body.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    else body.scrollTop = top;
  }

  /** @param {string|null} id */
  function setCurrent(id) {
    currentId = id;
    for (const [k, p] of parts) {
      if (k === id) p.link.setAttribute('aria-current', 'true'); else p.link.removeAttribute('aria-current');
    }
  }

  /** Scroll-spy: the section whose top is nearest above the viewport's upper third is current. */
  function onScroll() {
    if (!body) return;
    const probe = body.scrollTop + body.clientHeight * 0.25;
    let best = null;
    for (const [k, p] of parts) {
      if (p.sec.hidden) continue;
      if (p.sec.offsetTop - body.offsetTop <= probe) best = k;
    }
    if (best && best !== currentId) setCurrent(best);
  }

  // ------------------------------------------------------------------ search
  /** @param {string} q @returns {number} sections shown */
  function runSearch(q) {
    const terms = String(q || '').toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
    let shown = 0;
    for (const [, p] of parts) {
      p.content.innerHTML = p.pristine;
      const hit = terms.every((t) => p.text.includes(t));
      p.sec.hidden = !hit;
      if (p.link.parentElement) p.link.parentElement.hidden = !hit;
      if (hit) {
        shown++;
        if (terms.length) highlight(p.content, terms);
      }
    }
    const empty = body && body.querySelector('.guide-empty');
    if (empty) {
      empty.hidden = shown > 0;
      empty.textContent = shown > 0 ? '' : 'Nothing in the guide matches "' + q.trim() + '". Try a shorter or different word.';
    }
    if (body) body.scrollTop = 0;
    onScroll();
    return shown;
  }

  /** Wrap every occurrence of the terms in <mark>, text nodes only. @param {HTMLElement} el @param {string[]} terms */
  function highlight(el, terms) {
    const re = new RegExp('(' + terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'gi');
    const walker = doc0.createTreeWalker(el, 4 /* SHOW_TEXT */);
    /** @type {Text[]} */
    const nodes = [];
    while (walker.nextNode()) nodes.push(/** @type {Text} */ (walker.currentNode));
    for (const n of nodes) {
      const s = n.nodeValue || '';
      if (!re.test(s)) continue;
      re.lastIndex = 0;
      const frag = doc0.createDocumentFragment();
      let last = 0;
      s.replace(re, (m, _g, i) => {
        if (i > last) frag.appendChild(doc0.createTextNode(s.slice(last, i)));
        const mark = doc0.createElement('mark');
        mark.textContent = m;
        frag.appendChild(mark);
        last = i + m.length;
        return m;
      });
      if (last < s.length) frag.appendChild(doc0.createTextNode(s.slice(last)));
      n.replaceWith(frag);
    }
  }

  // ------------------------------------------------------------------ open / close
  /** @param {string} [section] */
  function open(section) {
    if (destroyed || !overlay) return;
    if (overlay.hidden) {
      returnFocus = doc0.activeElement;
      overlay.hidden = false;
      if (btnOpen) btnOpen.setAttribute('aria-expanded', 'true');
    }
    if (section && parts.has(section)) goTo(section);
    else if (!currentId && ids.length) setCurrent(ids[0]);
    if (search) search.focus({ preventScroll: true });
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    // Never leave the keyboard focus inside the hidden dialog: the shortcut layer ignores keys aimed at a
    // text field, so a focused (hidden) search box would swallow every shortcut until the next click.
    const active = /** @type {HTMLElement|null} */ (doc0.activeElement);
    if (active && overlay.contains(active) && typeof active.blur === 'function') active.blur();
    overlay.hidden = true;
    if (btnOpen) btnOpen.setAttribute('aria-expanded', 'false');
    const back = /** @type {HTMLElement|null} */ (returnFocus);
    returnFocus = null;
    if (back && typeof back.focus === 'function' && doc0.contains(back)) back.focus({ preventScroll: true });
  }

  /** @param {string} [section] */
  function toggle(section) {
    if (overlay && !overlay.hidden && !section) close(); else open(section);
  }

  // ------------------------------------------------------------------ listeners
  on(btnClose, 'click', () => close());
  on(overlay, 'mousedown', (e) => { if (e.target === overlay) close(); });   // backdrop
  on(toc, 'click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[data-section]') : null;
    if (!a) return;
    e.preventDefault();
    goTo(a.dataset.section, true);
  });
  on(body, 'click', (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[data-guide]') : null;
    if (!a) return;
    e.preventDefault();
    goTo(a.getAttribute('data-guide'), true);
  });
  on(body, 'scroll', () => onScroll(), { passive: true });
  on(search, 'input', () => runSearch(search ? search.value : ''));
  on(search, 'keydown', (e) => {
    if (e.key === 'Enter') {                      // jump to the first match
      const first = [...parts.values()].find((p) => !p.sec.hidden);
      if (first) goTo(/** @type {string} */ (first.sec.dataset.section));
      e.preventDefault();
    }
  });
  // While the guide is open it owns the keyboard: Escape closes it, Tab stays inside it, and nothing
  // reaches the app's shortcut layer (a D typed into the search box must not start a drape).
  on(overlay, 'keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (search && search.value && doc0.activeElement === search) { search.value = ''; runSearch(''); return; }
      close();
      return;
    }
    if (e.key === 'Tab' && overlay) {
      const focusable = [...overlay.querySelectorAll('input, button, a[href]')].filter((el) => !el.closest('[hidden]'));
      if (focusable.length) {
        const first = /** @type {HTMLElement} */ (focusable[0]);
        const last = /** @type {HTMLElement} */ (focusable[focusable.length - 1]);
        if (e.shiftKey && doc0.activeElement === first) { last.focus(); e.preventDefault(); }
        else if (!e.shiftKey && doc0.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    }
    e.stopPropagation();
  });
  // Contextual help: any element in the app with data-guide opens the guide at that section.
  const scope = /** @type {any} */ (root).nodeType === 9 ? /** @type {Document} */ (root).documentElement : root;
  on(scope, 'click', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-guide]') : null;
    if (!el || (overlay && overlay.contains(el))) return;
    e.preventDefault();
    open(el.getAttribute('data-guide'));
  });

  return {
    open,
    close,
    toggle,
    isOpen: () => !!overlay && !overlay.hidden,
    search(q) { if (search) search.value = q; return runSearch(q); },
    current: () => currentId,
    sections: () => ids.slice(),
    refresh() { /* static content */ },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const off of offs) { try { off(); } catch { /* ignore */ } }
      offs.length = 0;
    },
  };
}
