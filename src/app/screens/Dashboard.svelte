<script lang="ts" module>
  export type DashStat = { label: string; value: string; badge?: string; up?: boolean; note: string; key?: string };
  export type DayCell = { pnl: number; tr: number };
  // The default module layout (all four, default order) — exported so the app's workspace-template
  // save captures THIS when the user hasn't customized yet (A148: saving on the default layout used
  // to capture [] and applying it blanked the dashboard).
  export const DEFAULT_MODULE_KEYS = ['perf', 'cal', 'cost', 'adv'];
  // Live filter model for the dashboard Filters popover — current values + option lists + mutators
  // (bound to the app's filter state).
  export type FilterPatch = Partial<{ root: string; side: string; session: string; tag: string; from: string; to: string; dows: number[] }>;
  export type FilterModel = {
    root: string;
    side: string;
    session: string;
    tag: string;
    from: string;
    to: string;
    dows: number[];
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
  import { ChevronUp, ChevronDown, EyeOff } from '@lucide/svelte';
  import { X } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { styleProps } from '../lib/actions.ts';
  import { flip } from 'svelte/animate';
  import { fade, slide } from 'svelte/transition';
  import { dur } from '../lib/motion.ts';
  import { usd, usdWhole, axMoney, niceTicks, linePath, minMax, monthCells, DOW_LABEL } from '../../lib/core/core.ts';
  import type { DailyPoint } from '../../lib/core/curveseries.ts';
  import type { AppSetup } from '../../lib/core/types.ts';
  import CostSetup from '../parts/CostSetup.svelte';
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

  // ── Module layout (hide / reorder / re-add — parity with app/demo, persisted to Store.local) ────
  const MODULES: { key: string; label: string }[] = [
    { key: 'perf', label: 'Performance' },
    { key: 'cal', label: 'Trading Calendar' },
    { key: 'cost', label: 'Break-even & Cost' },
    { key: 'adv', label: 'Advanced Statistics' },
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
  const addModule = (key: string) => commitModules([...modOrder, key]);

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
    const name = typeof prompt === 'function' ? prompt('Rename view', current) : null;
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
      <DropdownMenu.Trigger>
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
            <Label class="text-[11px]">Saved views</Label>
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
                  <button
                    type="button"
                    aria-label="Rename view"
                    class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    onclick={() => doRenameView(v.id, v.name)}
                  >
                    <Pencil class="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Delete view"
                    class="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
                    onclick={() => filterModel.deleteView?.(v.id)}
                  >
                    <X class="size-3.5" />
                  </button>
                {/if}
              </div>
            {/each}
            {#if canSaveView}
              <div class="flex items-center gap-1">
                <Input
                  bind:value={newViewName}
                  placeholder="Name this view…"
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
                  <button
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
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
    {#each stats as s (s.label)}
      <button
        type="button"
        onclick={() => openStat(s.key)}
        disabled={!s.key}
        class="rounded-md border border-border bg-card p-4 text-left transition-colors enabled:cursor-pointer enabled:hover:border-ring enabled:hover:bg-accent/30"
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
    {/each}
  </div>

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
    <div class="grid grid-cols-7 gap-1.5">
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
            onclick={() => t && pickDay(day)}
            disabled={!t}
            class={[
              'min-h-16 rounded border p-1.5 text-left transition-colors',
              t ? (up ? 'border-chart-2/30 bg-chart-2/10' : 'border-destructive/30 bg-destructive/10') : 'cursor-default border-border',
              selectedDay === day && 'ring-2 ring-primary',
            ]}
          >
            <span class="flex items-center gap-1 text-[11px] text-muted-foreground">
              {day}{#if getNote(day)}<span class="size-1.5 rounded-full bg-primary" title="Has a note"></span>{/if}
            </span>
            {#if t}
              <div class={['mt-1 text-right text-xs font-medium tabular-nums', up ? 'text-chart-2' : 'text-destructive']}>
                {usdWhole(t.pnl)}
              </div>
              <div class="text-right text-[10px] text-muted-foreground">{t.tr} tr</div>
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

  <!-- Modules — reorderable / hideable / re-addable (persisted to Store.local). A146: reorders
       FLIP into place and add/remove fades (durations collapse under reduced motion). -->
  {#each modOrder as key (key)}
    <div animate:flip={{ duration: dur(180) }} transition:fade={{ duration: dur(140) }}>
      <Card.Root id="dashmod-{key}">
        {@render moduleHeader(key)}
        <Card.Content>
          {#if key === 'perf'}{@render perfBody()}{:else if key === 'cal'}{@render calBody()}{:else if key === 'cost'}{@render costBody()}{:else if key === 'adv'}{@render advBody()}{/if}
        </Card.Content>
      </Card.Root>
    </div>
  {/each}

  <!-- Add-module affordance — offers the hidden modules. -->
  {#if hiddenModules.length}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        {#snippet child({ props })}
          <button
            {...props}
            type="button"
            class="flex items-center justify-center gap-2 rounded-md border border-dashed border-border py-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus class="size-4" /> Add module
          </button>
        {/snippet}
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start" class="min-w-[180px]">
        {#each hiddenModules as m (m.key)}
          <DropdownMenu.Item onSelect={() => addModule(m.key)}><Plus class="size-4" /> {m.label}</DropdownMenu.Item>
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/if}

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
