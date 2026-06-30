<script lang="ts">
  // Analytics surface mockup (UI redesign, Phase 2 — 3rd screen). A curated, fixed grid of analytics
  // modules pairing the deeper compute() metrics with visual charts: a KPI highlights strip, P&L
  // distribution, drawdown (underwater) curve, time-of-day + day-of-week performance, per-symbol and
  // long/short breakdowns, and the full advanced-stats grid. All charts are inline SVG (geometry attrs
  // + fill-*/stroke-* utilities — no inline style, CSP-safe). Representative static data; color only
  // in the P&L data.
  import { cn } from '$lib/utils';

  const money = (n: number) => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString()}`;

  const kpis: { label: string; value: string; tone?: 'pos' | 'neg' }[] = [
    { label: 'Net P&L', value: '+$79,467', tone: 'pos' },
    { label: 'Expectancy / trade', value: '+$51.64', tone: 'pos' },
    { label: 'Profit factor', value: '3.01' },
    { label: 'Payoff ratio', value: '2.18' },
    { label: 'Sharpe (daily)', value: '0.80' },
    { label: 'Recovery factor', value: '12.4' },
  ];

  // Per-trade P&L distribution (counts per bucket).
  const dist = [
    { label: '<-2h', value: 6, neg: true },
    { label: '-2h..-1h', value: 14, neg: true },
    { label: '-1h..0', value: 33, neg: true },
    { label: '0..1h', value: 48, neg: false },
    { label: '1h..2h', value: 39, neg: false },
    { label: '2h..3h', value: 22, neg: false },
    { label: '3h..4h', value: 11, neg: false },
    { label: '>4h', value: 7, neg: false },
  ];
  const wins = 892;
  const losses = 647;
  const winShare = Math.round((wins / (wins + losses)) * 100);

  // Signed avg P&L by hour-of-day and by weekday.
  const hours = [
    { label: '09', value: 48 }, { label: '10', value: 86 }, { label: '11', value: 22 },
    { label: '12', value: -14 }, { label: '13', value: 9 }, { label: '14', value: 37 }, { label: '15', value: -6 },
  ];
  const wdays = [
    { label: 'Mon', value: -8 }, { label: 'Tue', value: 42 }, { label: 'Wed', value: 71 },
    { label: 'Thu', value: 33 }, { label: 'Fri', value: 19 },
  ];

  const symbols = [
    { sym: 'ES', trades: 612, win: 59, pnl: 38420 },
    { sym: 'NQ', trades: 441, win: 57, pnl: 24180 },
    { sym: 'CL', trades: 233, win: 55, pnl: 9870 },
    { sym: 'GC', trades: 151, win: 61, pnl: 6120 },
    { sym: 'MES', trades: 102, win: 52, pnl: 877 },
  ];
  const maxSym = Math.max(...symbols.map(s => Math.abs(s.pnl)));
  const longS = { pnl: 51240, n: 842 };
  const shortS = { pnl: 28227, n: 697 };
  const longShare = Math.round((longS.n / (longS.n + shortS.n)) * 100);

  const statRows: { k: string; v: string; tone?: 'pos' | 'neg' }[] = [
    { k: 'Payoff ratio (avg win / avg loss)', v: '2.18' },
    { k: 'Average win', v: '+$133.39', tone: 'pos' },
    { k: 'Average loss', v: '-$61.08', tone: 'neg' },
    { k: 'Expectancy / trade', v: '+$51.64', tone: 'pos' },
    { k: 'Per-trade std dev', v: '$182.55' },
    { k: 'Sortino (daily)', v: '1.24' },
    { k: 'Recovery factor (net / max DD)', v: '12.4' },
    { k: 'Profit concentration (top 5)', v: '18%' },
    { k: 'Max consecutive wins', v: '9' },
    { k: 'Max consecutive losses', v: '4' },
    { k: 'Avg hold time', v: '7m 42s' },
    { k: 'Largest winning streak', v: '+$1,940', tone: 'pos' },
    { k: 'Largest losing streak', v: '-$612', tone: 'neg' },
    { k: 'Best weekday', v: 'Wed · +$71/trade', tone: 'pos' },
    { k: 'Worst weekday', v: 'Mon · -$8/trade', tone: 'neg' },
    { k: 'Gross profit', v: '+$118,402', tone: 'pos' },
    { k: 'Gross loss', v: '-$38,935', tone: 'neg' },
    { k: 'Avg trades / day', v: '3.5' },
  ];
</script>

{#snippet head(title: string)}
  <div class="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
{/snippet}

{#snippet countBars(items: { label: string; value: number; neg: boolean }[])}
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

{#snippet signedBars(items: { label: string; value: number }[])}
  {@const max = Math.max(1, ...items.map(d => Math.abs(d.value)))}
  {@const step = 100 / items.length}
  <svg viewBox="0 0 100 60" class="h-32 w-full" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" y1="30" x2="100" y2="30" class="stroke-border" stroke-width="0.5" />
    {#each items as d, i (i)}
      {@const bw = step * 0.55}
      {@const h = (Math.abs(d.value) / max) * 26}
      <rect x={i * step + (step - bw) / 2} y={d.value >= 0 ? 30 - h : 30} width={bw} height={h} class={d.value >= 0 ? 'fill-chart-2' : 'fill-destructive'} />
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
      <div class="rounded-md border border-border bg-card p-4">
        <div class="text-xs text-muted-foreground">{k.label}</div>
        <div class={cn('mt-1 text-xl font-semibold tabular-nums', k.tone === 'pos' ? 'text-chart-2' : k.tone === 'neg' ? 'text-destructive' : 'text-foreground')}>
          {k.value}
        </div>
      </div>
    {/each}
  </div>

  <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
    <!-- Distribution -->
    <div class="rounded-md border border-border bg-card lg:col-span-2">
      {@render head('P&L distribution (per trade)')}
      <div class="p-4">
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
      </div>
    </div>

    <!-- Drawdown -->
    <div class="rounded-md border border-border bg-card">
      {@render head('Drawdown (underwater)')}
      <div class="p-4">
        <svg viewBox="0 0 100 50" class="h-32 w-full" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="0.5" x2="100" y2="0.5" class="stroke-border" stroke-width="0.5" />
          <path d="M0 0 L0 8 L12 14 L20 6 L30 22 L42 30 L55 12 L68 4 L80 18 L92 9 L100 2 L100 0 Z" class="fill-destructive/20" />
          <path d="M0 8 L12 14 L20 6 L30 22 L42 30 L55 12 L68 4 L80 18 L92 9 L100 2" fill="none" class="stroke-destructive" stroke-width="0.7" />
        </svg>
        <div class="mt-2 flex justify-between text-[11px] text-muted-foreground">
          <span>Max drawdown <span class="text-destructive">-$502.75</span></span>
          <span>0.8% of peak</span>
        </div>
      </div>
    </div>

    <!-- Long vs Short -->
    <div class="rounded-md border border-border bg-card">
      {@render head('Long vs short')}
      <div class="p-4">
        <div class="grid grid-cols-2 gap-2">
          <div class="rounded-md border border-border bg-background px-3 py-2">
            <div class="text-[11px] text-muted-foreground">Long · {longS.n}</div>
            <div class="mt-0.5 text-sm font-semibold tabular-nums text-chart-2">{money(longS.pnl)}</div>
          </div>
          <div class="rounded-md border border-border bg-background px-3 py-2">
            <div class="text-[11px] text-muted-foreground">Short · {shortS.n}</div>
            <div class="mt-0.5 text-sm font-semibold tabular-nums text-chart-2">{money(shortS.pnl)}</div>
          </div>
        </div>
        <svg viewBox="0 0 100 8" class="mt-3 h-2 w-full" preserveAspectRatio="none" aria-hidden="true">
          <rect x="0" y="0" width={longShare} height="8" class="fill-chart-2" />
          <rect x={longShare} y="0" width={100 - longShare} height="8" class="fill-chart-1" />
        </svg>
        <div class="mt-1 flex justify-between text-[11px] text-muted-foreground">
          <span>{longShare}% long</span><span>{100 - longShare}% short</span>
        </div>
      </div>
    </div>

    <!-- Time of day -->
    <div class="rounded-md border border-border bg-card">
      {@render head('Avg P&L by hour')}
      <div class="p-4">{@render signedBars(hours)}</div>
    </div>

    <!-- Day of week -->
    <div class="rounded-md border border-border bg-card">
      {@render head('Avg P&L by weekday')}
      <div class="p-4">{@render signedBars(wdays)}</div>
    </div>

    <!-- Per-symbol -->
    <div class="rounded-md border border-border bg-card lg:col-span-2">
      {@render head('Performance by symbol')}
      <div class="space-y-2 p-4">
        {#each symbols as s (s.sym)}
          <div class="flex items-center gap-3 text-xs">
            <span class="w-10 font-medium">{s.sym}</span>
            <span class="w-28 text-muted-foreground">{s.trades} tr · {s.win}%</span>
            <svg viewBox="0 0 100 8" class="h-2 flex-1" preserveAspectRatio="none" aria-hidden="true">
              <rect x="0" y="0" width="100" height="8" class="fill-secondary" />
              <rect x="0" y="0" width={Math.round((Math.abs(s.pnl) / maxSym) * 100)} height="8" class={s.pnl >= 0 ? 'fill-chart-2' : 'fill-destructive'} />
            </svg>
            <span class={cn('w-20 text-right font-semibold tabular-nums', s.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}>{money(s.pnl)}</span>
          </div>
        {/each}
      </div>
    </div>

    <!-- Full advanced stats grid -->
    <div class="rounded-md border border-border bg-card lg:col-span-2">
      {@render head('Advanced statistics')}
      <div class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-0 p-4">
        {#each statRows as r (r.k)}
          <div class="flex items-baseline justify-between gap-3 border-b border-border py-[7px]">
            <span class="text-xs text-muted-foreground">{r.k}</span>
            <span class={cn('text-[13px] font-bold tabular-nums whitespace-nowrap', r.tone === 'pos' ? 'text-chart-2' : r.tone === 'neg' ? 'text-destructive' : 'text-foreground')}>{r.v}</span>
          </div>
        {/each}
      </div>
    </div>
  </div>
</div>
