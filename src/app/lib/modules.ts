/* A108: the dashboard MODULE REGISTRY. Each module DECLARES itself here — identity (key), menu label,
   F26 grid membership, surface gating, its component, and a pure selector from the shared dashboard
   context (DashCtx) to that component's props. App.svelte iterates this list instead of hand-syncing a
   DEFAULT_ORDER + MODULE_LABELS + GRID_KEYS + a per-module `{#if key === …}` render switch (the pre-A108
   wiring, where adding a module — e.g. the F23 Trade Blotter — touched five disjoint spots keyed by the
   same magic string). Adding a module now = one entry here + the component.

   Pure view-layer wiring: the framework-agnostic core (A29) is untouched, and the selectors read DashCtx
   getters, so reactivity is preserved at the call site in App (the spread re-runs when a read changes). */
import type { Component } from 'svelte';
import type { Metrics } from '../../lib/core/core.ts';
import type { AppSetup, CostInputs, Trade, StoredTradeMeta } from '../../lib/core/types.ts';
import EquityCurve from '../components/EquityCurve.svelte';
import CalendarMonth from '../components/CalendarMonth.svelte';
import TradeBlotter from '../components/TradeBlotter.svelte';
import CostPanel from '../components/CostPanel.svelte';
import AdvancedStats from '../components/AdvancedStats.svelte';
import Definitions from '../components/Definitions.svelte';
import ActivityTerminal from '../components/ActivityTerminal.svelte';

/** The shared dashboard state + callbacks a module's prop-selector may read. App provides this as a
 *  live object (getters over its $state/$derived), so each selector stays fine-grained reactive. */
export interface DashCtx {
  metricsAll: Metrics;
  metricsActive: Metrics;
  breakEvenMetrics: Metrics;
  costInputs: CostInputs;
  journalDates: Set<string>;
  selectedDate: string | null;
  calYear: number;
  calMonth: number;
  filtered: Trade[];
  tradeMeta: Map<string, StoredTradeMeta>;
  filtersActive: boolean;
  setup: AppSetup;
  isDemo: boolean;
  onselect: (d: string) => void;
  navMonth: (delta: number) => void;
  jumpToLatest: () => void;
  reloadAll: () => void | Promise<void>;
}

/** The resolved per-surface flags App passes to a module's `gate`. */
type Surface = { isStaging: boolean; isDemo: boolean };

export interface ModuleDef {
  key: string;
  label: string;
  /** F26 (staging): renders in the parallel grid rather than as a full-width row. */
  grid: boolean;
  /** Which surfaces the module ships on (defaults to everywhere). */
  gate: (s: Surface) => boolean;
  /** Heterogeneous registry — each entry's props are checked against its component by mod() below. */
  component: Component<any>;
  /** Selector: shared dashboard context → this component's props (App supplies `panel`/`extra` itself). */
  props: (c: DashCtx) => object;
}

/* Per-entry type binding: P is inferred from `component`, and `props` must return exactly that
   component's props MINUS the chrome App supplies itself (`panel`, and the calendar's `extra` snippet).
   The entry is then erased to ModuleDef so the registry is a single heterogeneous array — the only
   `any` is the erased component type, while each selector stays checked against its real component. */
function mod<P extends Record<string, any>>(d: {
  key: string;
  label: string;
  grid?: boolean;
  gate?: (s: Surface) => boolean;
  component: Component<P>;
  props?: (c: DashCtx) => Omit<P, 'panel' | 'extra'>;
}): ModuleDef {
  return { grid: false, gate: () => true, props: () => ({}), ...d } as ModuleDef;
}

/* The registry. The array ORDER is the default dashboard order (DEFAULT_ORDER). 'defs' is gated to
   non-staging (F27 relegated it to a page footer on staging); cal/cost/adv are the F26 grid members. */
export const MODULES: ModuleDef[] = [
  mod({
    key: 'perf',
    label: 'Performance',
    component: EquityCurve,
    props: c => ({
      metrics: c.metricsAll,
      costInputs: c.costInputs,
      journalDates: c.journalDates,
      selectedDate: c.selectedDate,
      onselect: c.onselect,
    }),
  }),
  mod({
    key: 'cal',
    label: 'Trading Calendar',
    grid: true,
    component: CalendarMonth,
    props: c => ({
      metrics: c.metricsAll,
      year: c.calYear,
      month: c.calMonth,
      onnav: c.navMonth,
      onjump: c.jumpToLatest,
      selectedDate: c.selectedDate,
      journalDates: c.journalDates,
      onselect: c.onselect,
    }),
  }),
  mod({
    key: 'blotter',
    label: 'Trade Blotter',
    component: TradeBlotter,
    props: c => ({ trades: c.filtered, tradeMeta: c.tradeMeta, broker: c.setup.broker, filtered: c.filtersActive, onchanged: c.reloadAll }),
  }),
  mod({
    key: 'cost',
    label: 'Break-even & Cost',
    grid: true,
    component: CostPanel,
    props: c => ({ metrics: c.breakEvenMetrics, setup: c.setup, costInputs: c.costInputs, allTime: true, disabled: c.isDemo }),
  }),
  mod({
    key: 'adv',
    label: 'Advanced Statistics',
    grid: true,
    component: AdvancedStats,
    props: c => ({ metrics: c.metricsActive }),
  }),
  mod({
    key: 'defs',
    label: 'Definitions & Caveats',
    component: Definitions,
    gate: s => !s.isStaging, // F27: on staging this is a page footer, not a dashboard module
  }),
  mod({
    key: 'term',
    label: 'Activity Terminal',
    component: ActivityTerminal,
  }),
];

/** Lookup by key, for App's render dispatch. */
export const MODULE_BY_KEY: Record<string, ModuleDef> = Object.fromEntries(MODULES.map(m => [m.key, m]));
