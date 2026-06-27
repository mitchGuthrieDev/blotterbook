'use strict';
import { $, STAGING_PAGE } from './core.js';
import { Store } from './store.js';
/* Blotterbook app · ui — collapsible/drag-to-reorder panels, file-download/setup-label helpers,
   and the shared modal a11y + ref-counted body-scroll-lock helpers. A native ES module (A20):
   imports what it needs, exports what others use.
   (The activity terminal, session pill, and workspace templates live in widgets.js, loaded on every app page since CH16.) */

/* ============================================================
   Collapsible + drag-to-reorder panels (persisted)
   ============================================================ */
// Layout state lives in localStorage (per-ORIGIN), reached through the single Store.local seam (A13)
// rather than touching localStorage directly. Staging is a separate environment, so it gets its own
// namespaced keys — rearranging/collapsing modules in staging must NOT leak into prod/demo (and vice
// versa). prod + demo share one set (same environment; the demo mirrors prod 1:1). STAGING_PAGE is
// set in core.js.
export const LS_SUFFIX = STAGING_PAGE ? '_staging' : '';
export const LS_ORDER = 'tj_order' + LS_SUFFIX,
  LS_COLLAPSE = 'tj_collapsed' + LS_SUFFIX;
export function saveOrder() {
  const ord = [...document.querySelectorAll('#dash .panel')].map(p => p.dataset.key);
  Store.local.set(LS_ORDER, ord);
}
export function saveCollapsed() {
  const col = {};
  document.querySelectorAll('#dash .panel').forEach(p => {
    if (p.classList.contains('collapsed')) col[p.dataset.key] = 1;
  });
  Store.local.set(LS_COLLAPSE, col);
}
export function panelAfter(dash, y) {
  const els = [...dash.querySelectorAll('.panel:not(.dragging)')];
  let closest = null,
    off = -Infinity;
  for (const el of els) {
    const b = el.getBoundingClientRect();
    const d = y - b.top - b.height / 2;
    if (d < 0 && d > off) {
      off = d;
      closest = el;
    }
  }
  return closest;
}
export function initPanels() {
  const dash = document.getElementById('dash');
  const ord = Store.local.get(LS_ORDER, null);
  if (Array.isArray(ord))
    ord.forEach(k => {
      const el = dash.querySelector(`.panel[data-key="${k}"]`);
      if (el) dash.appendChild(el);
    });
  const col = Store.local.get(LS_COLLAPSE, {}) || {};
  dash.querySelectorAll('.panel').forEach(p => {
    if (col[p.dataset.key]) p.classList.add('collapsed');
    const head = p.querySelector('.phead'),
      grip = p.querySelector('.grip');
    head.addEventListener('click', e => {
      if (e.target.closest('.grip')) return;
      // L6: when the collapse control is hidden (non-full-width panel on the wide grid), the
      // header click is a no-op — don't toggle a state the user can't see or reverse.
      const chev = p.querySelector('.chev');
      if (chev && getComputedStyle(chev).display === 'none') return;
      p.classList.toggle('collapsed');
      saveCollapsed();
    });
    grip.addEventListener('mousedown', () => p.setAttribute('draggable', 'true'));
    grip.addEventListener('mouseup', () => p.removeAttribute('draggable'));
    p.addEventListener('dragstart', e => {
      p.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', p.dataset.key);
      } catch (_) {}
    });
    p.addEventListener('dragend', () => {
      p.classList.remove('dragging');
      p.removeAttribute('draggable');
      saveOrder();
    });
  });
  dash.addEventListener('dragover', e => {
    e.preventDefault();
    const dragging = dash.querySelector('.panel.dragging');
    if (!dragging) return;
    const after = panelAfter(dash, e.clientY);
    if (after == null) dash.appendChild(dragging);
    else dash.insertBefore(dragging, after);
  });
}

/* ============================================================
   Helpers — file download, current setup labels
   ============================================================ */
// Accepts a string (wrapped in a Blob of `type`) OR a ready-made Blob (CH11: replaces the
// old export-only expDlBlob helper).
export function downloadFile(name, data, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
export function stateLabel() {
  const o = $('c_state_sel');
  return o && o.selectedOptions[0] ? o.selectedOptions[0].textContent : '—';
}

/* ============================================================
   Modal a11y (B9) — shared by the data-manager and export modals.
   modalOpened(): flip aria-hidden, remember the trigger, move focus inside,
   and trap Tab within the dialog. modalClosed(): reverse it and restore focus.
   State is stashed on the element so the two modals never clobber each other.
   ============================================================ */
export function modalFocusables(root) {
  return [
    ...root.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    ),
  ].filter(el => el.offsetParent !== null); // visible only
}
// B36: body-scroll lock shared by every modal, ref-counted so stacked modals can't clobber each
// other's overflow — lock on the FIRST open, unlock only when the LAST closes. The per-element
// `_scrollLocked` flag makes a double open/close on one modal idempotent (no over/under-count).
let _scrollLocks = 0;
function lockScroll(ov) {
  if (ov._scrollLocked) return;
  ov._scrollLocked = true;
  if (_scrollLocks++ === 0) document.body.style.overflow = 'hidden';
}
function unlockScroll(ov) {
  if (!ov._scrollLocked) return;
  ov._scrollLocked = false;
  if (--_scrollLocks <= 0) {
    _scrollLocks = 0;
    document.body.style.overflow = '';
  }
}
export function modalOpened(ov) {
  if (!ov) return;
  ov.setAttribute('aria-hidden', 'false');
  lockScroll(ov); // B36: ref-counted body-scroll lock (no longer set ad-hoc per modal)
  ov._prevFocus = document.activeElement;
  const f = modalFocusables(ov);
  if (f[0]) f[0].focus();
  ov._trap = e => {
    if (e.key !== 'Tab') return;
    const items = modalFocusables(ov);
    if (!items.length) return;
    const first = items[0],
      last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  ov.addEventListener('keydown', ov._trap);
}
export function modalClosed(ov) {
  if (!ov) return;
  ov.setAttribute('aria-hidden', 'true');
  unlockScroll(ov); // B36: release the ref-counted body-scroll lock
  if (ov._trap) {
    ov.removeEventListener('keydown', ov._trap);
    ov._trap = null;
  }
  if (ov._prevFocus && ov._prevFocus.focus) ov._prevFocus.focus();
  ov._prevFocus = null;
}
