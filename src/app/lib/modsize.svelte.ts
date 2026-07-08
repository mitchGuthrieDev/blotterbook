// A319 — the shared DOM-side module-size controller (Dashboard + Analytics; any future sized screen).
// The PURE size/migration math lives in modlayout.ts (node-tested — keep it DOM-free); this module owns
// the interactive layer that was previously copy-pasted per screen: the per-module size map + its
// prop-reseed echo guard, the ⋯-menu/keyboard size setters, and the corner drag-resize pointer path.
// It's a rune-module factory: the screen passes its bound LayoutKit + closures over its own state
// (order / grid element / narrow query / persist callback) and renders through the returned handle.
import { spanFor, type LayoutKit, type ModEntry, type ModSize } from './modlayout.ts';

export const SIZE_LABEL: Record<ModSize, string> = { sm: 'Small', md: 'Medium', lg: 'Large' };

/** 12-track grid span as a STATIC Tailwind class (media-query-aware: no span below lg → mobile stacks;
 *  literal strings so the JIT generates them). sm = span 2 (six/row), md = span 6 (half), lg = span 12. */
export const spanClass = (size: ModSize): string => (size === 'sm' ? 'lg:col-span-2' : size === 'md' ? 'lg:col-span-6' : 'lg:col-span-12');

export type SizeControllerOpts = {
  /** The screen's persisted layout prop at setup time (later changes re-sync via `reseed`). */
  initial?: ModEntry[];
  /** The CURRENT module order — read at emit time, so a reorder that just landed is captured. */
  order: () => string[];
  /** Persist callback (the screen's `onmoduleschange` prop). */
  emit: (mods: ModEntry[]) => void;
  /** The 12-track grid element — measured for drag snapping. */
  grid: () => HTMLElement | undefined;
  /** Suppress the pointer path (mobile stacks; size is ignored there). */
  narrow?: () => boolean;
};

export type SizeController = ReturnType<typeof createSizeController>;

export function createSizeController(kit: LayoutKit, opts: SizeControllerOpts) {
  const sizesOfProp = (mm?: ModEntry[]): Record<string, ModSize> => Object.fromEntries((mm ?? []).map(e => [e.key, e.size]));

  let modSizes = $state<Record<string, ModSize>>(sizesOfProp(opts.initial));
  let lastModKey = opts.initial ? JSON.stringify(opts.initial) : '';
  let resizing = $state<{ key: string; size: ModSize } | null>(null);
  let rafPending = 0;

  const sizeOf = (key: string): ModSize => modSizes[key] ?? kit.defaultSizeFor(key);
  /** The rendered size: the live drag preview while this key is mid-resize, else the committed size. */
  const previewSize = (key: string): ModSize => (resizing?.key === key ? resizing.size : sizeOf(key));
  const sizeIndex = (key: string): number => kit.supportedSizes(key).indexOf(sizeOf(key));

  /** Re-sync from the persisted prop (first load after boot / workspace switch). Returns whether the
   *  prop actually changed, so a screen with extra prop-derived state (Dashboard's order) can update
   *  it in the same effect. The JSON echo guard stays in sync with `emitCurrent` so the layout we just
   *  emitted doesn't redundantly reseed when it echoes back. */
  function reseed(modules?: ModEntry[]): boolean {
    const key = modules ? JSON.stringify(modules) : '';
    if (key === lastModKey) return false;
    lastModKey = key;
    modSizes = sizesOfProp(modules);
    return true;
  }

  /** Recombine the screen's current order + the size map into the persisted ModEntry[] and emit. */
  function emitCurrent() {
    const mods = opts.order().map(k => ({ key: k, size: sizeOf(k) }));
    lastModKey = JSON.stringify(mods);
    opts.emit(mods);
  }

  function setSize(key: string, size: ModSize) {
    if (!kit.supportedSizes(key).includes(size) || sizeOf(key) === size) return;
    modSizes = { ...modSizes, [key]: size };
    emitCurrent();
  }

  // Snap to the nearest of the module's SUPPORTED sizes (by 12-track span) — so a drag can't land on a
  // size a module doesn't offer (e.g. the current rich modules skip Small).
  const nearestSize = (key: string, spanGuess: number): ModSize =>
    kit.supportedSizes(key).reduce((best, s) => (Math.abs(spanFor(s) - spanGuess) < Math.abs(spanFor(best) - spanGuess) ? s : best));

  /** Corner drag-resize (pointer path) — rAF-throttled, live-previewed via `previewSize`, committed on
   *  release. A317: the span is measured from the DRAG DELTA against the module's span at grab time —
   *  the old card-left-edge measure made Large unreachable for a right-column module (its own left sits
   *  mid-grid, so the guess maxed out at ~6 tracks with the pointer already at the grid's right edge).
   *  The delta is DIAGONAL (x + y, matching the handle's nwse cursor): a right-column module's handle
   *  already sits at the grid's right edge with no room to travel right, but down/down-right always
   *  has room — so grow = drag toward bottom-right, shrink = drag toward top-left. */
  function startResize(e: PointerEvent, key: string) {
    if (opts.narrow?.()) return;
    const gridEl = opts.grid();
    const handle = e.currentTarget as HTMLElement;
    if (!gridEl) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const trackW = Math.max(1, gridEl.getBoundingClientRect().width / 12);
    const startSpan = spanFor(sizeOf(key));
    const startX = e.clientX;
    const startY = e.clientY;
    // rAF-throttled, but always applying the LATEST event — early-returning while a frame is pending
    // would drop every move inside that frame including the final pointer position, committing a
    // stale size on a fast drag-and-release.
    let lastEv: PointerEvent;
    const onMove = (ev: PointerEvent) => {
      lastEv = ev;
      if (rafPending) return;
      rafPending = requestAnimationFrame(() => {
        rafPending = 0;
        const deltaTracks = (lastEv.clientX - startX + (lastEv.clientY - startY)) / trackW;
        resizing = { key, size: nearestSize(key, startSpan + deltaTracks) };
      });
    };
    // A317: `pointercancel` (touch interrupted by a system gesture, pen out of range) tears down
    // WITHOUT committing — otherwise the listeners leak and the abandoned preview wedges this key's
    // rendered span until the next interaction.
    const finish = (commit: boolean) => () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onCancel);
      if (rafPending) {
        cancelAnimationFrame(rafPending);
        rafPending = 0;
      }
      if (commit && resizing) setSize(resizing.key, resizing.size);
      resizing = null;
    };
    const onUp = finish(true);
    const onCancel = finish(false);
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onCancel);
  }

  /** Keyboard path on the role="slider" handle: arrow keys step through the supported sizes. */
  function onResizeKey(e: KeyboardEvent, key: string) {
    const sizes = kit.supportedSizes(key);
    const i = sizes.indexOf(sizeOf(key));
    if ((e.key === 'ArrowRight' || e.key === 'ArrowUp') && i < sizes.length - 1) {
      e.preventDefault();
      setSize(key, sizes[i + 1]);
    } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowDown') && i > 0) {
      e.preventDefault();
      setSize(key, sizes[i - 1]);
    }
  }

  return {
    supportedSizes: kit.supportedSizes,
    sizeOf,
    previewSize,
    sizeIndex,
    reseed,
    emitCurrent,
    setSize,
    startResize,
    onResizeKey,
  };
}
