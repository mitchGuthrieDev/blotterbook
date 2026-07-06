// Reactive economic-event overlay state for the Calendar screen + the dashboard Calendar module
// (R14 / R14b, on top of the R14a data layer). A .svelte.ts module so it can own the runes shared
// across those two views; App.svelte owns ONE instance per boot and passes it down.
//
// It wraps the LAZY core loader (loadEconEvents — deliberately NOT in the boot loadRefData path):
// the dataset is fetched the first time the overlay is enabled (or on boot when the persisted pref
// is already on), and never otherwise, so users who keep it off pay nothing. The impact filter
// ('high' = FOMC/CPI/NFP/GDP only; 'all' = also the medium-impact weekly EIA rows) is applied here
// so both views get identically-filtered events.
import {
  loadEconEvents,
  eventsForMonth as coreEventsForMonth,
  eventsForDay as coreEventsForDay,
  econEventsLoaded,
} from '../../lib/core/core.ts';
import type { EconEvent, StoreLike } from '../../lib/core/types.ts';

/** The persisted overlay preference. `off` hides all marks; `high` (the first-run default) shows the
 *  high-impact set; `all` additionally reveals the medium-impact weekly EIA rows. */
export type EconMode = 'off' | 'high' | 'all';
const MODES: readonly EconMode[] = ['off', 'high', 'all'];

/** Does an event pass the given overlay mode's impact filter? */
function passes(ev: EconEvent, mode: EconMode): boolean {
  if (mode === 'off') return false;
  if (mode === 'all') return true;
  return ev.impact === 'high';
}

/**
 * Build the reactive econ-overlay state. `store.local` is the persistence seam (real localStorage on
 * app/staging; the in-memory DemoStore.local on demo — so demo toggles work but persist nothing, by
 * construction, with NO special-casing here). `key` is the per-surface namespaced pref key
 * ('bb:econCal' / 'bb:staging:econCal'), mirroring the dashTabs/dashModules keys.
 *
 * First-run (no stored pref) resolves to 'high' per the owner's v1 decision (overlay ON, high-impact
 * only). Reading the pref at construction and kicking the lazy load when it's already on means a
 * returning user with the overlay enabled sees marks on first paint without touching the toggle.
 */
export function createEconOverlay(store: StoreLike, key: string) {
  const stored = store.local.get(key);
  const initial: EconMode = MODES.includes(stored as EconMode) ? (stored as EconMode) : 'high';

  let mode = $state<EconMode>(initial);
  // Bumped whenever the dataset finishes loading, so the $derived lookups below re-run once the
  // events exist (econEventsLoaded() is a plain function, not reactive, so it can't drive them alone).
  let loadedTick = $state(0);

  async function ensureLoaded() {
    if (econEventsLoaded()) return;
    await loadEconEvents();
    loadedTick++;
  }
  // Boot: if the overlay is already enabled from a prior session, warm the dataset now.
  if (initial !== 'off') void ensureLoaded();

  return {
    /** The current overlay mode. */
    get mode(): EconMode {
      return mode;
    },
    /** Overlay is showing at least the high-impact set. */
    get enabled(): boolean {
      return mode !== 'off';
    },
    /** True once the dataset has loaded (guard rendering marks on this). */
    get loaded(): boolean {
      loadedTick; // read the tick so this getter is reactive to the load completing
      return econEventsLoaded();
    },
    /** Set + persist the overlay mode; lazily loads the dataset the first time it's enabled. */
    setMode(next: EconMode) {
      mode = next;
      store.local.set(key, next); // demo → in-memory DemoStore.local (never persists) — no guard needed
      if (next !== 'off') void ensureLoaded();
    },
    /**
     * Filtered resolved events for a calendar month, keyed by `YYYY-MM-DD` — empty when the overlay
     * is off or the dataset hasn't loaded. `month` is 1-based (matches the core helper). Dates whose
     * events are all filtered out are omitted, so callers can treat presence as "has visible marks".
     */
    monthEvents(year: number, month: number): Map<string, EconEvent[]> {
      loadedTick; // reactive dependency
      if (mode === 'off' || !econEventsLoaded()) return new Map();
      const out = new Map<string, EconEvent[]>();
      for (const [date, evs] of coreEventsForMonth(year, month)) {
        const kept = evs.filter(e => passes(e, mode));
        if (kept.length) out.set(date, kept);
      }
      return out;
    },
    /** Filtered resolved events for a single ET calendar date (`YYYY-MM-DD`) — for the day drill-in. */
    dayEvents(date: string): EconEvent[] {
      loadedTick; // reactive dependency
      if (mode === 'off' || !econEventsLoaded()) return [];
      return coreEventsForDay(date).filter(e => passes(e, mode));
    },
  };
}

/** The reactive overlay instance type (App.svelte passes this to the screens). */
export type EconOverlay = ReturnType<typeof createEconOverlay>;
