<script lang="ts" module>
  export type DashStat = { label: string; value: string; badge?: string; up?: boolean; note: string; key?: string };
  export type DayCell = { pnl: number; tr: number };
  // The default module layout (all four, default order) — exported so the app's workspace-template
  // save captures THIS when the user hasn't customized yet (A148: saving on the default layout used
  // to capture [] and applying it blanked the dashboard).
  export const DEFAULT_MODULE_KEYS = ['perf', 'cal', 'cost', 'adv'];
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
  // Per-card drill-in content (parity with app/demo's stat-card modal), built from metrics/cost.
  export type StatBar = { label: string; value: string; pct: number; tone: 'pos' | 'neg' | 'muted' };
  export type StatDetail = {
    title: string;
    value: string;
    tone?: 'pos' | 'neg';
    desc: string;
    rows: { label: string; value: string; tone?: 'pos' | 'neg' }[];
    bars?: StatBar[];
  };
</script>

<script lang="ts">
  // Dashboard — the redesigned overview: a scope toolbar, a KPI stat-card row, and the Performance
  // (equity curve) + Trading Calendar modules. Data comes from props (real metrics, wired by App.svelte
  // on all surfaces). Color lives only in the P&L.
  import { SlidersHorizontal, Plus, GripVertical, MoreHorizontal, Pencil, LayoutGrid, RotateCcw } from '@lucide/svelte';
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
  import { X } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { styleProps } from '../lib/actions.ts';
  import { flip } from 'svelte/animate';
  import { fade, slide } from 'svelte/transition';
  import { MediaQuery } from 'svelte/reactivity';
  import { dur } from '../lib/motion.ts';
  import {
    usd,
    usdWhole,
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
  } from '../../lib/core/core.ts';
  import * as Table from '$lib/components/ui/table';
  import type { DailyPoint } from '../../lib/core/curveseries.ts';
  import type { AppSetup } from '../../lib/core/types.ts';
  import CostSetup from '../parts/CostSetup.svelte';
  import ModuleCarousel from '../parts/ModuleCarousel.svelte';
  import ActivityTerminal from '../parts/ActivityTerminal.svelte';
  import Definitions from '../parts/Definitions.svelte';
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
    /** Visible dashboard modules in order (persisted to Store.local); defaults to all shown. */
    modules?: string[];
    onmoduleschange?: (order: string[]) => void;
    /** Named workspace layout templates (R12 parity) — save/apply/delete/revert the module layout. */
    layouts?: {
      names: string[];
      canSave: boolean;
      save: (name: string) => void;
      apply: (name: string) => void;
      remove: (name: string) => void;
      revert: () => void;
    };
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
    modules,
    onmoduleschange,
    layouts,
  }: Props = $props();

  function doSaveLayout() {
    const name = typeof prompt === 'function' ? prompt('Save current layout as…') : null;
    if (name && name.trim()) layouts?.save(name.trim());
  }

  // A200: below Tailwind's sm breakpoint the stat cards render as a one-at-a-time carousel.
  // Conditional RENDER (not CSS hiding) so the cards never exist twice in the DOM/a11y tree.
  const isNarrow = new MediaQuery('(max-width: 639px)');

  // ── Module layout (hide / reorder / re-add — parity with app/demo, persisted to Store.local) ────
  const MODULES: { key: string; label: string }[] = [
    { key: 'perf', label: 'Performance' },
    { key: 'cal', label: 'Trading Calendar' },
    { key: 'cost', label: 'Break-even & Cost' },
    { key: 'adv', label: 'Advanced Statistics' },
    { key: 'compare', label: 'Commission Compare' }, // A203 — picker-addable, not in the default layout
  ];
  const validKeys = (ks?: string[]) => (ks ?? DEFAULT_MODULE_KEYS).filter(k => MODULES.some(m => m.key === k));
  // svelte-ignore state_referenced_locally — initial layout only; the app re-seeds via the prop below.
  let modOrder = $state<string[]>(validKeys(modules));
  // svelte-ignore state_referenced_locally
  let lastModKey = modules ? modules.join(',') : '';
  $effect(() => {
    // Re-seed from the prop when the app supplies a persisted layout (e.g. on first load after boot).
    const key = (modules ?? []).join(',');
    if (key !== lastModKey) {
      lastModKey = key;
      modOrder = validKeys(modules);
    }
  });
  const hiddenModules = $derived(MODULES.filter(m => !modOrder.includes(m.key)));
  const moduleLabel = (key: string) => MODULES.find(m => m.key === key)?.label ?? key;
  function commitModules(order: string[]) {
    modOrder = order;
    // A195: keep the re-seed guard in sync — the app echoes this order back through the `modules`
    // prop, and without updating lastModKey the effect above redundantly reassigned modOrder (a
    // fresh identical array) after every local edit.
    lastModKey = order.join(',');
    onmoduleschange?.(order);
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

  // ── KPI card drill-in ────────────────────────────────────────────────────────────────────────
  let openStatKey = $state<string | null>(null);
  let statOpen = $state(false); // bits-ui owns the Dialog open state (bind:open, per L11)
  $effect(() => {
    if (!statOpen) openStatKey = null;
  });
  const openStat = (key?: string) => {
    if (!key) return;
    openStatKey = key;
    statOpen = true;
  };
  const detail = $derived(openStatKey ? statDetail(openStatKey) : null);

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
  const VH = 256;
  const PAD = { l: 48, r: 72, t: 12, b: 22 };
  const W = $derived(Math.max(560, cw || 900));

  const view = $derived.by(() => {
    if (!series.length) return null;
    const on = enabledList.length ? enabledList : [SERIES[0]];
    const pts: DailyPoint[] = [{ date: '', gross: 0, net: 0, take: 0 }, ...series];
    let { lo, hi } = minMax(on.flatMap(s => pts.map(p => p[s.key])));
    const ticks = niceTicks(lo, hi, 4);
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
    for (let k = 0; k <= 4; k++) {
      const i = Math.min(pts.length - 1, 1 + Math.round(((pts.length - 2) * k) / 4));
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
  <div class="flex items-center gap-2 border-b border-border px-4 py-2.5">
    <GripVertical class="size-4 text-muted-foreground" />
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
                        class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
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
                        class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                        onclick={() => filterModel.deleteView?.(v.id)}
                      >
                        <X class="size-3.5" />
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
                        class="mr-1 grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                        onclick={e => {
                          e.stopPropagation();
                          layouts.remove(name);
                        }}
                      >
                        <X class="size-3.5" />
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
  {#snippet statCard(s: DashStat)}
    <button
      type="button"
      onclick={() => openStat(s.key)}
      disabled={!s.key}
      class="w-full rounded-md border border-border bg-card p-4 text-left transition-colors enabled:cursor-pointer enabled:hover:border-ring enabled:hover:bg-accent/30"
    >
      <div class="flex items-start justify-between gap-2">
        <span class="text-xs text-muted-foreground">{s.label}</span>
        {#if s.badge}
          <Badge variant="outline" class={s.up ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}
            >{s.badge}</Badge
          >
        {/if}
      </div>
      <div
        class={[
          'mt-2 text-xl font-semibold tracking-tight tabular-nums',
          s.up === undefined ? 'text-foreground' : s.up ? 'text-chart-2' : 'text-destructive',
        ]}
      >
        {s.value}
      </div>
      <div class="mt-1 text-[11px] text-muted-foreground">{s.note}</div>
    </button>
  {/snippet}
  <!-- A200: on phones the stat cards stack behind a one-at-a-time swipeable carousel; the grid
       returns at sm+ (desktop unchanged). Conditionally RENDERED (MediaQuery) so the cards exist
       once in the DOM — CSS-hiding the other variant would double every stat for locators/AT. -->
  {#if isNarrow.current}
    <ModuleCarousel count={stats.length} label="Key stats">
      {#snippet slide(i)}
        {@render statCard(stats[i])}
      {/snippet}
    </ModuleCarousel>
  {:else}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {#each stats as s (s.label)}
        {@render statCard(s)}
      {/each}
    </div>
  {/if}

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
            <text x={t.x} y={VH - 6} text-anchor="middle" class="fill-muted-foreground text-[10px] tabular-nums">{t.label}</text>
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
          <button
            type="button"
            data-testid="cal-day"
            onclick={() => t && pickDay(day)}
            disabled={!t}
            class={[
              // A232: the cells grow on desktop so the month grid fills the module's vertical room
              // instead of squishing (A182's bounded mobile cells are unchanged below sm).
              'aspect-square min-w-0 overflow-hidden rounded-md border p-1 text-left transition-colors sm:aspect-auto sm:min-h-16 sm:p-1.5 lg:min-h-[5.5rem] xl:min-h-24',
              t ? (up ? 'border-chart-2/30 bg-chart-2/10' : 'border-destructive/30 bg-destructive/10') : 'cursor-default border-border',
              selectedDay === day && 'ring-2 ring-primary',
            ]}
          >
            <span class="flex items-center gap-1 text-[11px] text-muted-foreground">
              {day}{#if getNote(day)}<span class="size-1.5 rounded-full bg-primary" title="Has a note"></span>{/if}
            </span>
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

    <!-- Selected-day detail: the day's trades + its journal note (parity with app/demo). -->
    {#if selectedDay && dayPnl[selectedDay]}
      {@const t = dayPnl[selectedDay]}
      <div class="mt-4 rounded-md border border-border bg-background p-4" transition:slide={{ duration: dur(150) }}>
        <div class="mb-3 flex items-center justify-between">
          <span class="text-sm font-semibold text-foreground">
            {monthWord}
            {selectedDay}
            <span class={['ml-2 tabular-nums', t.pnl >= 0 ? 'text-chart-2' : 'text-destructive']}>{usdWhole(t.pnl)}</span>
            <span class="ml-2 text-xs font-normal text-muted-foreground">{t.tr} {t.tr === 1 ? 'trade' : 'trades'}</span>
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
    <p class="mt-2 text-[11px] text-muted-foreground">Costs from your broker/feed/platform setup; tax is an estimate — not advice.</p>
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
       A228: at lg+ the stack becomes a 2-track grid — Trading Calendar and Break-Even & Cost are
       half-width (side by side when adjacent in the order, as in the default layout); every other
       module spans both tracks. Narrow viewports keep the single-column stack. -->
  <div class="grid grid-cols-1 gap-5 lg:grid-cols-2">
    {#each modOrder as key (key)}
      <div
        class={['min-w-0', key !== 'cal' && key !== 'cost' && 'lg:col-span-2']}
        animate:flip={{ duration: dur(180) }}
        transition:fade={{ duration: dur(140) }}
      >
        <Card.Root id="dashmod-{key}" class="h-full">
          {@render moduleHeader(key)}
          <Card.Content>
            {#if key === 'perf'}{@render perfBody()}{:else if key === 'cal'}{@render calBody()}{:else if key === 'cost'}{@render costBody()}{:else if key === 'adv'}{@render advBody()}{:else if key === 'compare'}{@render compareBody()}{/if}
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

  <!-- Chrome parity (R12/F27): the boot/activity log + the metric & cost definitions/caveats. -->
  <div class="grid gap-4 lg:grid-cols-2">
    <Card.Root>
      <Card.Header class="pb-2"
        ><Card.Title class="text-xs uppercase tracking-wider text-muted-foreground">Activity</Card.Title></Card.Header
      >
      <Card.Content><ActivityTerminal /></Card.Content>
    </Card.Root>
    <Card.Root>
      <Card.Header class="pb-2"
        ><Card.Title class="text-xs uppercase tracking-wider text-muted-foreground">Definitions</Card.Title></Card.Header
      >
      <Card.Content><Definitions /></Card.Content>
    </Card.Root>
  </div>
</div>

<!-- KPI card drill-in dialog -->
<Dialog.Root bind:open={statOpen}>
  <Dialog.Content class="sm:max-w-md">
    {#if detail}
      <Dialog.Header>
        <Dialog.Title class="flex items-baseline justify-between gap-3 pr-6">
          <span>{detail.title}</span>
          <span
            class={[
              'text-lg tabular-nums',
              detail.tone === 'pos' ? 'text-chart-2' : detail.tone === 'neg' ? 'text-destructive' : 'text-foreground',
            ]}>{detail.value}</span
          >
        </Dialog.Title>
        {#if detail.desc}<Dialog.Description>{detail.desc}</Dialog.Description>{/if}
      </Dialog.Header>
      <div class="space-y-4">
        {#if detail.bars?.length}
          <div class="space-y-1.5">
            {#each detail.bars as bar, i (i)}
              <div class="flex items-center gap-2 text-xs">
                <span class="w-24 shrink-0 text-muted-foreground">{bar.label}</span>
                <div class="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                  <div
                    class={[
                      'h-full rounded-full',
                      bar.tone === 'pos' ? 'bg-chart-2' : bar.tone === 'neg' ? 'bg-destructive' : 'bg-muted-foreground',
                    ]}
                    use:styleProps={{ width: `${Math.max(2, Math.min(100, bar.pct))}%` }}
                  ></div>
                </div>
                <span
                  class={[
                    'w-20 shrink-0 text-right font-medium tabular-nums',
                    bar.tone === 'pos' ? 'text-chart-2' : bar.tone === 'neg' ? 'text-destructive' : 'text-foreground',
                  ]}>{bar.value}</span
                >
              </div>
            {/each}
          </div>
        {/if}
        {#if detail.rows.length}
          <div class="overflow-hidden rounded-md border border-border">
            {#each detail.rows as r, i (i)}
              <div class={['flex items-center justify-between px-3 py-2 text-sm', i > 0 && 'border-t border-border']}>
                <span class="text-muted-foreground">{r.label}</span>
                <span
                  class={['tabular-nums', r.tone === 'pos' ? 'text-chart-2' : r.tone === 'neg' ? 'text-destructive' : 'text-foreground']}
                  >{r.value}</span
                >
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
