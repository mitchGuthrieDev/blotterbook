<script lang="ts" module>
  export type { Kpi, DistBar, SignedBar, SymbolRow, TagRow, StatRow } from '../lib/analytics.ts';
</script>

<script lang="ts">
  // Analytics surface (UI redesign). A curated, fixed grid of analytics modules pairing the deeper
  // compute() metrics with visual charts: a KPI highlights strip, P&L distribution, drawdown
  // (underwater) curve, time-of-day + day-of-week performance, per-symbol and long/short breakdowns,
  // and the full advanced-stats grid. All charts are inline SVG (geometry attrs + fill-*/stroke-*
  // utilities — no inline style, CSP-safe). Data comes from props (the real analytics view-model,
  // wired by App.svelte on all surfaces). Color only in the P&L data.
  import { cn } from '$lib/utils';
  import { usdWhole } from '../../lib/core/core.ts';
  import * as Card from '$lib/components/ui/card';
  import type { Kpi, DistBar, SignedBar, SymbolRow, TagRow, StatRow } from '../lib/analytics.ts';

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
    long,
    short,
    unknownSide,
    hours,
    wdays,
    symbols,
    byTag,
    untagged,
    statRows,
  }: Props = $props();

  const winShare = $derived(wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0);
  const longShare = $derived(long.n + short.n ? Math.round((long.n / (long.n + short.n)) * 100) : 0);
  const maxSym = $derived(Math.max(1, ...symbols.map(s => Math.abs(s.pnl))));
  const maxTag = $derived(Math.max(1, ...byTag.map(r => Math.abs(r.pnl)), Math.abs(untagged?.pnl ?? 0)));

  // Underwater (drawdown) series from the equity curve: depth = running peak − equity, normalized.
  // Uses a loop (not Math.max(...curve)) so a large fills export can't overflow the call stack.
  const ddPath = $derived.by(() => {
    if (curve.length < 2) return { area: '', line: '' };
    let peak = curve[0],
      maxd = 0;
    const depth = curve.map(v => {
      if (v > peak) peak = v;
      const d = peak - v;
      if (d > maxd) maxd = d;
      return d;
    });
    const span = maxd || 1;
    const W = 100,
      H = 50;
    const X = (i: number) => (i / (curve.length - 1)) * W;
    const Y = (d: number) => 1 + (d / span) * (H - 3);
    const line = depth.map((d, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(2)} ${Y(d).toFixed(2)}`).join(' ');
    return { line, area: `M0 0 ${line.replace(/^M/, 'L')} L${W} 0 Z` };
  });
</script>

{#snippet head(title: string)}
  <div class="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
{/snippet}

{#snippet countBars(items: DistBar[])}
  {@const max = Math.max(1, ...items.map(d => d.value))}
  {@const step = 100 / items.length}
  <svg viewBox="0 0 100 60" class="h-32 w-full" preserveAspectRatio="none" aria-hidden="true">
    {#each items as d, i (i)}
      {@const bw = step * 0.62}
      {@const h = (d.value / max) * 56}
      <rect x={i * step + (step - bw) / 2} y={58 - h} width={bw} height={h} class={d.neg ? 'fill-destructive' : 'fill-chart-2'} />
    {/each}
  </svg>
  <div class="mt-1 flex justify-between text-[9px] text-muted-foreground">
    {#each items as d (d.label)}<span>{d.label}</span>{/each}
  </div>
{/snippet}

{#snippet signedBars(items: SignedBar[])}
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
    {#each items as d (d.label)}<span>{d.label}</span>{/each}
  </div>
{/snippet}

<div class="flex flex-col gap-4">
  <!-- KPI highlights -->
  <div class="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
    {#each kpis as k (k.label)}
      <Card.Root class="p-4">
        <div class="text-xs text-muted-foreground">{k.label}</div>
        <div
          class={cn(
            'mt-1 text-xl font-semibold tabular-nums',
            k.tone === 'pos' ? 'text-chart-2' : k.tone === 'neg' ? 'text-destructive' : 'text-foreground'
          )}
        >
          {k.value}
        </div>
      </Card.Root>
    {/each}
  </div>

  <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
    <!-- Distribution -->
    <Card.Root class="lg:col-span-2">
      {@render head('P&L distribution (per trade)')}
      <Card.Content>
        {@render countBars(dist)}
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

    <!-- Drawdown -->
    <Card.Root>
      {@render head('Drawdown (underwater)')}
      <Card.Content>
        <svg viewBox="0 0 100 50" class="h-32 w-full" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="0.5" x2="100" y2="0.5" class="stroke-border" stroke-width="0.5" />
          <path d={ddPath.area} class="fill-destructive/20" />
          <path d={ddPath.line} fill="none" class="stroke-destructive" stroke-width="0.7" />
        </svg>
        <div class="mt-2 flex justify-between text-[11px] text-muted-foreground">
          <span>Max drawdown <span class="text-destructive">{maxDD > 0 ? `-${usdWhole(maxDD).slice(1)}` : '$0'}</span></span>
          <span>{maxDDpct != null ? `${maxDDpct.toFixed(1)}% of peak` : 'from inception (no prior peak)'}</span>
        </div>
      </Card.Content>
    </Card.Root>

    <!-- Long vs Short -->
    <Card.Root>
      {@render head('Long vs short')}
      <Card.Content>
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded-md border border-border bg-background px-3 py-2">
            <div class="text-[11px] text-muted-foreground">Long · {long.n}</div>
            <div class={cn('mt-0.5 text-sm font-semibold tabular-nums', long.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}>
              {usdWhole(long.pnl)}
            </div>
          </div>
          <div class="rounded-md border border-border bg-background px-3 py-2">
            <div class="text-[11px] text-muted-foreground">Short · {short.n}</div>
            <div class={cn('mt-0.5 text-sm font-semibold tabular-nums', short.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}>
              {usdWhole(short.pnl)}
            </div>
          </div>
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

    <!-- Time of day -->
    <Card.Root>
      {@render head('Avg P&L by hour')}
      <Card.Content>{@render signedBars(hours)}</Card.Content>
    </Card.Root>

    <!-- Day of week -->
    <Card.Root>
      {@render head('Avg P&L by weekday')}
      <Card.Content>{@render signedBars(wdays)}</Card.Content>
    </Card.Root>

    <!-- Per-symbol -->
    <Card.Root class="lg:col-span-2">
      {@render head('Performance by symbol')}
      <Card.Content class="space-y-2">
        {#each symbols as s (s.sym)}
          <div class="flex items-center gap-3 text-xs">
            <span class="w-10 font-medium">{s.sym}</span>
            <span class="w-28 text-muted-foreground">{s.trades} tr · {s.win}%</span>
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
          </div>
        {/each}
      </Card.Content>
    </Card.Root>

    <!-- Per-tag (R17/A165) — the untagged bucket doubles as tag coverage -->
    <Card.Root class="lg:col-span-2">
      {@render head('Performance by tag')}
      <Card.Content class="space-y-2">
        {#if byTag.length}
          {#each byTag as r (r.tag)}
            <div class="flex items-center gap-3 text-xs">
              <span class="w-24 truncate font-medium" title={r.tag}>{r.tag}</span>
              <span class="w-28 text-muted-foreground">{r.trades} tr · {r.win}%</span>
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
            </div>
          {/each}
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
      <Card.Content class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-0">
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
      </Card.Content>
    </Card.Root>
  </div>
</div>
