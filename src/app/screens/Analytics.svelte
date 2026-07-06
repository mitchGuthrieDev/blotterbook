<script lang="ts" module>
  export type { Kpi, DistBar, SignedBar, SymbolRow, TagRow, StatRow } from '../lib/analytics.ts';
  /** A197 histogram drill-down row — a light projection of the trades in a clicked P&L bucket. */
  export type BucketTrade = { date: string; time: string; sym: string; side: string; qty: number; pnl: number };
</script>

<script lang="ts">
  // Analytics surface (UI redesign; A197 interactivity pass). A curated grid of analytics modules
  // pairing the deeper compute() metrics with visual charts: a KPI highlights strip, P&L
  // distribution, drawdown (underwater) curve, time-of-day + day-of-week performance, per-symbol
  // and long/short breakdowns, and the full advanced-stats grid. All charts are inline SVG
  // (geometry attrs + fill-*/stroke-* utilities — no inline style, CSP-safe). Data comes from props
  // (the real analytics view-model, wired by App.svelte on all surfaces). Color only in the P&L data.
  //
  // A197: the modules are INTERACTIVE — symbol/tag rows, the long/short cards and the weekday bars
  // toggle the app-wide filter set (the same FilterState the Dashboard popover edits, so every
  // screen narrows together); active filters render as removable chips up top; the symbol/tag
  // tables expand past their top-N cut. Everything degrades to read-only when no filterModel
  // arrives (defensive — App always passes it).
  import { cn } from '$lib/utils';
  import { usd, usdWhole, DOW_LABEL } from '../../lib/core/core.ts';
  import { decimateMinMax } from '../../lib/core/curveseries.ts';
  import { X, ChevronUp, ArrowUpDown } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import StatCardRow, { type StatItem } from '../parts/StatCardRow.svelte';
  import InfoTip from '../parts/InfoTip.svelte';
  import type { Kpi, DistBar, SignedBar, SymbolRow, TagRow, StatRow } from '../lib/analytics.ts';
  import type { FilterModel, StatDetail } from './Dashboard.svelte';

  interface Props {
    kpis: Kpi[];
    dist: DistBar[];
    wins: number;
    losses: number;
    /** Scratch ($0) trades — excluded from the histogram + W/L bar; footnoted (A174). */
    scratch: number;
    curve: number[];
    maxDD: number;
    /** Null when the drawdown has no positive prior peak (inception drawdown — A170). */
    maxDDpct: number | null;
    /** A240: optional per-curve-point date labels — curveDates[k] aligns with curve[k] (curveDates[0]
     *  is the pre-trade origin, ''). When present the drawdown readout + max-DD callout show real
     *  dates; absent, they degrade to the trade index. Wire from App as `['', ...trades.map(t => t.date)]`. */
    curveDates?: string[];
    long: { pnl: number; n: number };
    short: { pnl: number; n: number };
    /** Trades excluded from the long/short split for lack of side info (A170). */
    unknownSide: number;
    hours: SignedBar[];
    wdays: SignedBar[];
    symbols: SymbolRow[];
    /** Per-tag breakdown + the disjoint untagged bucket (R17/A165). */
    byTag: TagRow[];
    untagged: TagRow | null;
    statRows: StatRow[];
    /** A197: the live app-wide filter set — drives the chips + click-to-filter interactions. */
    filterModel?: FilterModel;
    /** A176: fraction (0..1) of trades carrying hold times — capability footnote on the stats grid. */
    holdCoverage?: number;
    /** A197 drill-down: resolves a histogram bucket's [lo, hi) bounds to its matching trades
     *  (computed lazily by the app from the active trade list — only on click). */
    bucketTrades?: (lo: number | null, hi: number | null) => BucketTrade[];
  }
  let {
    kpis,
    dist,
    wins,
    losses,
    scratch,
    curve,
    maxDD,
    maxDDpct,
    curveDates,
    long,
    short,
    unknownSide,
    hours,
    wdays,
    symbols,
    byTag,
    untagged,
    statRows,
    filterModel,
    holdCoverage = 1,
    bucketTrades,
  }: Props = $props();

  const winShare = $derived(wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0);
  const longShare = $derived(long.n + short.n ? Math.round((long.n / (long.n + short.n)) * 100) : 0);

  // A197: the builder now returns FULL breakdowns — the screen owns the top-N cut + "show all".
  const SYM_CUT = 8,
    TAG_CUT = 10;
  let allSyms = $state(false);
  let allTags = $state(false);

  // ── A197 sortable columns: null col = the builder's |P&L| impact order; a header click sorts
  // the FULL breakdown (before the top-N cut) by that column, toggling direction on re-click. ──
  type SortCol = 'name' | 'trades' | 'win' | 'pnl';
  type Sort = { col: SortCol | null; dir: 1 | -1 };
  let symSort = $state<Sort>({ col: null, dir: -1 });
  let tagSort = $state<Sort>({ col: null, dir: -1 });
  const applySort = (s: Sort, col: SortCol): Sort =>
    s.col === col ? { col, dir: -s.dir as 1 | -1 } : { col, dir: col === 'name' ? 1 : -1 };
  function sortRows<T extends { trades: number; win: number; pnl: number }>(rows: T[], s: Sort, name: (r: T) => string): T[] {
    if (!s.col) return rows; // builder order (|P&L| desc)
    const { col, dir } = s;
    return [...rows].sort((a, b) => dir * (col === 'name' ? name(a).localeCompare(name(b)) : a[col] - b[col]));
  }
  const symSorted = $derived(sortRows(symbols, symSort, r => r.sym));
  const tagSorted = $derived(sortRows(byTag, tagSort, r => r.tag));
  const symShown = $derived(allSyms ? symSorted : symSorted.slice(0, SYM_CUT));
  const tagShown = $derived(allTags ? tagSorted : tagSorted.slice(0, TAG_CUT));
  const maxSym = $derived(Math.max(1, ...symShown.map(s => Math.abs(s.pnl))));
  const maxTag = $derived(Math.max(1, ...tagShown.map(r => Math.abs(r.pnl)), Math.abs(untagged?.pnl ?? 0)));

  // ── A197 histogram drill-down: a clicked bucket lists its matching trades (lazy via the
  // bucketTrades prop; re-derives with the live filter set; toggles off on re-click). ──
  const BUCKET_ROW_CAP = 12;
  let bucketSel = $state<number | null>(null);
  const bucketRows = $derived(bucketSel != null && bucketTrades ? bucketTrades(dist[bucketSel].lo, dist[bucketSel].hi) : []);

  // ── A197 click-to-filter: every interaction TOGGLES its field on the shared filter set ──
  const toggleRoot = (sym: string) => filterModel?.set({ root: filterModel.root === sym ? '' : sym });
  const toggleTag = (tag: string) => filterModel?.set({ tag: filterModel.tag === tag ? '' : tag });
  const toggleSide = (s: string) => filterModel?.set({ side: filterModel.side === s ? '' : s });
  const toggleDow = (i: number) =>
    filterModel?.set({ dows: filterModel.dows.includes(i) ? filterModel.dows.filter(d => d !== i) : [...filterModel.dows, i] });
  const toggleHour = (h: number) =>
    filterModel?.set({ hours: filterModel.hours.includes(h) ? filterModel.hours.filter(x => x !== h) : [...filterModel.hours, h] });

  // ── A197 quick date scoping: preset ranges write the shared from/to, so every screen narrows
  // together and the range shows up as a removable chip like any other filter. ──
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const RANGES = $derived.by(() => {
    const now = new Date();
    const daysAgo = (n: number) => iso(new Date(now.getTime() - n * 86_400_000));
    return [
      { label: '30D', from: daysAgo(30), to: '' },
      { label: '90D', from: daysAgo(90), to: '' },
      { label: 'YTD', from: `${now.getFullYear()}-01-01`, to: '' },
      { label: 'All', from: '', to: '' },
    ];
  });
  const rangeActive = (r: { from: string; to: string }) => filterModel?.from === r.from && (filterModel?.to || '') === r.to;

  // Active filters → removable chips (mirrors the Dashboard popover state, so the narrowing that
  // click-to-filter applies is always visible and reversible right here).
  type Chip = { key: string; label: string; clear: () => void };
  const chips = $derived.by<Chip[]>(() => {
    const f = filterModel;
    if (!f) return [];
    const out: Chip[] = [];
    if (f.root) out.push({ key: 'root', label: `Symbol ${f.root}`, clear: () => f.set({ root: '' }) });
    if (f.side) out.push({ key: 'side', label: f.side === 'long' ? 'Longs' : 'Shorts', clear: () => f.set({ side: '' }) });
    if (f.session) out.push({ key: 'session', label: `Session ${f.session}`, clear: () => f.set({ session: '' }) });
    if (f.tag) out.push({ key: 'tag', label: `Tag ${f.tag}`, clear: () => f.set({ tag: '' }) });
    if (f.from || f.to) out.push({ key: 'range', label: `${f.from || '…'} → ${f.to || '…'}`, clear: () => f.set({ from: '', to: '' }) });
    if (f.dows.length)
      out.push({
        key: 'dows',
        label: [...f.dows]
          .sort()
          .map(d => DOW_LABEL[d])
          .join(' · '),
        clear: () => f.set({ dows: [] }),
      });
    if (f.hours.length)
      out.push({
        key: 'hours',
        label: [...f.hours]
          .sort((a, b) => a - b)
          .map(h => `${String(h).padStart(2, '0')}h`)
          .join(' · '),
        clear: () => f.set({ hours: [] }),
      });
    return out;
  });

  // ── A238: the top KPI strip adopts the Dashboard's shared StatCardRow — same card grid, the
  // narrow-viewport swipe carousel, and the click-through drill-in. The 6 KPIs map to StatItem
  // (keyed by label), and a self-contained statDetail() explains each stat with figures already on
  // screen (the advanced-stats grid + the wins/losses/maxDD props) — no extra app wiring. ──
  const kpiStats = $derived<StatItem[]>(kpis.map(k => ({ key: k.label, label: k.label, value: k.value, tone: k.tone })));
  /** Look up an advanced-stats row's formatted value by its label (reuse of on-screen figures). */
  const statVal = (k: string): string => statRows.find(r => r.k === k)?.v ?? '—';
  function statDetail(key: string): StatDetail | null {
    const k = kpis.find(x => x.label === key);
    if (!k) return null;
    const head = { title: k.label, value: k.value, tone: k.tone };
    const netVal = () => kpis.find(x => x.label === 'Net P&L')?.value ?? usd(0);
    switch (key) {
      case 'Net P&L':
        return {
          ...head,
          desc: 'Total realized P&L across the filtered working set — the sum of every closed trade after the platform’s own commissions, before Blotterbook’s modeled costs.',
          rows: [
            { label: 'Winning trades', value: `${wins}`, tone: 'pos' },
            { label: 'Losing trades', value: `${losses}`, tone: 'neg' },
            { label: 'Scratch ($0)', value: `${scratch}` },
          ],
        };
      case 'Expectancy / trade':
        return {
          ...head,
          desc: 'The average P&L you can expect per trade — net P&L divided by the trade count. Positive means each trade adds edge on average.',
          rows: [
            { label: 'Average win', value: statVal('Average win'), tone: 'pos' },
            { label: 'Average loss', value: statVal('Average loss'), tone: 'neg' },
          ],
        };
      case 'Profit factor':
        return {
          ...head,
          desc: 'Gross profit divided by gross loss. Above 1.0 is net-profitable; 2.0 means you earn twice what you lose.',
          rows: [
            { label: 'Gross profit', value: statVal('Gross profit'), tone: 'pos' },
            { label: 'Gross loss', value: statVal('Gross loss'), tone: 'neg' },
          ],
        };
      case 'Payoff ratio':
        return {
          ...head,
          desc: 'Average winning trade divided by the average loser — how much bigger your wins are than your losses, independent of how often you win.',
          rows: [
            { label: 'Average win', value: statVal('Average win'), tone: 'pos' },
            { label: 'Average loss', value: statVal('Average loss'), tone: 'neg' },
          ],
        };
      case 'Sharpe (daily)':
        return {
          ...head,
          desc: 'Risk-adjusted return: mean daily P&L over its standard deviation. Computed on daily-P&L dispersion and NOT annualized; small samples are noisy.',
          rows: [
            { label: 'Per-trade std dev', value: statVal('Per-trade std dev') },
            { label: 'Sortino (daily)', value: statVal('Sortino (daily)') },
          ],
        };
      case 'Recovery factor':
        return {
          ...head,
          desc: 'Net P&L divided by the max drawdown — how many times over your worst peak-to-trough loss you’ve earned back.',
          rows: [
            { label: 'Max drawdown', value: maxDD > 0 ? `−${usdWhole(maxDD)}` : '$0', tone: 'neg' },
            { label: 'Net P&L', value: netVal() },
          ],
        };
      default:
        return { ...head, desc: '', rows: [] };
    }
  }

  // ── A240: interactive underwater (drawdown) module. Depth = running peak − equity at each closed
  // trade; the whole series is walked in a loop (not Math.max(...curve) — a large fills export would
  // overflow the call stack) and the SVG path is min/max-decimated to ~1.5k points (A223: extremes +
  // endpoints survive by construction). The walk also captures the max-drawdown span (peak→trough
  // curve indices) so the module can shade it and label its date range. ──
  const DD_W = 100,
    DD_H = 50;
  const ddMoney = (d: number): string => (d > 0 ? `−${usdWhole(d)}` : '$0');
  const ddDate = (i: number): string => curveDates?.[i] ?? '';
  const dd = $derived.by(() => {
    if (curve.length < 2) return null;
    let peak = curve[0],
      maxd = 0,
      peakIdx = 0,
      troughIdx = 0,
      runPeakIdx = 0;
    const depth = curve.map((v, i) => {
      if (v > peak) {
        peak = v;
        runPeakIdx = i;
      }
      const d = peak - v;
      if (d > maxd) {
        maxd = d;
        peakIdx = runPeakIdx;
        troughIdx = i;
      }
      return d;
    });
    const span = maxd || 1;
    const X = (i: number) => (i / (curve.length - 1)) * DD_W;
    const Y = (d: number) => 1 + (d / span) * (DD_H - 3);
    const pts = decimateMinMax(depth);
    const line = pts.map(([i, d], k) => `${k === 0 ? 'M' : 'L'}${X(i).toFixed(2)} ${Y(d).toFixed(2)}`).join(' ');
    return { depth, maxd, span, peakIdx, troughIdx, X, Y, line, area: `M0 0 ${line.replace(/^M/, 'L')} L${DD_W} 0 Z`, len: curve.length };
  });

  // Hover/tap/keyboard readout: a curve index → the drawdown depth (+ date) at that point. CSP-safe —
  // the crosshair is SVG geometry attributes (not CSS), the readout is plain reactive text.
  let ddCursor = $state<number | null>(null);
  $effect(() => {
    if (dd && ddCursor != null && ddCursor > dd.len - 1) ddCursor = null;
  });
  function ddIdxFromX(e: PointerEvent): number | null {
    const d = dd;
    if (!d) return null;
    const rect = (e.currentTarget as Element).getBoundingClientRect();
    const frac = rect.width ? (e.clientX - rect.left) / rect.width : 0;
    return Math.max(0, Math.min(d.len - 1, Math.round(frac * (d.len - 1))));
  }
  const moveDdCursor = (e: PointerEvent) => (ddCursor = ddIdxFromX(e));
  function ddKey(e: KeyboardEvent) {
    if (!dd || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const base = ddCursor ?? dd.troughIdx;
    ddCursor = Math.max(0, Math.min(dd.len - 1, base + (e.key === 'ArrowRight' ? 1 : -1)));
  }
  const ddReadout = $derived(dd && ddCursor != null ? { depth: dd.depth[ddCursor], date: ddDate(ddCursor), idx: ddCursor } : null);
  const ddPeakDate = $derived(dd ? ddDate(dd.peakIdx) : '');
  const ddTroughDate = $derived(dd ? ddDate(dd.troughIdx) : '');
</script>

{#snippet head(title: string)}
  <div class="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
{/snippet}

{#snippet countBars(items: DistBar[], onbar?: (i: number) => void, activeBar?: number | null)}
  {@const max = Math.max(1, ...items.map(d => d.value))}
  {@const step = 100 / items.length}
  <svg viewBox="0 0 100 60" class="h-32 w-full" preserveAspectRatio="none" aria-hidden="true">
    {#each items as d, i (i)}
      {@const bw = step * 0.62}
      {@const h = (d.value / max) * 56}
      <!-- A197: bars are clickable when a drill-down handler arrives. The whole SVG is aria-hidden
           (decorative), so the bucket labels below are the keyboard/AT triggers — the rect click is
           a pointer-only convenience, hence the a11y ignores. -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <rect
        x={i * step + (step - bw) / 2}
        y={58 - h}
        width={bw}
        height={h}
        class={cn(
          d.neg ? 'fill-destructive' : 'fill-chart-2',
          onbar && 'cursor-pointer',
          onbar && activeBar != null && activeBar !== i && 'opacity-40'
        )}
        onclick={onbar ? () => onbar(i) : undefined}
      />
    {/each}
  </svg>
  <div class="mt-1 flex justify-between text-[9px] text-muted-foreground">
    {#each items as d, i (d.label)}
      {#if onbar}
        <button
          type="button"
          class={cn(
            'rounded px-0.5 hover:bg-accent hover:text-foreground',
            activeBar === i && 'bg-secondary font-semibold text-foreground'
          )}
          aria-pressed={activeBar === i}
          title={activeBar === i ? 'Hide these trades' : `Show the ${d.label} trades`}
          onclick={() => onbar(i)}>{d.label}</button
        >
      {:else}
        <span>{d.label}</span>
      {/if}
    {/each}
  </div>
{/snippet}

{#snippet sortBtn(label: string, col: 'name' | 'trades' | 'win' | 'pnl', sort: { col: string | null; dir: 1 | -1 }, onsort: () => void, cls = '')}
  <!-- A197: column-sort control (Blotter's sort affordance — chevron flips for desc). -->
  <button
    type="button"
    class={cn(
      'flex items-center gap-0.5 whitespace-nowrap hover:text-foreground',
      sort.col === col && 'font-semibold text-foreground',
      cls
    )}
    aria-pressed={sort.col === col}
    title="Sort by {label}"
    onclick={onsort}
  >
    {label}
    {#if sort.col === col}<ChevronUp class={cn('size-3', sort.dir === -1 && 'rotate-180')} />{:else}<ArrowUpDown
        class="size-3 opacity-40"
      />{/if}
  </button>
{/snippet}

{#snippet signedBars(items: SignedBar[], onbar?: (key: number) => void, activeKeys?: number[])}
  {@const max = Math.max(1, ...items.map(d => Math.abs(d.value)))}
  {@const step = 100 / Math.max(1, items.length)}
  <svg viewBox="0 0 100 60" class="h-32 w-full" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" y1="30" x2="100" y2="30" class="stroke-border" stroke-width="0.5" />
    {#each items as d, i (i)}
      {@const bw = step * 0.55}
      {@const h = (Math.abs(d.value) / max) * 26}
      <rect
        x={i * step + (step - bw) / 2}
        y={d.value >= 0 ? 30 - h : 30}
        width={bw}
        height={h}
        class={d.value >= 0 ? 'fill-chart-2' : 'fill-destructive'}
      />
    {/each}
  </svg>
  <div class="mt-1 flex justify-between text-[10px] text-muted-foreground">
    {#each items as d (d.label)}
      {#if onbar && d.key != null}
        <!-- A197: filterable buckets (weekdays) — the label toggles that bucket on the shared filter set -->
        <button
          type="button"
          class={cn(
            'rounded px-1 hover:bg-accent hover:text-foreground',
            activeKeys?.includes(d.key) && 'bg-secondary font-semibold text-foreground'
          )}
          aria-pressed={activeKeys?.includes(d.key) ?? false}
          onclick={() => onbar(d.key as number)}>{d.label}</button
        >
      {:else}
        <span>{d.label}</span>
      {/if}
    {/each}
  </div>
{/snippet}

<div class="flex flex-col gap-4">
  <!-- A197: quick date scoping — presets write the shared from/to so every screen narrows together. -->
  {#if filterModel}
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-muted-foreground">Range:</span>
      {#each RANGES as r (r.label)}
        <button
          type="button"
          class={cn(
            'rounded-md border border-border px-2 py-0.5 font-medium hover:bg-accent',
            rangeActive(r) && 'border-ring bg-secondary'
          )}
          aria-pressed={rangeActive(r)}
          title={r.from ? `Trades since ${r.from}` : 'All dates'}
          onclick={() => filterModel?.set({ from: r.from, to: r.to })}>{r.label}</button
        >
      {/each}
    </div>
  {/if}

  <!-- A197: active-filter chips — the narrowing applied by click-to-filter (or the Dashboard
       popover) is visible and reversible right here. -->
  {#if chips.length}
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-muted-foreground">Filtered:</span>
      {#each chips as c (c.key)}
        <button
          type="button"
          class="flex items-center gap-1 rounded-md border border-border bg-secondary px-2 py-0.5 font-medium hover:bg-accent"
          aria-label={`Remove filter: ${c.label}`}
          onclick={c.clear}
        >
          {c.label}
          <X class="size-3 text-muted-foreground" />
        </button>
      {/each}
      <button
        type="button"
        class="rounded px-1.5 py-0.5 text-muted-foreground underline hover:text-foreground"
        onclick={() => filterModel?.clear()}>Clear all</button
      >
    </div>
  {/if}

  <!-- KPI highlights — A238: the shared StatCardRow (mobile swipe carousel + click-through drill-in,
       parity with the Dashboard). Distinct carousel label so locators don't collide with Dashboard's. -->
  <StatCardRow stats={kpiStats} label="Analytics stats" gridClass="grid gap-4 sm:grid-cols-3 lg:grid-cols-6" detail={statDetail} />

  <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
    <!-- Distribution -->
    <Card.Root class="lg:col-span-2">
      {@render head('P&L distribution (per trade)')}
      <Card.Content>
        {@render countBars(dist, bucketTrades ? i => (bucketSel = bucketSel === i ? null : i) : undefined, bucketSel)}
        {#if bucketSel != null}
          <!-- A197 drill-down: the clicked bucket's matching trades (live — re-narrows with the filter set) -->
          <div class="mt-3 rounded-md border border-border bg-background p-3">
            <div class="flex items-center justify-between text-xs">
              <span class="font-semibold">
                {dist[bucketSel].label} — {bucketRows.length} trade{bucketRows.length === 1 ? '' : 's'}
              </span>
              <button
                type="button"
                class="relative grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']"
                aria-label="Close bucket detail"
                onclick={() => (bucketSel = null)}><X class="size-3" /></button
              >
            </div>
            {#if bucketRows.length}
              <div class="mt-2 space-y-0.5">
                {#each bucketRows.slice(0, BUCKET_ROW_CAP) as t, i (i)}
                  <div class="flex items-center gap-3 text-xs tabular-nums">
                    <span class="w-20 text-muted-foreground">{t.date}</span>
                    <span class="w-10 text-muted-foreground">{t.time}</span>
                    <span class="w-12 font-medium">{t.sym}</span>
                    <span class="w-12 text-muted-foreground">{t.side}</span>
                    <span class="w-10 text-right text-muted-foreground">×{t.qty}</span>
                    <span class={cn('flex-1 text-right font-semibold', t.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}>{usd(t.pnl)}</span
                    >
                  </div>
                {/each}
              </div>
              {#if bucketRows.length > BUCKET_ROW_CAP}
                <p class="mt-2 text-[11px] text-muted-foreground">
                  …and {bucketRows.length - BUCKET_ROW_CAP} more — the Blotter shows the full list (filter it to match).
                </p>
              {/if}
            {:else}
              <p class="mt-2 text-[11px] text-muted-foreground">No trades in this bucket under the current filters.</p>
            {/if}
          </div>
        {/if}
        <div class="mt-3 flex items-center gap-4 text-xs">
          <span class="text-muted-foreground">Win / loss</span>
          <div class="flex h-2 flex-1 overflow-hidden rounded-full">
            <svg viewBox="0 0 100 8" class="h-2 w-full" preserveAspectRatio="none" aria-hidden="true">
              <rect x="0" y="0" width={winShare} height="8" class="fill-chart-2" />
              <rect x={winShare} y="0" width={100 - winShare} height="8" class="fill-destructive" />
            </svg>
          </div>
          <span class="tabular-nums text-chart-2">{wins}W</span>
          <span class="tabular-nums text-destructive">{losses}L</span>
        </div>
        {#if scratch > 0}
          <p class="mt-2 text-[11px] text-muted-foreground">
            {scratch} scratch trade{scratch === 1 ? '' : 's'} ($0) excluded from the chart and the win/loss bar; the Win rate stat counts them
            in its denominator.
          </p>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- Drawdown — A240: interactive underwater chart. Explainer popover, hover/tap/keyboard readout
         (CSP-safe SVG-geometry crosshair), a shaded max-drawdown span, its dated callout, and axes. -->
    <Card.Root>
      <div class="flex items-center justify-between border-b border-border pr-2 pl-4">
        <span class="py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Drawdown (underwater)</span>
        <InfoTip title="Reading this chart" align="end">
          This is an underwater chart: it plots how far your equity sits <strong>below its highest prior peak</strong>, in dollars, at each
          closed trade. The top line (0) means you’re at a new high; the curve dips as losses pull you under that peak and climbs back as
          you recover. Computed on the filtered working set, so it narrows with your active filters. The shaded band marks the deepest
          peak-to-trough stretch — your max drawdown.
        </InfoTip>
      </div>
      <Card.Content>
        {#if dd}
          <div class="flex gap-2">
            <!-- y-axis: 0 (at peak) at top → the deepest drawdown at the bottom -->
            <div class="flex w-14 shrink-0 flex-col justify-between py-0.5 text-right text-[9px] tabular-nums text-muted-foreground">
              <span>$0</span>
              <span class="text-destructive">{ddMoney(dd.maxd)}</span>
            </div>
            <div class="min-w-0 flex-1">
              <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
              <svg
                viewBox="0 0 100 50"
                class="h-32 w-full cursor-crosshair touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
                preserveAspectRatio="none"
                role="img"
                aria-label="Drawdown-from-peak curve — hover, tap, or use arrow keys to read the drawdown at any point"
                tabindex="0"
                onpointerdown={moveDdCursor}
                onpointermove={moveDdCursor}
                onpointerleave={() => (ddCursor = null)}
                onkeydown={ddKey}
              >
                <!-- gridlines: the 0/peak line (solid) + a dashed mid reference -->
                <line x1="0" y1="0.5" x2="100" y2="0.5" class="stroke-border" stroke-width="0.5" vector-effect="non-scaling-stroke" />
                <line
                  x1="0"
                  y1="25"
                  x2="100"
                  y2="25"
                  class="stroke-border"
                  stroke-width="0.5"
                  stroke-dasharray="1.5 1.5"
                  vector-effect="non-scaling-stroke"
                />
                <!-- max-drawdown peak→trough span shading -->
                {#if dd.troughIdx > dd.peakIdx}
                  <rect x={dd.X(dd.peakIdx)} y="0" width={dd.X(dd.troughIdx) - dd.X(dd.peakIdx)} height="50" class="fill-destructive/10" />
                {/if}
                <path d={dd.area} class="fill-destructive/20" />
                <path d={dd.line} fill="none" class="stroke-destructive" stroke-width="0.7" vector-effect="non-scaling-stroke" />
                <!-- trough marker (deepest point) -->
                <line
                  x1={dd.X(dd.troughIdx)}
                  y1="0"
                  x2={dd.X(dd.troughIdx)}
                  y2="50"
                  class="stroke-destructive"
                  stroke-width="0.5"
                  stroke-dasharray="1.5 1.5"
                  vector-effect="non-scaling-stroke"
                />
                <!-- hover/tap/keyboard crosshair (SVG geometry — CSP-safe, no CSS) -->
                {#if ddCursor != null}
                  <line
                    x1={dd.X(ddCursor)}
                    y1="0"
                    x2={dd.X(ddCursor)}
                    y2="50"
                    class="stroke-foreground"
                    stroke-width="0.6"
                    vector-effect="non-scaling-stroke"
                  />
                  <rect x={dd.X(ddCursor) - 0.7} y={dd.Y(dd.depth[ddCursor]) - 1} width="1.4" height="2" class="fill-foreground" />
                {/if}
              </svg>
              <!-- x-axis: first → last point (dates when wired, else generic) -->
              <div class="mt-1 flex justify-between text-[9px] text-muted-foreground tabular-nums">
                <span>{ddDate(1) || 'start'}</span>
                <span>{ddDate(dd.len - 1) || 'latest'}</span>
              </div>
            </div>
          </div>

          <!-- Nearest-point readout -->
          {#if ddReadout}
            <div class="mt-2 text-xs tabular-nums">
              <span class="text-muted-foreground">At {ddReadout.date || `trade ${ddReadout.idx}`}:</span>
              <span class="ml-1 font-semibold text-destructive">{ddMoney(ddReadout.depth)}</span>
              <span class="text-muted-foreground">below peak</span>
            </div>
          {:else}
            <p class="mt-2 text-[11px] text-muted-foreground">Hover, tap, or press ←/→ on the chart to read the drawdown at any point.</p>
          {/if}

          <!-- Max-drawdown callout with its date/trade range -->
          <div class="mt-3 rounded-md border border-border bg-background p-2.5 text-xs">
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground">Max drawdown</span>
              <span class="font-semibold tabular-nums text-destructive">
                {ddMoney(dd.maxd)}{maxDDpct != null ? ` · ${maxDDpct.toFixed(1)}% of peak` : ''}
              </span>
            </div>
            <div class="mt-1 text-[11px] text-muted-foreground">
              {#if ddPeakDate && ddTroughDate}
                Peak {ddPeakDate} → trough {ddTroughDate}{dd.troughIdx > dd.peakIdx
                  ? ` · ${dd.troughIdx - dd.peakIdx} trade${dd.troughIdx - dd.peakIdx === 1 ? '' : 's'}`
                  : ''}
              {:else if dd.troughIdx > dd.peakIdx}
                Over {dd.troughIdx - dd.peakIdx} trade{dd.troughIdx - dd.peakIdx === 1 ? '' : 's'} from the prior equity peak to the trough{maxDDpct ==
                null
                  ? ' (no positive prior peak)'
                  : ''}
              {:else}
                No drawdown yet — equity is at its high.
              {/if}
            </div>
          </div>
        {:else}
          <p class="text-xs text-muted-foreground">Not enough trades to chart a drawdown yet.</p>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- Long vs Short -->
    <Card.Root>
      {@render head('Long vs short')}
      <Card.Content>
        <!-- A197: the cards toggle the app-wide side filter -->
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class={cn(
              'rounded-md border border-border bg-background px-3 py-2 text-left hover:border-ring hover:bg-accent',
              filterModel?.side === 'long' && 'border-ring bg-secondary'
            )}
            aria-pressed={filterModel?.side === 'long'}
            onclick={() => toggleSide('long')}
          >
            <div class="text-[11px] text-muted-foreground">Long · {long.n}</div>
            <div class={cn('mt-0.5 text-sm font-semibold tabular-nums', long.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}>
              {usdWhole(long.pnl)}
            </div>
          </button>
          <button
            type="button"
            class={cn(
              'rounded-md border border-border bg-background px-3 py-2 text-left hover:border-ring hover:bg-accent',
              filterModel?.side === 'short' && 'border-ring bg-secondary'
            )}
            aria-pressed={filterModel?.side === 'short'}
            onclick={() => toggleSide('short')}
          >
            <div class="text-[11px] text-muted-foreground">Short · {short.n}</div>
            <div class={cn('mt-0.5 text-sm font-semibold tabular-nums', short.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}>
              {usdWhole(short.pnl)}
            </div>
          </button>
        </div>
        <svg viewBox="0 0 100 8" class="mt-3 h-2 w-full" preserveAspectRatio="none" aria-hidden="true">
          <rect x="0" y="0" width={longShare} height="8" class="fill-chart-2" />
          <rect x={longShare} y="0" width={100 - longShare} height="8" class="fill-chart-1" />
        </svg>
        <div class="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{longShare}% long</span><span>{100 - longShare}% short</span>
        </div>
        {#if unknownSide > 0}
          <p class="mt-2 text-[11px] text-muted-foreground">
            {unknownSide} trade{unknownSide === 1 ? '' : 's'} without side info excluded from this split.
          </p>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- Time of day (A197: labels toggle the hour filter; coverage-gated per A176) -->
    <Card.Root>
      {@render head('Avg P&L by hour')}
      <Card.Content>
        {#if hours.length}
          {@render signedBars(hours, filterModel ? toggleHour : undefined, filterModel?.hours)}
        {:else}
          <!-- A176-class capability note: name what unlocks the missing data instead of an empty chart -->
          <p class="text-xs text-muted-foreground">
            No time-of-day data in this dataset — fills-based exports carry trade timestamps (e.g. TradingView’s order-history export;
            balance history has P&L only). Import one alongside your existing files and overlapping trades merge.
          </p>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- Day of week (A197: labels toggle the weekday filter) -->
    <Card.Root>
      {@render head('Avg P&L by weekday')}
      <Card.Content>{@render signedBars(wdays, filterModel ? toggleDow : undefined, filterModel?.dows)}</Card.Content>
    </Card.Root>

    <!-- Per-symbol (A197: rows toggle the symbol filter; show-all past the top cut) -->
    <Card.Root class="lg:col-span-2">
      {@render head('Performance by symbol')}
      <Card.Content class="space-y-1">
        <!-- A197: sortable columns — default is the builder's impact (|P&L|) order -->
        <div class="-mx-1 flex items-center gap-3 px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {@render sortBtn('Sym', 'name', symSort, () => (symSort = applySort(symSort, 'name')), 'w-10')}
          <span class="flex w-28 items-center gap-2">
            {@render sortBtn('Trades', 'trades', symSort, () => (symSort = applySort(symSort, 'trades')))}
            {@render sortBtn('Win', 'win', symSort, () => (symSort = applySort(symSort, 'win')))}
          </span>
          <span class="flex-1"></span>
          {@render sortBtn('P&L', 'pnl', symSort, () => (symSort = applySort(symSort, 'pnl')), 'w-20 justify-end')}
        </div>
        {#each symShown as s (s.sym)}
          <button
            type="button"
            class={cn(
              '-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-3 rounded px-1 py-0.5 text-xs hover:bg-accent',
              filterModel?.root === s.sym && 'bg-secondary'
            )}
            aria-pressed={filterModel?.root === s.sym}
            title={filterModel?.root === s.sym ? 'Clear the symbol filter' : `Filter every screen to ${s.sym}`}
            onclick={() => toggleRoot(s.sym)}
          >
            <span class="w-10 text-left font-medium">{s.sym}</span>
            <span class="w-28 text-left text-muted-foreground">{s.trades} tr · {s.win}%</span>
            <svg viewBox="0 0 100 8" class="h-2 flex-1" preserveAspectRatio="none" aria-hidden="true">
              <rect x="0" y="0" width="100" height="8" class="fill-secondary" />
              <rect
                x="0"
                y="0"
                width={Math.round((Math.abs(s.pnl) / maxSym) * 100)}
                height="8"
                class={s.pnl >= 0 ? 'fill-chart-2' : 'fill-destructive'}
              />
            </svg>
            <span class={cn('w-20 text-right font-semibold tabular-nums', s.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}
              >{usdWhole(s.pnl)}</span
            >
          </button>
        {/each}
        {#if symbols.length > SYM_CUT}
          <button
            type="button"
            class="pt-1 text-[11px] text-muted-foreground underline hover:text-foreground"
            onclick={() => (allSyms = !allSyms)}
          >
            {allSyms ? `Show top ${SYM_CUT}` : `Show all ${symbols.length} symbols`}
          </button>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- Per-tag (R17/A165) — the untagged bucket doubles as tag coverage -->
    <Card.Root class="lg:col-span-2">
      {@render head('Performance by tag')}
      <Card.Content class="space-y-2">
        {#if byTag.length}
          <!-- A197: sortable columns — default is the builder's impact (|P&L|) order -->
          <div class="-mx-1 flex items-center gap-3 px-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {@render sortBtn('Tag', 'name', tagSort, () => (tagSort = applySort(tagSort, 'name')), 'w-24')}
            <span class="flex w-28 items-center gap-2">
              {@render sortBtn('Trades', 'trades', tagSort, () => (tagSort = applySort(tagSort, 'trades')))}
              {@render sortBtn('Win', 'win', tagSort, () => (tagSort = applySort(tagSort, 'win')))}
            </span>
            <span class="flex-1"></span>
            {@render sortBtn('P&L', 'pnl', tagSort, () => (tagSort = applySort(tagSort, 'pnl')), 'w-20 justify-end')}
          </div>
          {#each tagShown as r (r.tag)}
            <button
              type="button"
              class={cn(
                '-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-3 rounded px-1 py-0.5 text-xs hover:bg-accent',
                filterModel?.tag === r.tag && 'bg-secondary'
              )}
              aria-pressed={filterModel?.tag === r.tag}
              title={filterModel?.tag === r.tag ? 'Clear the tag filter' : `Filter every screen to “${r.tag}”`}
              onclick={() => toggleTag(r.tag)}
            >
              <span class="w-24 truncate text-left font-medium" title={r.tag}>{r.tag}</span>
              <span class="w-28 text-left text-muted-foreground">{r.trades} tr · {r.win}%</span>
              <svg viewBox="0 0 100 8" class="h-2 flex-1" preserveAspectRatio="none" aria-hidden="true">
                <rect x="0" y="0" width="100" height="8" class="fill-secondary" />
                <rect
                  x="0"
                  y="0"
                  width={Math.round((Math.abs(r.pnl) / maxTag) * 100)}
                  height="8"
                  class={r.pnl >= 0 ? 'fill-chart-2' : 'fill-destructive'}
                />
              </svg>
              <span class={cn('w-20 text-right font-semibold tabular-nums', r.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}
                >{usdWhole(r.pnl)}</span
              >
            </button>
          {/each}
          {#if byTag.length > TAG_CUT}
            <button
              type="button"
              class="text-[11px] text-muted-foreground underline hover:text-foreground"
              onclick={() => (allTags = !allTags)}
            >
              {allTags ? `Show top ${TAG_CUT}` : `Show all ${byTag.length} tags`}
            </button>
          {/if}
          {#if untagged}
            <div class="flex items-center gap-3 border-t border-border pt-2 text-xs">
              <span class="w-24 truncate text-muted-foreground">untagged</span>
              <span class="w-28 text-muted-foreground">{untagged.trades} tr · {untagged.win}%</span>
              <svg viewBox="0 0 100 8" class="h-2 flex-1" preserveAspectRatio="none" aria-hidden="true">
                <rect x="0" y="0" width="100" height="8" class="fill-secondary" />
                <rect x="0" y="0" width={Math.round((Math.abs(untagged.pnl) / maxTag) * 100)} height="8" class="fill-chart-1" />
              </svg>
              <span class="w-20 text-right font-semibold tabular-nums text-muted-foreground">{usdWhole(untagged.pnl)}</span>
            </div>
          {/if}
          <p class="text-[11px] text-muted-foreground">
            A trade with several tags counts once per tag; “untagged” is the disjoint remainder — your tag coverage.
          </p>
        {:else}
          <p class="text-xs text-muted-foreground">
            No tags yet — tag trades in the Blotter or Trade Editor to see per-tag performance{untagged
              ? ` (${untagged.trades} trades untagged)`
              : ''}.
          </p>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- Full advanced stats grid -->
    <Card.Root class="lg:col-span-2">
      {@render head('Advanced statistics')}
      <Card.Content>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-0">
          {#each statRows as r (r.k)}
            <div class="flex items-baseline justify-between gap-3 border-b border-border py-[7px]">
              <span class="text-xs text-muted-foreground">{r.k}</span>
              <span
                class={cn(
                  'text-[13px] font-bold tabular-nums whitespace-nowrap',
                  r.tone === 'pos' ? 'text-chart-2' : r.tone === 'neg' ? 'text-destructive' : 'text-foreground'
                )}>{r.v}</span
              >
            </div>
          {/each}
        </div>
        {#if holdCoverage < 0.995}
          <!-- A176: dataset-level capability note — name what unlocks the missing data -->
          <p class="mt-2 text-[11px] text-muted-foreground">
            {holdCoverage <= 0.005 ? 'No hold-time data in this dataset' : `Hold times cover ${Math.round(holdCoverage * 100)}% of trades`} —
            fills-based exports provide them (e.g. TradingView’s order-history export; balance history carries P&L only). Importing one alongside
            your existing files fills the gap: overlapping trades merge.
          </p>
        {/if}
      </Card.Content>
    </Card.Root>
  </div>
</div>
