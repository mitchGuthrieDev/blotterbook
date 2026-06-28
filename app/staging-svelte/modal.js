// Shared modal a11y action (A42 — parity with vanilla app/ui.js modalOpened/modalClosed). Apply to a
// modal's dialog node: `use:modal={{ onclose }}`. Provides Escape-to-close, a Tab/Shift+Tab focus
// trap with initial focus (B9), focus restore on close, and a REF-COUNTED body scroll-lock (B36) so
// stacked modals don't clobber each other's overflow. The consumer keeps its own overlay markup +
// click-outside handler; this only adds the keyboard + scroll-lock behaviors.

let locks = 0; // module-level → shared across every modal instance (ref-counted scroll lock)

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * @param {HTMLElement} node  the dialog element
 * @param {{ onclose?: () => void }} [params]
 */
export function modal(node, params = {}) {
  let onclose = params.onclose;
  const prevFocus = /** @type {HTMLElement|null} */ (document.activeElement);
  const focusables = () => [...node.querySelectorAll(FOCUSABLE)].filter(el => /** @type {HTMLElement} */ (el).offsetParent !== null);

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onclose && onclose();
      return;
    }
    if (e.key !== 'Tab') return;
    const f = focusables();
    if (!f.length) return;
    const first = /** @type {HTMLElement} */ (f[0]);
    const last = /** @type {HTMLElement} */ (f[f.length - 1]);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  node.addEventListener('keydown', onKeydown);
  if (locks++ === 0) document.body.style.overflow = 'hidden';
  // Move focus inside the dialog (the node itself is the fallback — it carries tabindex="-1").
  const f = focusables();
  /** @type {HTMLElement} */ (f[0] || node).focus();

  return {
    update(p) {
      onclose = p.onclose;
    },
    destroy() {
      node.removeEventListener('keydown', onKeydown);
      if (--locks <= 0) {
        locks = 0;
        document.body.style.overflow = '';
      }
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    },
  };
}
