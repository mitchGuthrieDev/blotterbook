<script lang="ts" module>
  export type DashStat = { label: string; value: string; badge?: string; up?: boolean; note: string; key?: string };
  export type DayCell = { pnl: number; tr: number };
  // (A320: the default module layout + the key/label table are single-sourced in modlayout.ts —
  // DEFAULT_MODULE_KEYS / DASHBOARD_MODULES; the app's workspace-template save uses
  // modlayout.defaultLayout(), so nothing imports a layout constant from this component anymore.)
  // Live filter model for the dashboard Filters popover — current values + option lists + mutators
  // (bound to the app's filter state).
  export type FilterPatch = Partial<{
    root: string;
    side: string;
    session: string;
    tag: string;
    from: string;
    to: string;
    dows: number[];
    hours: number[];
  }>;
  export type FilterModel = {
    root: string;
    side: string;
    session: string;
    tag: string;
    from: string;
    to: string;
    dows: number[];
    /** Hour-of-day buckets (0–23) — A197 hour click-to-filter on the Analytics chart. */
    hours: number[];
    roots: string[];
    tags: string[];
    count: number;
    set: (patch: FilterPatch) => void;
    clear: () => void;
    /** Saved filter views (A49 parity) — CRUD is optional (demo omits the write paths). */
    views?: { id: string; name: string }[];
    canSaveView?: boolean;
    saveView?: (name: string) => void;
    applyView?: (id: string) => void;
    deleteView?: (id: string) => void;
    renameView?: (id: string, name: string) => void;
  };
  // A238: the per-card drill-in content types now live with the shared StatCardRow part (adopted by
  // Dashboard + Analytics). Re-export them so the app's statDetail builder keeps importing them from
  // the Dashboard entry point.
  export type { StatBar, StatDetail } from '../parts/StatCardRow.svelte';
  // F39/A142 batch-1 module data (Today · Drawdown Status · Streak Monitor). Built app-side from the
  // scope-active Metrics (App wires `moduleData={dash.dashModuleData}` for full per-trade fidelity),
  // and DERIVED here from the `series`+`recentTrades` props as a self-contained fallback so the
  // modules render real numbers on every surface with no extra wiring. `unit`/`capped` flags say
  // which granularity a field carries so the labels stay honest across both sources.
  export type StreakRun = { kind: 'win' | 'loss' | 'flat' | 'none'; len: number; sum: number };
  export type StreakRec = { maxWin: number; maxLoss: number; maxWinSum: number; maxLossSum: number };
  export type DashModuleData = {
    /** The most recent active day; null when there are no trades in scope. */
    lastDay: {
      date: string;
      net: number;
      trades: number;
      wins: number;
      winRate: number;
      best: number;
      worst: number;
      /** The day's per-trade breakdown was read from a capped recent-trades window (may undercount). */
      capped: boolean;
    } | null;
    avgDaily: number;
    /** Baseline trades/day — null when unknown (the series-only fallback can't count total trades). */
    avgTrades: number | null;
    winDayPct: number;
    activeDays: number;
    dd: {
      current: number;
      currentPct: number | null;
      sincePeak: number;
      /** Whether `sincePeak`/`maxDDdur` count trades (App-wired) or days (fallback). */
      unit: 'trade' | 'day';
      maxDD: number;
      maxDDpct: number | null;
      maxDDdur: number;
      recovery: number;
      atHigh: boolean;
    };
    streak: {
      /** Current per-trade run; `capped` when it filled the recent-trades window (fallback). */
      trade: StreakRun & { capped: boolean };
      /** Current per-day run. */
      day: StreakRun;
      /** Record runs the current `trade` run is measured against (per-trade when wired, per-day in fallback). */
      rec: StreakRec;
      recUnit: 'trade' | 'day';
      /** Per-day record runs (always available). */
      dayRec: StreakRec;
    };
  };
</script>

<script lang="ts">
  // Dashboard — the redesigned overview: a scope toolbar, a KPI stat-card row, and the Performance
  // (equity curve) + Trading Calendar modules. Data comes from props (real metrics, wired by App.svelte
  // on all surfaces). Color lives only in the P&L.
  import { SlidersHorizontal, Plus, MoreHorizontal, Pencil, LayoutGrid, RotateCcw } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import * as Card from '$lib/components/ui/card';
  import * as Popover from '$lib/components/ui/popover';
  import * as Select from '$lib/components/ui/select';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import IconTip from '$lib/components/IconTip.svelte';
  import { ChevronUp, ChevronDown, EyeOff } from '@lucide/svelte';
  import { X, Trash2, CalendarClock } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { flip } from 'svelte/animate';
  import { fade, slide } from 'svelte/transition';
  import { MediaQuery } from 'svelte/reactivity';
  import { DASHBOARD_MODULES, DEFAULT_MODULE_KEYS, dashboardKit, type ModEntry } from '../lib/modlayout.ts';
  import { createSizeController, spanClass } from '../lib/modsize.svelte.ts';
  import ModuleSizeMenu from '../parts/ModuleSizeMenu.svelte';
  import ModuleResizeHandle from '../parts/ModuleResizeHandle.svelte';
  import { dur } from '../lib/motion.ts';
  import {
    usd,
    usdWhole,
    money,
    num,
    axMoney,
    niceTicks,
    linePath,
    minMax,
    monthCells,
    DOW_LABEL,
    rateFor,
    roundTurn,
    tierOf,
    exchOf,
    EXCH,
    BROKERS,
    BROKER_ORDER,
    currentDrawdown,
    currentStreak,
    streakRecords,
  } from '../../lib/core/core.ts';
  import * as Table from '$lib/components/ui/table';
  import type { DailyPoint } from '../../lib/core/curveseries.ts';
  import type { AppSetup, EconEvent } from '../../lib/core/types.ts';
  import CostSetup from '../parts/CostSetup.svelte';
  import StatCardRow, { type StatItem, type StatDetail } from '../parts/StatCardRow.svelte';
  import ActivityTerminal from '../parts/ActivityTerminal.svelte';
  import InfoTip from '../parts/InfoTip.svelte';
  import SegmentedControl from '../parts/SegmentedControl.svelte';
  import { type DayTrade } from './Calendar.svelte';

  interface Props {
    stats: DashStat[];
    series: DailyPoint[];
    dateRange: string;
    monthLabel: string;
    monthNet: number;
    dayPnl: Record<number, DayCell>;
    firstDow: number;
    daysInMonth: number;
    onscope?: (s: 'all' | 'month') => void;
    /** Click-a-day drill-in (parity with app/demo): the day's trades + its persistent journal note. */
    dayTrades: (day: number) => DayTrade[];
    getNote: (day: number) => string;
    /** The day's journal (context) tags — shown read-only in the drill-in; edited on the Calendar screen (A166). */
    getDayTags?: (day: number) => string[];
    onsavenote?: (day: number, text: string) => void;
    /** Click-a-KPI-card drill-in: the metric's breakdown (parity with the app/demo stat-card modal). */
    statDetail: (key: string) => StatDetail;
    /** Live filter model for the Filters popover (bound to the app's filter state). */
    filterModel: FilterModel;
    /** Clicking a curve point jumps the calendar cursor to that date's month (parity with app/demo). */
    onpickdate?: (year: number, month: number) => void;
    /** Break-even & Cost module rows (from costModel) and Advanced Statistics rows (from metrics). */
    costRows: { label: string; value: string; tone?: 'pos' | 'neg'; total?: boolean }[];
    /** Roots priced off the fallback per-side rate — rendered as the commissions asterisk footnote (A171). */
    estRoots?: string[];
    /** A208 dagger footnote — how many trades are priced at ACTUAL CSV commissions ('' = none). */
    actualCommNote?: string;
    advStats: { k: string; v: string; tone?: 'pos' | 'neg' }[];
    /** Cost setup (broker/feed/state/platform) that drives costModel; edited in the Break-even module. */
    setup: AppSetup;
    onsetupsave?: (s: AppSetup) => void;
    /** Disable the cost-setup inputs on demo (never mutates). */
    costDisabled?: boolean;
    /** A271: staging-gate the corner drag-resize handle (the ⋯ menu Size radio ships everywhere). */
    isStaging?: boolean;
    /** Visible dashboard modules — order + per-module size (A271; persisted to Store.local); defaults to all shown. */
    modules?: ModEntry[];
    onmoduleschange?: (mods: ModEntry[]) => void;
    /** F51: the compact Recent Trades module's rows (newest first, pre-capped by the app). */
    recentTrades?: { date: string; time: string; sym: string; side: 'Long' | 'Short'; qty: number; pnl: number; platform: string }[];
    /** F39/A142: full-fidelity batch-1 module data (Today · Drawdown · Streak). Optional — when the
     *  app doesn't wire it, the modules derive an equivalent day-level view-model from `series` +
     *  `recentTrades`, so they always render real numbers. */
    moduleData?: DashModuleData;
    /** Named workspace layout templates (R12 parity) — save/apply/delete/revert the module layout. */
    layouts?: {
      names: string[];
      canSave: boolean;
      save: (name: string) => void;
      apply: (name: string) => void;
      remove: (name: string) => void;
      revert: () => void;
    };
    /** Econ-event overlay (R14b): filtered resolved events for the cursor month, keyed by
     *  `YYYY-MM-DD`. Empty when the overlay is off or the dataset hasn't loaded — the module just
     *  shows no marks. The toggle lives on the full Calendar screen; the module honors the same
     *  persisted preference. */
    econMonth?: Map<string, EconEvent[]>;
    /** Maps a day-of-month number to its `YYYY-MM-DD` (to key into econMonth). */
    econDay?: (day: number) => string;
  }
  let {
    stats,
    series,
    dateRange,
    monthLabel,
    monthNet,
    dayPnl,
    firstDow,
    daysInMonth,
    onscope,
    dayTrades,
    getNote,
    getDayTags,
    onsavenote,
    statDetail,
    filterModel,
    onpickdate,
    costRows,
    estRoots = [],
    actualCommNote = '',
    advStats,
    setup,
    onsetupsave,
    costDisabled = false,
    isStaging = false,
    modules,
    onmoduleschange,
    recentTrades = [],
    moduleData,
    layouts,
    econMonth,
    econDay,
  }: Props = $props();

  // Econ overlay (R14b): per-cell resolved events (already impact-filtered upstream).
  const econForDay = (day: number): EconEvent[] => (econDay && econMonth ? (econMonth.get(econDay(day)) ?? []) : []);

  function doSaveLayout() {
    const name = typeof prompt === 'function' ? prompt('Save current layout as…') : null;
    if (name && name.trim()) layouts?.save(name.trim());
  }

  // ── F39/A142 batch-1 module data (Today · Drawdown Status · Streak Monitor) ──────────────────────
  // Prefer the app-wired per-trade `moduleData`; otherwise derive an equivalent DAY-level view-model
  // from the props we already have (`series` is the cumulative-gross equity curve = compute()'s
  // curve; `recentTrades` is the newest-first tail). Same shape either way, so the module snippets
  // don't care which source they got — the `unit`/`capped` flags keep the labels honest.
  function moduleDataFromProps(): DashModuleData | null {
    if (!series.length) return null;
    const grossCurve = [0, ...series.map(p => p.gross)]; // leading 0, like compute().curve
    const dayPnls = series.map((p, i) => p.gross - (i ? series[i - 1].gross : 0));
    const cd = currentDrawdown(grossCurve);
    // Record max drawdown over the SAME daily curve (so it reconciles with `cd`).
    let peak = grossCurve[0],
      maxDD = 0,
      ddPeakVal = 0,
      ddPeakI = 0,
      ddTroughI = 0,
      runPeakI = 0;
    for (let i = 1; i < grossCurve.length; i++) {
      if (grossCurve[i] > peak) {
        peak = grossCurve[i];
        runPeakI = i;
      }
      const dd = peak - grossCurve[i];
      if (dd > maxDD) {
        maxDD = dd;
        ddPeakVal = peak;
        ddPeakI = runPeakI;
        ddTroughI = i;
      }
    }
    const net = grossCurve[grossCurve.length - 1];
    const winDays = dayPnls.filter(p => p > 0).length;
    const last = series[series.length - 1];
    // The last active day's per-trade breakdown from the (capped) recent-trades window.
    const lastTrades = recentTrades.filter(t => t.date === last.date);
    const wins = lastTrades.filter(t => t.pnl > 0).length;
    const bw = lastTrades.reduce((a, t) => ({ best: Math.max(a.best, t.pnl), worst: Math.min(a.worst, t.pnl) }), {
      best: -Infinity,
      worst: Infinity,
    });
    // recentTrades is App-capped to 12 — flag a possible undercount only when the whole window is this day.
    const capped = recentTrades.length >= 12 && lastTrades.length === recentTrades.length;
    const dayRec = streakRecords(dayPnls);
    const chrono = recentTrades.map(t => t.pnl).reverse(); // newest-first → chronological
    const tradeRun = currentStreak(chrono);
    return {
      lastDay: {
        date: last.date,
        net: dayPnls[dayPnls.length - 1],
        trades: lastTrades.length,
        wins,
        winRate: lastTrades.length ? (100 * wins) / lastTrades.length : 0,
        best: lastTrades.length ? bw.best : 0,
        worst: lastTrades.length ? bw.worst : 0,
        capped,
      },
      avgDaily: net / series.length,
      avgTrades: null, // the series window can't count total trades — hide the baseline
      winDayPct: (100 * winDays) / series.length,
      activeDays: series.length,
      dd: {
        current: cd.dd,
        currentPct: cd.ddPct,
        sincePeak: cd.sincePeak,
        unit: 'day',
        maxDD,
        maxDDpct: ddPeakVal > 0 ? (maxDD / ddPeakVal) * 100 : maxDD > 0 ? null : 0,
        maxDDdur: maxDD > 0 ? ddTroughI - ddPeakI : 0,
        recovery: maxDD > 0 ? net / maxDD : net > 0 ? Infinity : NaN,
        atHigh: cd.atHigh,
      },
      streak: {
        trade: { ...tradeRun, capped: tradeRun.len === chrono.length && chrono.length >= 12 },
        day: currentStreak(dayPnls),
        rec: dayRec, // fallback yardstick is the per-day record (per-trade records need the app wire)
        recUnit: 'day',
        dayRec,
      },
    };
  }
  const md = $derived<DashModuleData | null>(moduleData ?? moduleDataFromProps());
  // Streak run → tone (win green / loss red / flat|none muted) and plain-language verb, shared by the render.
  const runTone = (k: 'win' | 'loss' | 'flat' | 'none'): 'pos' | 'neg' | undefined =>
    k === 'win' ? 'pos' : k === 'loss' ? 'neg' : undefined;
  const runVerb = (k: 'win' | 'loss' | 'flat' | 'none') => (k === 'win' ? 'winning' : k === 'loss' ? 'losing' : 'scratch');

  // A200/A241: the perf chart still reads this to trim its gutters below Tailwind's sm breakpoint.
  const isNarrow = new MediaQuery('(max-width: 639px)');

  // A238: the KPI cards — their mobile carousel + click-through drill-in — now live in the shared
  // StatCardRow part (adopted by Analytics too). Map the app's DashStat shape onto the part's StatItem
  // (`up` → the value/badge tone; every seeded stat carries a key).
  const dashStats = $derived<StatItem[]>(
    stats.map(s => ({
      key: s.key ?? s.label,
      label: s.label,
      value: s.value,
      tone: s.up === undefined ? undefined : s.up ? 'pos' : 'neg',
      badge: s.badge,
      badgeUp: s.up,
      note: s.note,
    }))
  );

  // ── Module layout (hide / reorder / re-add — parity with app/demo, persisted to Store.local) ────
  // A320: the key + label table is single-sourced in modlayout.ts (DASHBOARD_MODULES) so the
  // migration key set and the rendered labels can't drift apart.
  const MODULES = DASHBOARD_MODULES;
  // A271: the half-width-vs-full pairing that used to live here is now the module SIZE (md vs lg) — the
  // default-size mapping (paired → md, others → lg) lives in modlayout.defaultSizeFor, which preserves
  // this exact layout on upgrade. The render spans per size (spanClass) instead of a PAIRED set.
  const validKeys = (ks?: string[]) => (ks ?? DEFAULT_MODULE_KEYS).filter(k => MODULES.some(m => m.key === k));
  // A271/A319: reorder/hide/add stays keyed on `modOrder` (a plain string[]) — untouched — while the
  // per-module SIZE map + the drag/keyboard resize paths live in the SHARED size controller
  // (createSizeController — one home for Dashboard + Analytics). The persisted/emitted layout is the
  // two recombined into ModEntry[] by the controller's emitCurrent().
  const keysOfProp = (m?: ModEntry[]) => validKeys(m?.map(e => e.key));
  // A271/A272: Large modules that benefit from filling the viewport get extra height (the perf equity
  // curve + the trading calendar); others just widen. Class-based (no inline style — CSP/A55).
  // A317: keyed on the PREVIEW size so the fill tracks the live drag, not just the committed size.
  const FILL_AT_LARGE = new Set(['perf', 'cal']);
  const fillClass = (key: string): string => (sizeCtl.previewSize(key) === 'lg' && FILL_AT_LARGE.has(key) ? 'lg:min-h-[65vh]' : '');
  // svelte-ignore state_referenced_locally — initial layout only; the app re-seeds via the prop below.
  let modOrder = $state<string[]>(keysOfProp(modules));
  let gridEl = $state<HTMLElement>();
  // svelte-ignore state_referenced_locally
  const sizeCtl = createSizeController(dashboardKit, {
    initial: modules,
    order: () => modOrder,
    emit: mods => onmoduleschange?.(mods),
    grid: () => gridEl,
    narrow: () => isNarrow.current,
  });
  $effect(() => {
    // Re-seed from the prop when the app supplies a persisted layout (e.g. on first load after boot).
    if (sizeCtl.reseed(modules)) modOrder = keysOfProp(modules);
  });
  const hiddenModules = $derived(MODULES.filter(m => !modOrder.includes(m.key)));
  const moduleLabel = (key: string) => MODULES.find(m => m.key === key)?.label ?? key;
  function commitModules(order: string[]) {
    modOrder = order;
    sizeCtl.emitCurrent();
  }
  function moveModule(key: string, dir: -1 | 1) {
    const i = modOrder.indexOf(key),
      j = i + dir;
    if (i < 0 || j < 0 || j >= modOrder.length) return;
    const next = [...modOrder];
    [next[i], next[j]] = [next[j], next[i]];
    commitModules(next);
  }
  const hideModule = (key: string) => commitModules(modOrder.filter(k => k !== key));

  // ── A203 Commission Compare: per-broker all-in cost for a chosen root, straight from the same
  // rateFor/roundTurn math costModel uses, so the numbers reconcile with the cost module. The
  // exchange/clearing/NFA fee is identical across brokers — only the commission differs. ──
  const compareRoots = Object.keys(EXCH).sort(); // ref data is loaded before the app renders
  let compareRoot = $state('ES');
  let compareRT = $state(40); // round turns / month for the monthly-cost column
  let compareSort = $state<'cost' | 'name'>('cost');
  const compareRows = $derived.by(() => {
    const tier = tierOf(compareRoot);
    const exch = exchOf(compareRoot, tier);
    // A226: paper/sim brokers charge nothing real — ranking them against live brokers is
    // meaningless, so the data-driven `paper` flag excludes them here (cost setup keeps them).
    const rows = BROKER_ORDER.filter(k => !BROKERS[k]?.paper).map(k => {
      const { rate, known } = rateFor(k, compareRoot);
      return { key: k, name: BROKERS[k]?.name ?? k, comm: rate - exch, rate, rt: roundTurn(rate), known };
    });
    rows.sort((a, b) => (compareSort === 'name' ? a.name.localeCompare(b.name) : a.rt - b.rt || a.name.localeCompare(b.name)));
    return { rows, exch, tier, cheapest: Math.min(...rows.map(r => r.rt)) };
  });

  // A189: the illustrated multi-select add-modules picker (the always-visible '+' opens it).
  let pickerOpen = $state(false);
  let pickerSel = $state<string[]>([]);
  function togglePick(key: string) {
    pickerSel = pickerSel.includes(key) ? pickerSel.filter(k => k !== key) : [...pickerSel, key];
  }
  function addPicked() {
    if (pickerSel.length) commitModules([...modOrder, ...pickerSel.filter(k => !modOrder.includes(k))]);
    pickerSel = [];
    pickerOpen = false;
  }

  // ── Filters ──────────────────────────────────────────────────────────────────────────────────
  const DOW_OPTS = [
    { d: 1, label: 'Mon' },
    { d: 2, label: 'Tue' },
    { d: 3, label: 'Wed' },
    { d: 4, label: 'Thu' },
    { d: 5, label: 'Fri' },
  ];
  const filtersActive = $derived(
    !!(
      filterModel.root ||
      filterModel.side ||
      filterModel.session ||
      filterModel.tag ||
      filterModel.from ||
      filterModel.to ||
      filterModel.dows.length
    )
  );
  const sideLabel = $derived(filterModel.side === 'long' ? 'Long' : filterModel.side === 'short' ? 'Short' : 'All sides');
  const sessLabel = $derived(filterModel.session === 'rth' ? 'RTH' : filterModel.session === 'eth' ? 'ETH' : 'All sessions');
  const rootLabel = $derived(filterModel.root || 'All symbols');
  const tagLabel = $derived(filterModel.tag || 'All tags');
  const toggleDow = (d: number) =>
    filterModel.set({ dows: filterModel.dows.includes(d) ? filterModel.dows.filter(x => x !== d) : [...filterModel.dows, d] });
  // Saved filter views (A49 parity)
  let newViewName = $state('');
  const savedViews = $derived(filterModel.views ?? []);
  const canSaveView = $derived(!!filterModel.canSaveView && !!filterModel.saveView);
  function doSaveView() {
    if (!canSaveView) return;
    filterModel.saveView?.(newViewName);
    newViewName = '';
  }
  function doRenameView(id: string, current: string) {
    const name = typeof prompt === 'function' ? prompt('Rename filter', current) : null;
    if (name && name.trim()) filterModel.renameView?.(id, name.trim());
  }

  let scope = $state<'all' | 'month'>('all');
  const setScope = (s: 'all' | 'month') => {
    scope = s;
    onscope?.(s);
  };

  const cells = $derived(monthCells(firstDow, daysInMonth));

  // ── Calendar day drill-in ────────────────────────────────────────────────────────────────────
  let selectedDay = $state<number | null>(null);
  let note = $state('');
  // Load the day's note whenever the selection (or the underlying journal) changes.
  $effect(() => {
    note = selectedDay ? getNote(selectedDay) : '';
  });
  const selTrades = $derived(selectedDay ? dayTrades(selectedDay) : []);
  const selEcon = $derived(selectedDay ? econForDay(selectedDay) : []); // R14b — selected day's econ events
  const pickDay = (day: number) => (selectedDay = selectedDay === day ? null : day);
  const monthWord = $derived(monthLabel.split(' ')[0]);

  // ── Performance curve ──────────────────────────────────────────────────────────────────────────
  // The Gross/Net/Take-home toggle switches the primary cumulative series (parity with app/demo — the
  // series is cost/tax-adjusted upstream via dailySeries). The chart draws framed $ y-ticks, x-date
  // labels, an end-of-line value, and a hover/keyboard cursor with a live daily-value readout.
  type SKey = 'gross' | 'net' | 'take';
  const SERIES: { key: SKey; label: string; stroke: string; fill: string; grad: string }[] = [
    { key: 'gross', label: 'Gross', stroke: 'stroke-chart-2', fill: 'fill-chart-2', grad: 'perfGross' },
    { key: 'net', label: 'Net', stroke: 'stroke-primary', fill: 'fill-primary', grad: 'perfNet' },
    { key: 'take', label: 'Take-home', stroke: 'stroke-chart-3', fill: 'fill-chart-3', grad: 'perfTake' },
  ];
  // Overlays are MULTI-select (parity with app/demo): any combination of the series can be drawn at
  // once, keeping at least one on. Gross is on by default.
  let enabled = $state<Record<SKey, boolean>>({ gross: true, net: false, take: false });
  const enabledList = $derived(SERIES.filter(s => enabled[s.key])); // SERIES order; ≥1 (see toggle)
  function toggleSeries(key: SKey) {
    const on = SERIES.filter(s => enabled[s.key]);
    if (enabled[key] && on.length === 1) return; // keep at least one series visible
    enabled = { ...enabled, [key]: !enabled[key] };
  }
  let cursor = $state<number | null>(null);
  let cw = $state(0); // measured plot width (px) → viewBox width, so labels/dots aren't stretched
  const VH = 256; // = the SVG's CSS height (h-64 = 16rem = 256px)
  // A241: below sm, trim the axis gutters so the plot fills the card, and match the viewBox width to
  // the measured CSS width (W = cw) so the viewBox aspect === the box aspect — no 'meet' letterbox
  // (the old 560px floor letterboxed the curve on phones, shrinking every label with it), and axis
  // text renders ~1:1 instead of scaled down to ~6px. Fewer, larger ticks fit the narrow plot.
  const PAD = $derived(isNarrow.current ? { l: 38, r: 44, t: 10, b: 20 } : { l: 48, r: 72, t: 12, b: 22 });
  const W = $derived(cw > 0 ? cw : isNarrow.current ? 340 : 900);

  const view = $derived.by(() => {
    if (!series.length) return null;
    const narrow = isNarrow.current;
    const on = enabledList.length ? enabledList : [SERIES[0]];
    const pts: DailyPoint[] = [{ date: '', gross: 0, net: 0, take: 0 }, ...series];
    let { lo, hi } = minMax(on.flatMap(s => pts.map(p => p[s.key])));
    const ticks = niceTicks(lo, hi, narrow ? 3 : 4);
    lo = Math.min(lo, ticks[0]);
    hi = Math.max(hi, ticks[ticks.length - 1]);
    const span = hi - lo || 1;
    const x = (i: number) => PAD.l + (i / (pts.length - 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / span) * (VH - PAD.t - PAD.b);
    const baseY = (VH - PAD.b).toFixed(1);
    const xN = x(pts.length - 1).toFixed(1),
      x0 = x(0).toFixed(1);
    const lines = on.map(s => {
      const d = linePath(
        pts.map(p => p[s.key]),
        x,
        y
      );
      return { ...s, d, area: `${d} L${xN},${baseY} L${x0},${baseY} Z` };
    });
    const yticks = ticks.map(v => ({ y: y(v), label: axMoney(v) }));
    const xticks: { x: number; label: string }[] = [];
    const seen = new Set<string>();
    const xtN = narrow ? 2 : 4; // fewer date labels on a phone so they don't collide
    for (let k = 0; k <= xtN; k++) {
      const i = Math.min(pts.length - 1, 1 + Math.round(((pts.length - 2) * k) / xtN));
      const dt = pts[i]?.date;
      if (dt && !seen.has(dt)) {
        seen.add(dt);
        xticks.push({ x: x(i), label: dt.slice(5).replace('-', '/') });
      }
    }
    const last = pts[pts.length - 1];
    // End-of-line value labels, nudged apart so overlapping series (gross/net/take end close) stay legible.
    const ends = on.map(s => ({ key: s.key, fill: s.fill, y: y(last[s.key]), label: usdWhole(last[s.key]) })).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
    return { pts, x, y, len: pts.length, lines, yticks, xticks, ends, zeroY: lo <= 0 && hi >= 0 ? y(0) : null };
  });
  const tip = $derived(
    view && cursor != null && view.pts[cursor]?.date
      ? `${view.pts[cursor].date} · ${enabledList.map(s => `${s.label} ${usd(view.pts[cursor as number][s.key])}`).join(' · ')}`
      : ''
  );

  function idxFromX(e: MouseEvent) {
    const v = view;
    if (!v) return null;
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const vbx = ((e.clientX - rect.left) / rect.width) * W;
    return Math.max(1, Math.min(v.len - 1, Math.round(((vbx - PAD.l) / (W - PAD.l - PAD.r)) * (v.len - 1))));
  }
  const moveCursor = (e: MouseEvent) => (cursor = idxFromX(e));
  function onCurveKey(e: KeyboardEvent) {
    if (!view) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pickCurveDate(cursor); // jump the calendar to the cursor's day
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const base = cursor == null ? view.len - 1 : cursor;
    cursor = Math.max(1, Math.min(view.len - 1, base + (e.key === 'ArrowRight' ? 1 : -1)));
  }
  // Clicking (or pressing Enter on) a curve point jumps the Trading Calendar to that day.
  function pickCurveDate(idx: number | null) {
    if (!view || idx == null) return;
    const date = view.pts[idx]?.date;
    if (!date) return;
    const [y, m, d] = date.split('-').map(Number);
    onpickdate?.(y, m - 1); // move the calendar cursor to that date's month
    selectedDay = d; // select the day so its detail opens
    // If the calendar module is visible, scroll it into view.
    requestAnimationFrame(() => document.getElementById('dashmod-cal')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }
  const onCurveClick = (e: MouseEvent) => pickCurveDate(idxFromX(e));
</script>

{#snippet moduleHeader(key: string)}
  <!-- A287: no drag grip here — module reorder is via the ⋯ menu (Move up / Move down). A GripVertical
       icon used to sit here but the wrapper has no drag handlers, so it was a dead affordance. -->
  <div class="flex items-center gap-2 border-b border-border px-4 py-2.5">
    <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{moduleLabel(key)}</span>
    <DropdownMenu.Root>
      <!-- A205: tooltip composed onto the menu trigger (tooltip child props → DropdownMenu.Trigger). -->
      <IconTip label="Module options">
        {#snippet button(tip)}
          <DropdownMenu.Trigger {...tip}>
            {#snippet child({ props })}
              <button
                {...props}
                type="button"
                class="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Module menu"
              >
                <MoreHorizontal class="size-4" />
              </button>
            {/snippet}
          </DropdownMenu.Trigger>
        {/snippet}
      </IconTip>
      <DropdownMenu.Content align="end" class="min-w-[150px]">
        <DropdownMenu.Item disabled={modOrder.indexOf(key) === 0} onSelect={() => moveModule(key, -1)}
          ><ChevronUp class="size-4" /> Move up</DropdownMenu.Item
        >
        <DropdownMenu.Item disabled={modOrder.indexOf(key) === modOrder.length - 1} onSelect={() => moveModule(key, 1)}
          ><ChevronDown class="size-4" /> Move down</DropdownMenu.Item
        >
        <DropdownMenu.Separator />
        <!-- A271/A319: per-module size — the shared Size radio group (the discoverable, keyboard-
             friendly path; the corner drag handle is the pointer path). Stages behind the DashTabs
             dirty asterisk like reorder/hide. -->
        <ModuleSizeMenu ctl={sizeCtl} modKey={key} />
        <DropdownMenu.Separator />
        <DropdownMenu.Item onSelect={() => hideModule(key)}><EyeOff class="size-4" /> Hide module</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </div>
{/snippet}

<!-- Multi-select overlay toggle button (the single-select toolbar pills are the shared SegmentedControl). -->
{#snippet segBtn(active: boolean, label: string, onclick: () => void)}
  <button
    type="button"
    {onclick}
    class={[
      'rounded px-2.5 py-1 text-xs transition-colors',
      active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
    ]}
  >
    {label}
  </button>
{/snippet}

<div class="flex flex-col gap-5">
  <!-- Toolbar -->
  <div class="flex flex-wrap items-center gap-3">
    <SegmentedControl
      segments={[
        { key: 'all', label: 'All time' },
        { key: 'month', label: 'This month' },
      ]}
      value={scope}
      onselect={k => setScope(k as 'all' | 'month')}
    />
    <Popover.Root>
      <Popover.Trigger>
        {#snippet child({ props })}
          <Button {...props} variant="outline" size="sm">
            <SlidersHorizontal class="size-4" /> Filters
            {#if filtersActive}<span class="ml-1 size-1.5 rounded-full bg-primary" title="Filters active"></span>{/if}
          </Button>
        {/snippet}
      </Popover.Trigger>
      <Popover.Content align="start" class="w-72 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Filters</span>
          <span class="text-[11px] text-muted-foreground">{filterModel.count.toLocaleString()} trades</span>
        </div>

        <div class="grid gap-1.5">
          <Label class="text-[11px]">Symbol</Label>
          <Select.Root type="single" value={filterModel.root} onValueChange={v => filterModel.set({ root: v === '__all' ? '' : v })}>
            <Select.Trigger class="h-8">{rootLabel}</Select.Trigger>
            <Select.Content>
              <Select.Item value="__all">All symbols</Select.Item>
              {#each filterModel.roots as r (r)}<Select.Item value={r}>{r}</Select.Item>{/each}
            </Select.Content>
          </Select.Root>
        </div>

        {#if filterModel.tags.length}
          <div class="grid gap-1.5">
            <Label class="text-[11px]">Tag</Label>
            <Select.Root type="single" value={filterModel.tag} onValueChange={v => filterModel.set({ tag: v === '__all' ? '' : v })}>
              <Select.Trigger class="h-8">{tagLabel}</Select.Trigger>
              <Select.Content>
                <Select.Item value="__all">All tags</Select.Item>
                {#each filterModel.tags as t (t)}<Select.Item value={t}>{t}</Select.Item>{/each}
              </Select.Content>
            </Select.Root>
          </div>
        {/if}

        <div class="grid grid-cols-2 gap-2">
          <div class="grid gap-1.5">
            <Label class="text-[11px]">Side</Label>
            <Select.Root
              type="single"
              value={filterModel.side || '__all'}
              onValueChange={v => filterModel.set({ side: v === '__all' ? '' : v })}
            >
              <Select.Trigger class="h-8">{sideLabel}</Select.Trigger>
              <Select.Content>
                <Select.Item value="__all">All sides</Select.Item>
                <Select.Item value="long">Long</Select.Item>
                <Select.Item value="short">Short</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>
          <div class="grid gap-1.5">
            <Label class="text-[11px]">Session</Label>
            <Select.Root
              type="single"
              value={filterModel.session || '__all'}
              onValueChange={v => filterModel.set({ session: v === '__all' ? '' : v })}
            >
              <Select.Trigger class="h-8">{sessLabel}</Select.Trigger>
              <Select.Content>
                <Select.Item value="__all">All sessions</Select.Item>
                <Select.Item value="rth">RTH</Select.Item>
                <Select.Item value="eth">ETH</Select.Item>
              </Select.Content>
            </Select.Root>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2">
          <div class="grid gap-1.5">
            <Label class="text-[11px]" for="f-from">From</Label>
            <Input
              id="f-from"
              type="date"
              value={filterModel.from}
              class="h-8"
              onchange={e => filterModel.set({ from: e.currentTarget.value })}
            />
          </div>
          <div class="grid gap-1.5">
            <Label class="text-[11px]" for="f-to">To</Label>
            <Input
              id="f-to"
              type="date"
              value={filterModel.to}
              class="h-8"
              onchange={e => filterModel.set({ to: e.currentTarget.value })}
            />
          </div>
        </div>

        <div class="grid gap-1.5">
          <Label class="text-[11px]">Weekday</Label>
          <div class="flex gap-1">
            {#each DOW_OPTS as o (o.d)}
              <button
                type="button"
                onclick={() => toggleDow(o.d)}
                class={[
                  'flex-1 rounded border px-1.5 py-1 text-[11px] transition-colors',
                  filterModel.dows.includes(o.d)
                    ? 'border-border bg-secondary text-foreground'
                    : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground',
                ]}
              >
                {o.label}
              </button>
            {/each}
          </div>
        </div>

        {#if canSaveView || savedViews.length}
          <div class="grid gap-1.5 border-t border-border pt-2">
            <Label class="text-[11px]">Saved filters</Label>
            {#each savedViews as v (v.id)}
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="flex-1 truncate rounded border border-border px-2 py-1 text-left text-[11px] text-foreground hover:bg-accent"
                  onclick={() => filterModel.applyView?.(v.id)}
                >
                  {v.name}
                </button>
                {#if canSaveView}
                  <IconTip label="Rename filter">
                    {#snippet button(tip)}
                      <button
                        {...tip}
                        type="button"
                        aria-label="Rename filter"
                        class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:size-8"
                        onclick={() => doRenameView(v.id, v.name)}
                      >
                        <Pencil class="size-3.5" />
                      </button>
                    {/snippet}
                  </IconTip>
                  <IconTip label="Delete filter">
                    {#snippet button(tip)}
                      <button
                        {...tip}
                        type="button"
                        aria-label="Delete filter"
                        class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-destructive pointer-coarse:size-8"
                        onclick={() => filterModel.deleteView?.(v.id)}
                      >
                        <!-- A222: Trash2 (not X) — the close-tab/dismiss family uses X, so a
                             destructive delete needs its own icon on touch where the tooltip never
                             fires (bits-ui Tooltip ignores pointerType === 'touch'). -->
                        <Trash2 class="size-3.5" />
                      </button>
                    {/snippet}
                  </IconTip>
                {/if}
              </div>
            {/each}
            {#if canSaveView}
              <div class="flex items-center gap-1">
                <Input
                  bind:value={newViewName}
                  placeholder="Name this filter…"
                  class="h-8 flex-1"
                  disabled={!filtersActive}
                  onkeydown={e => e.key === 'Enter' && doSaveView()}
                />
                <Button variant="secondary" size="sm" class="h-8" disabled={!filtersActive || !newViewName.trim()} onclick={doSaveView}
                  >Save</Button
                >
              </div>
            {/if}
          </div>
        {/if}

        <div class="flex justify-end pt-1">
          <Button variant="ghost" size="sm" class="h-7" disabled={!filtersActive} onclick={() => filterModel.clear()}>Clear all</Button>
        </div>
      </Popover.Content>
    </Popover.Root>
    {#if layouts}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <Button {...props} variant="outline" size="sm"><LayoutGrid class="size-4" /> Layouts</Button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" class="min-w-[200px]">
          {#if layouts.names.length}
            {#each layouts.names as name (name)}
              <div class="flex items-center">
                <DropdownMenu.Item class="flex-1" onSelect={() => layouts.apply(name)}>{name}</DropdownMenu.Item>
                {#if layouts.canSave}
                  <IconTip label="Delete layout">
                    {#snippet button(tip)}
                      <button
                        {...tip}
                        type="button"
                        aria-label="Delete layout"
                        class="mr-1 grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-destructive pointer-coarse:size-8"
                        onclick={e => {
                          e.stopPropagation();
                          layouts.remove(name);
                        }}
                      >
                        <Trash2 class="size-3.5" />
                      </button>
                    {/snippet}
                  </IconTip>
                {/if}
              </div>
            {/each}
            <DropdownMenu.Separator />
          {/if}
          {#if layouts.canSave}
            <DropdownMenu.Item onSelect={doSaveLayout}><Plus class="size-4" /> Save current layout…</DropdownMenu.Item>
          {/if}
          <DropdownMenu.Item onSelect={() => layouts.revert()}><RotateCcw class="size-4" /> Reset to default</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
    <span class="ml-auto text-xs text-muted-foreground">{dateRange}</span>
  </div>

  <!-- KPI stat cards — click a card to drill into its breakdown (parity with app/demo). -->
  <!-- A242: the parsing caveats that used to live in the standalone Definitions module now sit as
       contextual "what is this?" popovers next to the numbers they qualify — click a KPI to drill
       in, or these for how the figures are read. -->
  <div class="-mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
    <span class="uppercase tracking-wider">Key stats</span>
    <InfoTip title="How a trade is counted" align="start">
      Each trade is one realized-P&amp;L event. Depending on the platform Blotterbook auto-detects, that's either one row per closed
      position (close-event exports like TradingView) or entry/exit fills paired into round-trips by a FIFO matcher (which also recovers
      hold time). A fill that closes lots opened at different times books one trade per matched lot, so the trade count can exceed your
      platform's order count; positions still open at the end of a fills export aren't imported. TradingView is verified; the other adapters
      are beta — verify the parsed numbers against your statement.
    </InfoTip>
    <InfoTip title="Dates &amp; time zones" align="start">
      Timestamps are read as written, in the export's own clock — no timezone conversion. Dates parse as US M/D/Y; an unambiguous day &gt;
      12 (e.g. 25/06) is auto-detected as D/M/Y, but ambiguous non-US dates can land on the wrong day. Session (RTH/ETH) classification
      assumes US Eastern time. Export in a US/ET format, or verify the parsed dates before trusting day/week/month grouping. Sharpe uses
      daily-P&amp;L dispersion and is not annualized; small per-weekday samples are noisy.
    </InfoTip>
  </div>
  <!-- A238/A200: the shared StatCardRow owns the card grid, the narrow-viewport carousel, and the
       click-through stat-detail Dialog (Analytics adopts the same part). -->
  <StatCardRow stats={dashStats} label="Key stats" detail={statDetail} />

  {#snippet perfBody()}
    <div class="mb-3 flex w-fit items-center gap-0.5 rounded-md border border-border p-0.5">
      {#each SERIES as s (s.key)}
        {@render segBtn(enabled[s.key], s.label, () => toggleSeries(s.key))}
      {/each}
    </div>
    <div bind:clientWidth={cw}>
      {#if view}
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
        <svg
          viewBox="0 0 {W} {VH}"
          class="h-64 w-full cursor-pointer touch-none outline-none"
          role="img"
          aria-label="Cumulative P&L curve — click a point to open that day in the calendar"
          tabindex="0"
          onpointermove={moveCursor}
          onpointerleave={() => (cursor = null)}
          onclick={onCurveClick}
          onkeydown={onCurveKey}
        >
          <defs>
            <linearGradient id="perfGross" x1="0" y1="0" x2="0" y2="1"
              ><stop offset="0%" class="[stop-color:var(--chart-2)] [stop-opacity:0.24]" /><stop
                offset="100%"
                class="[stop-color:var(--chart-2)] [stop-opacity:0]"
              /></linearGradient
            >
            <linearGradient id="perfNet" x1="0" y1="0" x2="0" y2="1"
              ><stop offset="0%" class="[stop-color:var(--primary)] [stop-opacity:0.2]" /><stop
                offset="100%"
                class="[stop-color:var(--primary)] [stop-opacity:0]"
              /></linearGradient
            >
            <linearGradient id="perfTake" x1="0" y1="0" x2="0" y2="1"
              ><stop offset="0%" class="[stop-color:var(--chart-3)] [stop-opacity:0.24]" /><stop
                offset="100%"
                class="[stop-color:var(--chart-3)] [stop-opacity:0]"
              /></linearGradient
            >
          </defs>
          {#each view.yticks as t, i (i)}
            <line x1={PAD.l} y1={t.y} x2={W - PAD.r} y2={t.y} class="stroke-border" stroke-width="1" vector-effect="non-scaling-stroke" />
            <text x={PAD.l - 6} y={t.y + 3.5} text-anchor="end" class="fill-muted-foreground text-[11px] tabular-nums">{t.label}</text>
          {/each}
          {#if view.zeroY != null}
            <line
              x1={PAD.l}
              y1={view.zeroY}
              x2={W - PAD.r}
              y2={view.zeroY}
              class="stroke-muted-foreground/50"
              stroke-width="1"
              vector-effect="non-scaling-stroke"
            />
          {/if}
          {#each view.xticks as t, i (i)}
            <!-- A241: 11px on phones (viewBox is now 1:1 with the box, so px map through directly) -->
            <text
              x={t.x}
              y={VH - 6}
              text-anchor="middle"
              class={['fill-muted-foreground tabular-nums', isNarrow.current ? 'text-[11px]' : 'text-[10px]']}>{t.label}</text
            >
          {/each}
          {#each view.lines as ln (ln.key)}
            <path d={ln.area} fill="url(#{ln.grad})" />
          {/each}
          {#each view.lines as ln (ln.key)}
            <path d={ln.d} fill="none" class={ln.stroke} stroke-width="2" vector-effect="non-scaling-stroke" />
          {/each}
          {#each view.ends as e (e.key)}
            <text x={W - PAD.r + 5} y={e.y + 3.5} text-anchor="start" class={['text-[11px] font-medium tabular-nums', e.fill]}
              >{e.label}</text
            >
          {/each}
          {#if cursor != null}
            <line
              x1={view.x(cursor)}
              y1={PAD.t}
              x2={view.x(cursor)}
              y2={VH - PAD.b}
              class="stroke-muted-foreground"
              stroke-width="1"
              stroke-dasharray="3 3"
              vector-effect="non-scaling-stroke"
            />
            {#each view.lines as ln (ln.key)}
              <circle
                cx={view.x(cursor)}
                cy={view.y(view.pts[cursor][ln.key])}
                r="3.5"
                class={[ln.stroke, ln.fill]}
                vector-effect="non-scaling-stroke"
              />
            {/each}
          {/if}
        </svg>
        <div class="mt-1 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {tip || 'Hover or arrow-key the curve for daily cumulative P&L'}
        </div>
      {:else}
        <p class="grid h-64 place-items-center text-sm text-muted-foreground">No trades in the selected range.</p>
      {/if}
    </div>
  {/snippet}

  {#snippet calBody()}
    <div class="mb-3 flex items-center justify-between">
      <span class="text-sm font-medium text-foreground">{monthLabel}</span>
      <span class={['text-sm tabular-nums', monthNet >= 0 ? 'text-chart-2' : 'text-destructive']}>{usdWhole(monthNet)}</span>
    </div>
    <!-- A182: minmax(0,1fr) columns + min-w-0/overflow-hidden cells — content can never widen the
         grid past its container (the mobile right-edge clip); cells are square on mobile, and the
         P&L figure truncates instead of escaping the border (full precision in the drill-in). -->
    <div class="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 sm:gap-1.5">
      {#each DOW_LABEL as d (d)}
        <div class="pb-1 text-center text-[11px] text-muted-foreground">{d}</div>
      {/each}
      {#each cells as day, i (i)}
        {#if day === null}
          <div></div>
        {:else}
          {@const t = dayPnl[day]}
          {@const up = t && t.pnl >= 0}
          {@const evs = econForDay(day)}
          <button
            type="button"
            data-testid="cal-day"
            onclick={() => (t || evs.length) && pickDay(day)}
            disabled={!t && !evs.length}
            class={[
              // A232: the cells grow on desktop so the month grid fills the module's vertical room
              // instead of squishing (A182's bounded mobile cells are unchanged below sm).
              'relative aspect-square min-w-0 overflow-hidden rounded-md border p-1 text-left transition-colors sm:aspect-auto sm:min-h-16 sm:p-1.5 lg:min-h-[5.5rem] xl:min-h-24',
              t
                ? up
                  ? 'border-chart-2/30 bg-chart-2/10'
                  : 'border-destructive/30 bg-destructive/10'
                : evs.length
                  ? 'border-border'
                  : 'cursor-default border-border',
              selectedDay === day && 'ring-2 ring-primary',
            ]}
          >
            <span class="flex items-center gap-1 text-[11px] text-muted-foreground">
              {day}{#if getNote(day)}<span class="size-1.5 rounded-full bg-primary" title="Has a note"></span>{/if}
            </span>
            <!-- Econ marks (R14b): bottom-left, chart-4 for high / muted for medium; max 2 + a +n. -->
            {#if evs.length}
              <span
                data-testid="econ-mark"
                class="absolute bottom-1 left-1 flex items-center gap-0.5"
                title={`Economic events: ${evs.map(e => `${e.et} ${e.label}`).join(' · ')}`}
              >
                {#each evs.slice(0, 2) as e (e.type + e.et)}
                  <span class={['size-1.5 rounded-full', e.impact === 'high' ? 'bg-chart-4' : 'bg-muted-foreground']}></span>
                {/each}
                {#if evs.length > 2}<span class="text-[9px] leading-none text-muted-foreground">+{evs.length - 2}</span>{/if}
              </span>
            {/if}
            {#if t}
              <div
                class={[
                  'mt-1 truncate text-right text-[10px] font-medium tabular-nums sm:text-xs',
                  up ? 'text-chart-2' : 'text-destructive',
                ]}
              >
                {usdWhole(t.pnl)}
              </div>
              <div class="hidden text-right text-[10px] text-muted-foreground sm:block">{t.tr} tr</div>
            {/if}
          </button>
        {/if}
      {/each}
    </div>

    <!-- Selected-day detail: the day's trades + its journal note (parity with app/demo). Now also
         opens for an econ-only day (R14b) — a day with a release but no trades. -->
    {#if selectedDay && (dayPnl[selectedDay] || selEcon.length)}
      {@const t = dayPnl[selectedDay]}
      <div class="mt-4 rounded-md border border-border bg-background p-4" transition:slide={{ duration: dur(150) }}>
        <div class="mb-3 flex items-center justify-between">
          <span class="text-sm font-semibold text-foreground">
            {monthWord}
            {selectedDay}
            {#if t}
              <span class={['ml-2 tabular-nums', t.pnl >= 0 ? 'text-chart-2' : 'text-destructive']}>{usdWhole(t.pnl)}</span>
              <span class="ml-2 text-xs font-normal text-muted-foreground">{t.tr} {t.tr === 1 ? 'trade' : 'trades'}</span>
            {/if}
          </span>
          <button
            type="button"
            class="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close day detail"
            onclick={() => (selectedDay = null)}
          >
            <X class="size-4" />
          </button>
        </div>
        <!-- Economic events (R14b): time ET · label · impact. -->
        {#if selEcon.length}
          <div class="mb-4">
            <div class="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              <CalendarClock class="size-3" /> Economic events
            </div>
            <div class="overflow-hidden rounded-md border border-border">
              {#each selEcon as e, i (e.type + e.et)}
                <div class={['flex items-center gap-2 px-2.5 py-1.5 text-xs', i > 0 && 'border-t border-border']}>
                  <span class="tabular-nums text-muted-foreground">{e.et}</span>
                  <span class="min-w-0 flex-1 truncate font-medium">{e.label}</span>
                  <Badge
                    variant="outline"
                    class={e.impact === 'high' ? 'border-chart-4/40 text-chart-4' : 'border-border text-muted-foreground'}
                    >{e.impact === 'high' ? 'High' : 'Med'}</Badge
                  >
                </div>
              {/each}
            </div>
          </div>
        {/if}
        <div class="grid gap-4 lg:grid-cols-2">
          <div class="overflow-hidden rounded-md border border-border">
            {#each selTrades as tr, i (i)}
              <div class={['flex items-center gap-2 px-2.5 py-1.5 text-xs', i > 0 && 'border-t border-border']}>
                <span class="tabular-nums text-muted-foreground">{tr.time || '—'}</span>
                <span class="font-medium">{tr.sym}</span>
                <Badge
                  variant="outline"
                  class={tr.side === 'Long' ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}>{tr.side}</Badge
                >
                <span class="text-muted-foreground">×{tr.qty}</span>
                <span class={['ml-auto font-semibold tabular-nums', tr.pnl >= 0 ? 'text-chart-2' : 'text-destructive']}
                  >{usdWhole(tr.pnl)}</span
                >
              </div>
            {:else}
              <div class="px-2.5 py-3 text-center text-xs text-muted-foreground">No intraday trades recorded.</div>
            {/each}
          </div>
          <div>
            <div class="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Journal note</div>
            {#if getDayTags && selectedDay}
              {@const dayTags = getDayTags(selectedDay)}
              {#if dayTags.length}
                <!-- Day (context) tags — outline/muted to stay visually distinct from per-trade tags (A166). -->
                <div class="mb-1.5 flex flex-wrap gap-1">
                  {#each dayTags as tg (tg)}<Badge variant="outline" class="text-muted-foreground" title="Day tag — edit in Calendar"
                      >{tg}</Badge
                    >{/each}
                </div>
              {/if}
            {/if}
            <textarea
              aria-label="Journal note"
              class="h-24 w-full resize-none rounded-md border border-border bg-card p-2 text-xs leading-relaxed text-foreground outline-none focus-visible:border-ring"
              bind:value={note}
            ></textarea>
            <div class="mt-1.5 flex justify-end">
              <Button size="sm" onclick={() => selectedDay && onsavenote?.(selectedDay, note)}>Save note</Button>
            </div>
          </div>
        </div>
      </div>
    {/if}
  {/snippet}

  {#snippet costBody()}
    <div class="mb-4">
      <CostSetup {setup} onsave={s => onsetupsave?.(s)} disabled={costDisabled} />
    </div>
    <div class="overflow-hidden rounded-md border border-border">
      {#each costRows as r, i (r.label)}
        <div
          class={[
            'flex items-center justify-between px-3 py-2 text-sm',
            i > 0 && 'border-t border-border',
            r.total && 'bg-secondary font-semibold',
          ]}
        >
          <span class={r.total ? 'text-foreground' : 'text-muted-foreground'}>{r.label}</span>
          <span class={['tabular-nums', r.tone === 'pos' ? 'text-chart-2' : r.tone === 'neg' ? 'text-destructive' : 'text-foreground']}
            >{r.value}</span
          >
        </div>
      {/each}
    </div>
    {#if estRoots.length}
      <p class="mt-2 text-[11px] text-muted-foreground">
        * Commission rate estimated for {estRoots.join(', ')} — root not in the fee table.
      </p>
    {/if}
    {#if actualCommNote}
      <p class="mt-2 text-[11px] text-muted-foreground">{actualCommNote}</p>
    {/if}
    <!-- A242: the cost-model + tax caveats retired from the Definitions module now surface here, in
         context, as "what is this?" popovers beside the estimate disclaimer. -->
    <div class="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span>Costs from your broker/feed/platform setup; tax is an estimate — not advice.</span>
      <InfoTip title="How costs are estimated" align="end" side="bottom">
        Commissions apply your selected broker's per-side rate plus the CME exchange/clearing/NFA fee for each contract root, charged per
        round-turn contract (2 sides × qty). Platform + data-feed subscriptions accrue over every calendar month spanned by your trades
        (inclusive), not just the months you traded. All figures are editable snapshot estimates — confirm against your broker's live
        schedule.
      </InfoTip>
      <InfoTip title="Tax figures are not tax advice" align="end" side="bottom">
        Take-home applies a simplified Section 1256 blended federal rate (60/40 long/short-term) plus your selected state's top marginal
        rate to net-of-cost profit; losses are not carried and tax on a losing period is zero. Note the base is net of subscriptions as a
        simplification — subscriptions don't actually reduce a §1256 gain for a non-trader-tax-status filer, so the estimate can understate
        tax slightly. This is a rough planning estimate, not tax advice — consult a professional for your actual liability.
      </InfoTip>
    </div>
  {/snippet}

  {#snippet advBody()}
    <div class="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-6 gap-y-0">
      {#each advStats as r (r.k)}
        <div class="flex items-baseline justify-between gap-3 border-b border-border py-[7px]">
          <span class="text-xs text-muted-foreground">{r.k}</span>
          <span
            class={[
              'text-[13px] font-bold tabular-nums whitespace-nowrap',
              r.tone === 'pos' ? 'text-chart-2' : r.tone === 'neg' ? 'text-destructive' : 'text-foreground',
            ]}>{r.v}</span
          >
        </div>
      {/each}
    </div>
  {/snippet}

  {#snippet compareBody()}
    <div class="mb-3 flex flex-wrap items-end gap-3">
      <label class="flex min-w-0 flex-col gap-1 text-[11px] text-muted-foreground">
        <span>Contract</span>
        <Select.Root
          type="single"
          value={compareRoot}
          onValueChange={v => (compareRoot = v)}
          items={compareRoots.map(r => ({ value: r, label: r }))}
        >
          <Select.Trigger class="w-28" aria-label="Contract root"><Select.Value /></Select.Trigger>
          <Select.Content>
            {#each compareRoots as r (r)}<Select.Item value={r} label={r} />{/each}
          </Select.Content>
        </Select.Root>
      </label>
      <label class="flex min-w-0 flex-col gap-1 text-[11px] text-muted-foreground">
        <span>Round turns / month</span>
        <input
          type="number"
          min="0"
          step="1"
          value={compareRT}
          oninput={e => (compareRT = Math.max(0, Number((e.currentTarget as HTMLInputElement).value) || 0))}
          class="w-28 rounded-md border border-border bg-secondary p-2 text-[13px] text-foreground focus:border-primary focus:outline-none"
        />
      </label>
      <span class="pb-2 text-[11px] text-muted-foreground">
        {compareRoot} is priced at the {compareRows.tier === 'micro' ? 'micro' : 'standard'} tier · exchange/clearing/NFA ${compareRows.exch.toFixed(
          2
        )}/side (same for every broker)
      </span>
    </div>
    <div class="overflow-x-auto">
      <Table.Root>
        <Table.Header>
          <Table.Row>
            <Table.Head>
              <button
                type="button"
                class={['flex items-center gap-1 hover:text-foreground', compareSort === 'name' && 'font-semibold text-foreground']}
                aria-pressed={compareSort === 'name'}
                onclick={() => (compareSort = 'name')}>Broker</button
              >
            </Table.Head>
            <Table.Head class="text-right">Commission /side</Table.Head>
            <Table.Head class="text-right">All-in /side</Table.Head>
            <Table.Head class="text-right">
              <button
                type="button"
                class={['ml-auto flex items-center gap-1 hover:text-foreground', compareSort === 'cost' && 'font-semibold text-foreground']}
                aria-pressed={compareSort === 'cost'}
                onclick={() => (compareSort = 'cost')}>Round turn</button
              >
            </Table.Head>
            <Table.Head class="text-right">Est. /month</Table.Head>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {#each compareRows.rows as r (r.key)}
            <Table.Row class={r.rt === compareRows.cheapest ? 'bg-chart-2/5' : undefined}>
              <Table.Cell class="font-medium">
                {r.name}
                {#if r.rt === compareRows.cheapest}<Badge variant="outline" class="ml-1.5 border-chart-2/40 text-chart-2">Cheapest</Badge
                  >{/if}
                {#if setup.broker === r.key}<span class="ml-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">Yours</span>{/if}
              </Table.Cell>
              <Table.Cell class="text-right tabular-nums">${r.comm.toFixed(2)}</Table.Cell>
              <Table.Cell class="text-right tabular-nums"
                >${r.rate.toFixed(2)}{#if !r.known}*{/if}</Table.Cell
              >
              <Table.Cell class={['text-right font-semibold tabular-nums', r.rt === compareRows.cheapest && 'text-chart-2']}>
                ${r.rt.toFixed(2)}
              </Table.Cell>
              <Table.Cell class="text-right tabular-nums text-muted-foreground">
                {compareRT > 0 ? usdWhole(r.rt * compareRT) : '—'}
              </Table.Cell>
            </Table.Row>
          {/each}
        </Table.Body>
      </Table.Root>
    </div>
    <p class="mt-2 text-[11px] text-muted-foreground">
      Published per-contract rates (editable snapshot — see the Break-even module's sources); volume discounts, memberships and promos
      aren't modeled{compareRows.rows.some(r => !r.known) ? '; * = fallback fee estimate for this root' : ''}. Data-feed and platform costs
      are separate.
    </p>
  {/snippet}

  {#snippet blotterBody()}
    <!-- F51: the compact blotter — the most recent trades under the live filter set, no
         pagination/editing (that's the Blotter screen's job; the link hands off). -->
    {#if recentTrades.length}
      <div class="overflow-x-auto">
        <Table.Root class="[&_td]:px-2 [&_td]:py-1 [&_th]:px-2">
          <Table.Header>
            <Table.Row class="hover:bg-transparent">
              <Table.Head class="w-28 whitespace-nowrap">Date / time</Table.Head>
              <Table.Head class="w-16">Symbol</Table.Head>
              <Table.Head class="w-14">Side</Table.Head>
              <Table.Head class="w-10 text-right">Qty</Table.Head>
              <Table.Head class="w-20 text-right">P&L</Table.Head>
              <Table.Head class="w-24">Platform</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {#each recentTrades as t, i (i)}
              <Table.Row>
                <Table.Cell class="whitespace-nowrap text-xs text-muted-foreground">{t.date.slice(5)} {t.time}</Table.Cell>
                <Table.Cell class="text-xs font-medium">{t.sym}</Table.Cell>
                <Table.Cell>
                  <Badge
                    variant="outline"
                    class={t.side === 'Long' ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}>{t.side}</Badge
                  >
                </Table.Cell>
                <Table.Cell class="text-right text-xs tabular-nums">{t.qty}</Table.Cell>
                <Table.Cell class={['text-right text-xs font-semibold tabular-nums', t.pnl >= 0 ? 'text-chart-2' : 'text-destructive']}>
                  {usd(t.pnl)}
                </Table.Cell>
                <Table.Cell class="whitespace-nowrap text-xs text-muted-foreground">{t.platform || '—'}</Table.Cell>
              </Table.Row>
            {/each}
          </Table.Body>
        </Table.Root>
      </div>
    {:else}
      <p class="text-xs text-muted-foreground">No trades under the current filters.</p>
    {/if}
    <div class="mt-2 text-right">
      <a href="#blotter" class="text-xs text-muted-foreground underline hover:text-foreground">View all in the Blotter →</a>
    </div>
  {/snippet}

  <!-- F39/A142 batch-1 modules (Today · Drawdown Status · Streak Monitor). Shared label/value row +
       empty state; each reads the resolved `md` view-model (app-wired or series-derived). -->
  {#snippet kv(label: string, value: string, t?: 'pos' | 'neg')}
    <div class="flex items-center justify-between border-b border-border px-3 py-1.5 text-xs last:border-b-0">
      <span class="text-muted-foreground">{label}</span>
      <span class={['font-medium tabular-nums', t === 'pos' ? 'text-chart-2' : t === 'neg' ? 'text-destructive' : 'text-foreground']}
        >{value}</span
      >
    </div>
  {/snippet}
  {#snippet emptyModule()}
    <p class="grid h-24 place-items-center text-sm text-muted-foreground">No trades in the selected range.</p>
  {/snippet}

  {#snippet todayBody()}
    {#if md?.lastDay}
      {@const d = md.lastDay}
      {@const up = d.net >= 0}
      {@const delta = d.net - md.avgDaily}
      <div class="flex items-baseline justify-between gap-2">
        <span class="text-xs text-muted-foreground">Last session · {d.date}</span>
        <span class="text-[11px] tabular-nums text-muted-foreground">{d.winRate.toFixed(0)}% win</span>
      </div>
      <div class={['mt-1 text-xl font-bold tracking-tight tabular-nums', up ? 'text-chart-2' : 'text-destructive']}>{usd(d.net)}</div>
      <div class="mt-0.5 text-[11px] text-muted-foreground">
        {#if md.avgDaily}
          <span class={delta >= 0 ? 'text-chart-2' : 'text-destructive'}>{delta >= 0 ? '+' : '−'}{money(Math.abs(delta))}</span> vs your average
          day
        {:else}
          your latest trading day
        {/if}
      </div>
      <div class="mt-3 overflow-hidden rounded-md border border-border">
        {@render kv(
          'Trades',
          md.avgTrades != null ? `${d.trades}${d.capped ? '+' : ''} · avg ${md.avgTrades.toFixed(1)}` : `${d.trades}${d.capped ? '+' : ''}`
        )}
        {@render kv('Best trade', usd(d.best), d.best >= 0 ? 'pos' : 'neg')}
        {@render kv('Worst trade', usd(d.worst), d.worst >= 0 ? 'pos' : 'neg')}
        {@render kv('Win-day rate', `${md.winDayPct.toFixed(0)}% of ${md.activeDays} day${md.activeDays === 1 ? '' : 's'}`)}
      </div>
    {:else}
      {@render emptyModule()}
    {/if}
  {/snippet}

  {#snippet ddBody()}
    {#if md}
      {@const x = md.dd}
      <div class="text-xs text-muted-foreground">Distance from your equity high</div>
      {#if x.atHigh}
        <div class="mt-1 text-xl font-bold tracking-tight tabular-nums text-chart-2">At a new high</div>
        <div class="mt-0.5 text-[11px] text-muted-foreground">Equity is at its high-water mark — no open drawdown.</div>
      {:else}
        <div class="mt-1 text-xl font-bold tracking-tight tabular-nums text-destructive">-{money(x.current)}</div>
        <div class="mt-0.5 text-[11px] text-muted-foreground">
          {#if x.currentPct != null}{x.currentPct.toFixed(1)}% below the high-water mark{:else}below the high-water mark{/if} · {x.sincePeak}
          {x.unit}{x.sincePeak === 1 ? '' : 's'} since the peak
        </div>
      {/if}
      <div class="mt-3 overflow-hidden rounded-md border border-border">
        {@render kv('To a new high', x.atHigh ? '$0' : money(x.current))}
        {@render kv(
          'Max drawdown',
          x.maxDD > 0 ? `-${money(x.maxDD)}${x.maxDDpct != null ? ` · ${x.maxDDpct.toFixed(1)}%` : ''}` : '$0',
          x.maxDD > 0 ? 'neg' : undefined
        )}
        {@render kv('Longest drawdown', x.maxDDdur > 0 ? `${x.maxDDdur} ${x.unit}${x.maxDDdur === 1 ? '' : 's'}` : '—')}
        {@render kv('Recovery factor', num(x.recovery))}
      </div>
    {:else}
      {@render emptyModule()}
    {/if}
  {/snippet}

  {#snippet streakBody()}
    {#if md}
      {@const s = md.streak}
      {@const t = s.trade}
      <div class="text-xs text-muted-foreground">Current run</div>
      <div
        class={[
          'mt-1 text-xl font-bold tracking-tight tabular-nums',
          runTone(t.kind) === 'pos' ? 'text-chart-2' : runTone(t.kind) === 'neg' ? 'text-destructive' : 'text-foreground',
        ]}
      >
        {t.len ? `${t.len}${t.capped ? '+' : ''}` : '—'}
        <!-- The current run is per-trade in both sources (m.pnls / the recent-trades tail), so it's
             always "trades" here — `recUnit` only qualifies the RECORD rows below. -->
        <span class="text-sm font-medium text-muted-foreground"
          >{t.len ? `${runVerb(t.kind)} trade${t.len === 1 ? '' : 's'}` : 'no active streak'}</span
        >
      </div>
      <div class="mt-0.5 text-[11px] text-muted-foreground">
        {t.len ? `${usd(t.sum)} on the run` : 'flat since the last flip'}
      </div>
      <div class="mt-3 overflow-hidden rounded-md border border-border">
        {@render kv(
          'Consecutive days',
          s.day.len ? `${s.day.len} ${runVerb(s.day.kind)} day${s.day.len === 1 ? '' : 's'}` : '—',
          runTone(s.day.kind)
        )}
        {@render kv(`Record win streak (${s.recUnit}s)`, `${s.rec.maxWin} · ${usd(s.rec.maxWinSum)}`, 'pos')}
        {@render kv(`Record loss streak (${s.recUnit}s)`, `${s.rec.maxLoss} · ${usd(s.rec.maxLossSum)}`, 'neg')}
        {#if s.recUnit === 'trade'}
          {@render kv('Best / worst day run', `${s.dayRec.maxWin}W / ${s.dayRec.maxLoss}L days`)}
        {/if}
      </div>
    {:else}
      {@render emptyModule()}
    {/if}
  {/snippet}

  <!-- A189: tiny stylized per-module thumbnails for the picker — inline SVG in the chart tokens
       (geometry attrs + fill/stroke utilities only; CSP-clean). -->
  {#snippet moduleThumb(key: string)}
    <svg viewBox="0 0 40 28" class="h-7 w-10 shrink-0 rounded-sm border border-border bg-background" aria-hidden="true">
      {#if key === 'perf'}
        <polyline points="3,22 10,16 16,19 24,9 31,12 37,5" fill="none" class="stroke-chart-1" stroke-width="1.5" />
      {:else if key === 'cal'}
        {#each [0, 1, 2] as r (r)}
          {#each [0, 1, 2, 3, 4] as c (c)}
            <rect
              x={4 + c * 7}
              y={4 + r * 7}
              width="5"
              height="5"
              rx="1"
              class={(r + c) % 3 === 0 ? 'fill-chart-2/60' : 'fill-secondary'}
            />
          {/each}
        {/each}
      {:else if key === 'cost'}
        {#each [6, 12, 18] as y, i (y)}
          <rect x="4" {y} width={i === 2 ? 32 : 22 - i * 4} height="3" rx="1" class={i === 2 ? 'fill-chart-3/70' : 'fill-secondary'} />
        {/each}
      {:else if key === 'compare'}
        <!-- A203: ranked broker bars — the shortest (cheapest) highlighted green -->
        {#each [16, 24, 32] as w, i (w)}
          <rect x="4" y={5 + i * 7} width={w} height="4" rx="1" class={i === 0 ? 'fill-chart-2/70' : 'fill-secondary'} />
        {/each}
      {:else if key === 'blotter'}
        <!-- F51: dense trade rows, green/red P&L ticks at the right edge -->
        {#each [4, 9, 14, 19, 24] as y, i (y)}
          <rect x="4" {y} width="24" height="3" rx="1" class="fill-secondary" />
          <rect x="31" {y} width="5" height="3" rx="1" class={i % 2 === 0 ? 'fill-chart-2/70' : 'fill-destructive/70'} />
        {/each}
      {:else if key === 'today'}
        <!-- F39: a big signed figure over a small 'vs avg' delta chip -->
        <rect x="4" y="6" width="20" height="7" rx="1" class="fill-chart-2/70" />
        <rect x="4" y="17" width="12" height="4" rx="1" class="fill-secondary" />
      {:else if key === 'ddstatus'}
        <!-- F39: an equity line with the peak flagged and a shaded gap down to 'now' -->
        <polyline points="3,20 12,8 20,8 28,18 37,14" fill="none" class="stroke-chart-1" stroke-width="1.5" />
        <rect x="20" y="8" width="8" height="10" class="fill-destructive/25" />
        <circle cx="20" cy="8" r="1.6" class="fill-chart-4" />
      {:else if key === 'streak'}
        <!-- F39: a row of recent-trade squares, the current run highlighted -->
        {#each [0, 1, 2, 3, 4, 5] as c (c)}
          <rect x={4 + c * 6} y="11" width="5" height="6" rx="1" class={c >= 3 ? 'fill-destructive/70' : 'fill-chart-2/50'} />
        {/each}
      {:else}
        {#each [0, 1] as r (r)}
          {#each [0, 1, 2] as c (c)}
            <rect x={4 + c * 12} y={6 + r * 10} width="9" height="6" rx="1" class="fill-secondary" />
          {/each}
        {/each}
      {/if}
    </svg>
  {/snippet}

  <!-- Modules — reorderable / hideable / re-addable (persisted to Store.local). A146: reorders
       FLIP into place and add/remove fades (durations collapse under reduced motion).
       A228: at lg+ the stack becomes a 2-track grid — paired modules are half-width (side by side
       when adjacent in the order, as in the default layout); every other module spans both tracks.
       A243 extended the PAIRED set to also half-width Advanced Statistics + Activity Terminal (same
       treatment as the original cal/cost pairing). A lone paired module (its partner hidden/moved
       elsewhere) just takes a half-track row — acceptable, matches the original cal/cost behavior.
       Narrow viewports keep the single-column stack. -->
  <!-- A271: a 12-track grid on lg (superset of the old 2-track model). Each module spans per its size
       (sm=2 · md=6 · lg=12); md/lg reproduce the old half/full widths exactly. Below lg it stacks. -->
  <div bind:this={gridEl} class="grid grid-cols-1 gap-5 lg:grid-cols-12">
    {#each modOrder as key (key)}
      <div
        data-mod
        class={['min-w-0', spanClass(sizeCtl.previewSize(key))]}
        animate:flip={{ duration: dur(180) }}
        transition:fade={{ duration: dur(140) }}
      >
        <Card.Root id="dashmod-{key}" class={['relative h-full', fillClass(key)]}>
          {@render moduleHeader(key)}
          {#if isStaging}
            <!-- A271/A319: the shared corner drag-resize handle (staging). Pointer drag snaps to the
                 nearest supported span; role=slider + arrow keys are the keyboard path. -->
            <ModuleResizeHandle ctl={sizeCtl} modKey={key} label={moduleLabel(key)} />
          {/if}
          <Card.Content>
            {#if key === 'perf'}{@render perfBody()}{:else if key === 'cal'}{@render calBody()}{:else if key === 'cost'}{@render costBody()}{:else if key === 'adv'}{@render advBody()}{:else if key === 'term'}<ActivityTerminal
              />{:else if key === 'compare'}{@render compareBody()}{:else if key === 'blotter'}{@render blotterBody()}{:else if key === 'today'}{@render todayBody()}{:else if key === 'ddstatus'}{@render ddBody()}{:else if key === 'streak'}{@render streakBody()}{/if}
          </Card.Content>
        </Card.Root>
      </div>
    {/each}
  </div>

  <!-- Add-modules affordance (A189) — ALWAYS visible (the A139 dropdown only rendered when a module
       was hidden, so a default dashboard offered no way to discover it). Opens an illustrated
       multi-select picker; already-added modules show as checked + disabled. -->
  <button
    type="button"
    class="flex items-center justify-center gap-2 rounded-md border border-dashed border-border py-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
    title={hiddenModules.length ? 'Add modules to this dashboard' : 'All modules are already on this dashboard'}
    onclick={() => {
      pickerSel = [];
      pickerOpen = true;
    }}
  >
    <Plus class="size-4" /> Add modules
  </button>

  <Dialog.Root bind:open={pickerOpen}>
    <Dialog.Content class="sm:max-w-md">
      <Dialog.Header>
        <Dialog.Title>Add modules</Dialog.Title>
        <Dialog.Description>Pick the modules to add to this dashboard's layout.</Dialog.Description>
      </Dialog.Header>
      <div class="grid gap-2">
        {#each MODULES as m (m.key)}
          {@const onDash = modOrder.includes(m.key)}
          <label
            class={[
              'flex items-center gap-3 rounded-md border border-border p-2.5',
              onDash ? 'opacity-50' : 'cursor-pointer hover:bg-accent',
            ]}
          >
            <input
              type="checkbox"
              class="accent-primary"
              disabled={onDash}
              checked={onDash || pickerSel.includes(m.key)}
              onchange={() => togglePick(m.key)}
            />
            {@render moduleThumb(m.key)}
            <span class="flex-1 text-sm text-foreground">{m.label}</span>
            {#if onDash}<span class="text-[10px] uppercase tracking-wide text-muted-foreground">Added</span>{/if}
          </label>
        {/each}
      </div>
      <Dialog.Footer class="flex-row justify-end gap-2">
        <Button variant="ghost" size="sm" onclick={() => (pickerOpen = false)}>Cancel</Button>
        <Button size="sm" disabled={!pickerSel.length} onclick={addPicked}
          >Add module{pickerSel.length === 1 ? '' : 's'}{pickerSel.length ? ` (${pickerSel.length})` : ''}</Button
        >
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
</div>
<!-- A242: the standalone Definitions module is retired — its four definitions/caveats now live
     contextually as InfoTip "what is this?" popovers on the modules they explain: the parsing
     caveats (trade counting, date/timezone reading) on the KPI stat row, and the cost-model + tax
     caveats inside the Break-even & Cost module (see costBody). Stored layouts that named a stray
     module key were already dropped harmlessly by validKeys(); Definitions was a fixed card, never a
     MODULES entry, so there is no picker thumbnail or layout key to migrate. -->
