<script lang="ts" module>
  export type DashStat = { label: string; value: string; badge?: string; up?: boolean; note: string };
  export type DayCell = { pnl: number; tr: number };
</script>

<script lang="ts">
  // Dashboard — the redesigned overview: a scope toolbar, a KPI stat-card row, and the Performance
  // (equity curve) + Trading Calendar modules. Data comes from props (real metrics on the staging app);
  // the defaults below are the /dev mock for the preview harness. Color lives only in the P&L.
  import { SlidersHorizontal, Plus, GripVertical, MoreHorizontal } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import * as Card from '$lib/components/ui/card';
  import { X } from '@lucide/svelte';
  import { usd, usdWhole, axMoney, niceTicks, linePath } from '../../lib/core/core.ts';
  import type { DailyPoint } from '../../lib/core/curveseries.ts';
  import { type DayTrade } from './Calendar.svelte';

  const MOCK_STATS: DashStat[] = [
    { label: 'Net P&L', value: '+$79,467.75', badge: '+12.5%', up: true, note: '892W · 647L' },
    { label: 'Win rate', value: '58.0%', note: '1,539 trades' },
    { label: 'Profit factor', value: '3.01', note: 'gross win ÷ loss' },
    { label: 'Expectancy', value: '+$51.64', badge: 'per trade', up: true, note: 'avg edge' },
    { label: 'Max drawdown', value: '-$502.75', badge: '0.8%', up: false, note: 'of peak' },
    { label: 'Sharpe (daily)', value: '0.80', note: '443 trading days' },
  ];
  const MOCK_PNL: Record<number, DayCell> = {
    2: { pnl: 454, tr: 4 }, 3: { pnl: 383, tr: 4 }, 4: { pnl: 216, tr: 3 }, 5: { pnl: 90, tr: 4 },
    8: { pnl: 355, tr: 5 }, 9: { pnl: 426, tr: 3 }, 10: { pnl: -106, tr: 2 }, 11: { pnl: -91, tr: 4 },
    12: { pnl: -28, tr: 2 }, 15: { pnl: 338, tr: 2 }, 16: { pnl: 48, tr: 4 }, 17: { pnl: 96, tr: 3 },
    18: { pnl: 438, tr: 5 }, 22: { pnl: 93, tr: 5 }, 23: { pnl: 319, tr: 4 }, 24: { pnl: 380, tr: 5 },
    25: { pnl: 448, tr: 4 }, 26: { pnl: -270, tr: 5 }, 30: { pnl: 430, tr: 5 },
  };
  const MOCK_DAY_TRADES: DayTrade[] = [
    { time: '09:34', sym: 'ES', side: 'Long', qty: 2, pnl: 180 },
    { time: '10:12', sym: 'NQ', side: 'Short', qty: 1, pnl: -60 },
    { time: '11:48', sym: 'ES', side: 'Long', qty: 3, pnl: 240 },
  ];
  // A representative daily gross/net/take series for the /dev preview.
  const MOCK_SERIES: DailyPoint[] = [0, 800, 1600, 2100, 3000, 3500, 4300, 5200, 6000, 7200, 8100, 9400].map((g, i) => ({
    date: `2026-06-${String(i + 2).padStart(2, '0')}`,
    gross: g,
    net: Math.round(g * 0.94),
    take: Math.round(g * 0.78),
  }));

  interface Props {
    stats?: DashStat[];
    series?: DailyPoint[];
    dateRange?: string;
    monthLabel?: string;
    monthNet?: number;
    dayPnl?: Record<number, DayCell>;
    firstDow?: number;
    daysInMonth?: number;
    onscope?: (s: 'all' | 'month') => void;
    /** Click-a-day drill-in (parity with app/demo): the day's trades + its persistent journal note. */
    dayTrades?: (day: number) => DayTrade[];
    getNote?: (day: number) => string;
    onsavenote?: (day: number, text: string) => void;
  }
  let {
    stats = MOCK_STATS, series = MOCK_SERIES, dateRange = '2024-07-01 → 2026-06-30',
    monthLabel = 'June 2026', monthNet = 4016.5, dayPnl = MOCK_PNL, firstDow = 1, daysInMonth = 30, onscope,
    dayTrades = () => MOCK_DAY_TRADES, getNote = () => '', onsavenote,
  }: Props = $props();

  let scope = $state<'all' | 'month'>('all');
  const setScope = (s: 'all' | 'month') => { scope = s; onscope?.(s); };

  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const money = (n: number) => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString()}`;
  const cells = $derived.by<(number | null)[]>(() => {
    const c: (number | null)[] = [...Array.from({ length: firstDow }, () => null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
    while (c.length % 7 !== 0) c.push(null);
    return c;
  });

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
  let overlay = $state<SKey>('gross');
  let cursor = $state<number | null>(null);
  let cw = $state(0); // measured plot width (px) → viewBox width, so labels/dots aren't stretched
  const VH = 256;
  const PAD = { l: 48, r: 72, t: 12, b: 22 };
  const W = $derived(Math.max(560, cw || 900));
  const ser = $derived(SERIES.find(s => s.key === overlay) ?? SERIES[0]);

  const view = $derived.by(() => {
    if (!series.length) return null;
    const key = overlay;
    const pts: DailyPoint[] = [{ date: '', gross: 0, net: 0, take: 0 }, ...series];
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) {
      if (p[key] < lo) lo = p[key];
      if (p[key] > hi) hi = p[key];
    }
    const ticks = niceTicks(lo, hi, 4);
    lo = Math.min(lo, ticks[0]);
    hi = Math.max(hi, ticks[ticks.length - 1]);
    const span = hi - lo || 1;
    const x = (i: number) => PAD.l + (i / (pts.length - 1)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / span) * (VH - PAD.t - PAD.b);
    const d = linePath(pts.map(p => p[key]), x, y);
    const baseY = (VH - PAD.b).toFixed(1);
    const area = `${d} L${x(pts.length - 1).toFixed(1)},${baseY} L${x(0).toFixed(1)},${baseY} Z`;
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
    return { pts, x, y, len: pts.length, d, area, yticks, xticks, zeroY: lo <= 0 && hi >= 0 ? y(0) : null, endY: y(last[key]), endLabel: usdWhole(last[key]) };
  });
  const tip = $derived(view && cursor != null && view.pts[cursor]?.date ? `${view.pts[cursor].date} · ${ser.label} ${usd(view.pts[cursor][overlay])}` : '');

  function idxFromX(e: PointerEvent) {
    const v = view;
    if (!v) return null;
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const vbx = ((e.clientX - rect.left) / rect.width) * W;
    return Math.max(1, Math.min(v.len - 1, Math.round(((vbx - PAD.l) / (W - PAD.l - PAD.r)) * (v.len - 1))));
  }
  const moveCursor = (e: PointerEvent) => (cursor = idxFromX(e));
  function onCurveKey(e: KeyboardEvent) {
    if (!view || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const base = cursor == null ? view.len - 1 : cursor;
    cursor = Math.max(1, Math.min(view.len - 1, base + (e.key === 'ArrowRight' ? 1 : -1)));
  }
</script>

{#snippet moduleHeader(title: string)}
  <div class="flex items-center gap-2 border-b border-border px-4 py-2.5">
    <GripVertical class="size-4 cursor-grab text-muted-foreground" />
    <span class="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</span>
    <button type="button" class="ml-auto grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Module menu">
      <MoreHorizontal class="size-4" />
    </button>
  </div>
{/snippet}

{#snippet seg(active: boolean, label: string, onclick: () => void)}
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
    <div class="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {@render seg(scope === 'all', 'All time', () => setScope('all'))}
      {@render seg(scope === 'month', 'This month', () => setScope('month'))}
    </div>
    <Button variant="outline" size="sm">
      <SlidersHorizontal class="size-4" /> Filters
    </Button>
    <span class="ml-auto text-xs text-muted-foreground">{dateRange}</span>
  </div>

  <!-- KPI stat cards -->
  <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
    {#each stats as s (s.label)}
      <Card.Root class="p-4">
        <div class="flex items-start justify-between gap-2">
          <span class="text-xs text-muted-foreground">{s.label}</span>
          {#if s.badge}
            <Badge variant="outline" class={s.up ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}>{s.badge}</Badge>
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
      </Card.Root>
    {/each}
  </div>

  <!-- Performance module -->
  <Card.Root>
    {@render moduleHeader('Performance')}
    <Card.Content>
      <div class="mb-3 flex w-fit items-center gap-0.5 rounded-md border border-border p-0.5">
        {#each SERIES as s (s.key)}
          {@render seg(overlay === s.key, s.label, () => (overlay = s.key))}
        {/each}
      </div>
      <div bind:clientWidth={cw}>
        {#if view}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
          <svg
            viewBox="0 0 {W} {VH}"
            class="h-64 w-full touch-none outline-none"
            role="img"
            aria-label="Cumulative {ser.label} P&L curve"
            tabindex="0"
            onpointermove={moveCursor}
            onpointerleave={() => (cursor = null)}
            onkeydown={onCurveKey}
          >
            <defs>
              <linearGradient id="perfGross" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" class="[stop-color:var(--chart-2)] [stop-opacity:0.24]" /><stop offset="100%" class="[stop-color:var(--chart-2)] [stop-opacity:0]" /></linearGradient>
              <linearGradient id="perfNet" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" class="[stop-color:var(--primary)] [stop-opacity:0.2]" /><stop offset="100%" class="[stop-color:var(--primary)] [stop-opacity:0]" /></linearGradient>
              <linearGradient id="perfTake" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" class="[stop-color:var(--chart-3)] [stop-opacity:0.24]" /><stop offset="100%" class="[stop-color:var(--chart-3)] [stop-opacity:0]" /></linearGradient>
            </defs>
            {#each view.yticks as t, i (i)}
              <line x1={PAD.l} y1={t.y} x2={W - PAD.r} y2={t.y} class="stroke-border" stroke-width="1" vector-effect="non-scaling-stroke" />
              <text x={PAD.l - 6} y={t.y + 3.5} text-anchor="end" class="fill-muted-foreground text-[11px] tabular-nums">{t.label}</text>
            {/each}
            {#if view.zeroY != null}
              <line x1={PAD.l} y1={view.zeroY} x2={W - PAD.r} y2={view.zeroY} class="stroke-muted-foreground/50" stroke-width="1" vector-effect="non-scaling-stroke" />
            {/if}
            {#each view.xticks as t, i (i)}
              <text x={t.x} y={VH - 6} text-anchor="middle" class="fill-muted-foreground text-[10px] tabular-nums">{t.label}</text>
            {/each}
            <path d={view.area} fill="url(#{ser.grad})" />
            <path d={view.d} fill="none" class={ser.stroke} stroke-width="2" vector-effect="non-scaling-stroke" />
            <text x={W - PAD.r + 5} y={view.endY + 3.5} text-anchor="start" class={['text-[11px] font-medium tabular-nums', ser.fill]}>{view.endLabel}</text>
            {#if cursor != null}
              <line x1={view.x(cursor)} y1={PAD.t} x2={view.x(cursor)} y2={VH - PAD.b} class="stroke-muted-foreground" stroke-width="1" stroke-dasharray="3 3" vector-effect="non-scaling-stroke" />
              <circle cx={view.x(cursor)} cy={view.y(view.pts[cursor][overlay])} r="3.5" class={[ser.stroke, ser.fill]} vector-effect="non-scaling-stroke" />
            {/if}
          </svg>
          <div class="mt-1 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">{tip || 'Hover or arrow-key the curve for daily cumulative P&L'}</div>
        {:else}
          <p class="grid h-64 place-items-center text-sm text-muted-foreground">No trades in the selected range.</p>
        {/if}
      </div>
    </Card.Content>
  </Card.Root>

  <!-- Trading calendar module -->
  <Card.Root>
    {@render moduleHeader('Trading Calendar')}
    <Card.Content>
      <div class="mb-3 flex items-center justify-between">
        <span class="text-sm font-medium text-foreground">{monthLabel}</span>
        <span class={['text-sm tabular-nums', monthNet >= 0 ? 'text-chart-2' : 'text-destructive']}>{money(monthNet)}</span>
      </div>
      <div class="grid grid-cols-7 gap-1.5">
        {#each weekdays as d (d)}
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
                t
                  ? up
                    ? 'border-chart-2/30 bg-chart-2/10'
                    : 'border-destructive/30 bg-destructive/10'
                  : 'cursor-default border-border',
                selectedDay === day && 'ring-2 ring-primary',
              ]}
            >
              <span class="flex items-center gap-1 text-[11px] text-muted-foreground">
                {day}{#if getNote(day)}<span class="size-1.5 rounded-full bg-primary" title="Has a note"></span>{/if}
              </span>
              {#if t}
                <div class={['mt-1 text-right text-xs font-medium tabular-nums', up ? 'text-chart-2' : 'text-destructive']}>
                  {money(t.pnl)}
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
        <div class="mt-4 rounded-md border border-border bg-background p-4">
          <div class="mb-3 flex items-center justify-between">
            <span class="text-sm font-semibold text-foreground">
              {monthWord} {selectedDay}
              <span class={['ml-2 tabular-nums', t.pnl >= 0 ? 'text-chart-2' : 'text-destructive']}>{money(t.pnl)}</span>
              <span class="ml-2 text-xs font-normal text-muted-foreground">{t.tr} {t.tr === 1 ? 'trade' : 'trades'}</span>
            </span>
            <button type="button" class="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close day detail" onclick={() => (selectedDay = null)}>
              <X class="size-4" />
            </button>
          </div>
          <div class="grid gap-4 lg:grid-cols-2">
            <div class="overflow-hidden rounded-md border border-border">
              {#each selTrades as tr, i (i)}
                <div class={['flex items-center gap-2 px-2.5 py-1.5 text-xs', i > 0 && 'border-t border-border']}>
                  <span class="tabular-nums text-muted-foreground">{tr.time || '—'}</span>
                  <span class="font-medium">{tr.sym}</span>
                  <Badge variant="outline" class={tr.side === 'Long' ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}>{tr.side}</Badge>
                  <span class="text-muted-foreground">×{tr.qty}</span>
                  <span class={['ml-auto font-semibold tabular-nums', tr.pnl >= 0 ? 'text-chart-2' : 'text-destructive']}>{money(tr.pnl)}</span>
                </div>
              {:else}
                <div class="px-2.5 py-3 text-center text-xs text-muted-foreground">No intraday trades recorded.</div>
              {/each}
            </div>
            <div>
              <div class="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Journal note</div>
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
    </Card.Content>
  </Card.Root>

  <!-- Add-module affordance -->
  <button
    type="button"
    class="flex items-center justify-center gap-2 rounded-md border border-dashed border-border py-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
  >
    <Plus class="size-4" /> Add module
  </button>
</div>
