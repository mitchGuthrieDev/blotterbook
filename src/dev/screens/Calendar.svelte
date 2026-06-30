<script lang="ts">
  // Calendar surface mockup (UI redesign, Phase 2 — 2nd screen). A full, dashboard-sized trade
  // calendar — its own thing, richer than the dashboard Calendar module. Master–detail layout: a big
  // month grid (or a year heatmap) on the left + a persistent right rail with the selected day's
  // detail and the month/year summary. Cell treatments: heatmap intensity (P&L magnitude → opacity
  // bucket, via literal utility classes so they stay CSP-safe — no inline style), a per-day target
  // marker, the ISO-week totals column, and note dots. Representative STATIC data — layout mockup, not
  // the live engine. Color only in the P&L data.
  import { ChevronLeft, ChevronRight, X, Minus, Plus, Paperclip, ImagePlus, Check } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { cn } from '$lib/utils';

  type Day = { pnl: number; trades: number; wins: number; note?: boolean };
  // June 2026 (1st is a Monday). A representative spread of trading days.
  const monthDays: Record<number, Day> = {
    2: { pnl: 454, trades: 4, wins: 3 }, 3: { pnl: 383, trades: 4, wins: 3, note: true }, 4: { pnl: 216, trades: 3, wins: 2 },
    5: { pnl: 90, trades: 4, wins: 2 }, 8: { pnl: 355, trades: 5, wins: 3 }, 9: { pnl: 426, trades: 3, wins: 3 },
    10: { pnl: -106, trades: 2, wins: 0 }, 11: { pnl: -91, trades: 4, wins: 1, note: true }, 12: { pnl: -28, trades: 2, wins: 1 },
    15: { pnl: 338, trades: 2, wins: 2 }, 16: { pnl: 48, trades: 4, wins: 2 }, 17: { pnl: 96, trades: 3, wins: 1 },
    18: { pnl: 438, trades: 5, wins: 5, note: true }, 22: { pnl: 93, trades: 5, wins: 3 }, 23: { pnl: 319, trades: 4, wins: 2 },
    24: { pnl: 380, trades: 5, wins: 4 }, 25: { pnl: 448, trades: 4, wins: 4 }, 26: { pnl: -270, trades: 5, wins: 1 },
    30: { pnl: 430, trades: 5, wins: 3 },
  };

  let view = $state<'month' | 'year'>('month');
  let selectedDay = $state<number | null>(18);
  let target = $state(200);
  let note = $state('Held the morning ES long through the 09:45 push — sized right, trailed the stop under the 5m. Cut the NQ short fast when it failed. Discipline good.');

  // ── Heatmap shades — literal classes (Tailwind-scannable), bucketed by |P&L|. ─────────────────
  const POS = ['bg-chart-2/10', 'bg-chart-2/20', 'bg-chart-2/35', 'bg-chart-2/55', 'bg-chart-2/75'];
  const NEG = ['bg-destructive/10', 'bg-destructive/20', 'bg-destructive/35', 'bg-destructive/55', 'bg-destructive/75'];
  const lvl = (pnl: number) => {
    const a = Math.abs(pnl);
    return a > 400 ? 4 : a > 250 ? 3 : a > 120 ? 2 : a > 40 ? 1 : 0;
  };
  const shade = (pnl: number) => (pnl >= 0 ? POS : NEG)[lvl(pnl)];
  const money = (n: number) => `${n >= 0 ? '+' : '-'}$${Math.abs(n).toLocaleString()}`;
  const pct = (w: number, t: number) => (t ? Math.round((100 * w) / t) : 0);

  // ── Month grid (Sunday-first, ISO-week column). ──────────────────────────────────────────────
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const firstDow = new Date(2026, 5, 1).getDay(); // Monday → 1
  const daysInMonth = 30;
  type Cell = { day: number; rec?: Day } | null;
  const weeks: { wk: number; cells: Cell[]; pnl: number; days: number }[] = (() => {
    const flat: Cell[] = [
      ...Array.from({ length: firstDow }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, rec: monthDays[i + 1] })),
    ];
    while (flat.length % 7 !== 0) flat.push(null);
    const rows: { wk: number; cells: Cell[]; pnl: number; days: number }[] = [];
    for (let i = 0; i < flat.length; i += 7) {
      const cells = flat.slice(i, i + 7);
      const traded = cells.filter((c): c is { day: number; rec: Day } => !!c?.rec);
      rows.push({ wk: 23 + i / 7, cells, pnl: traded.reduce((s, c) => s + c.rec.pnl, 0), days: traded.length });
    }
    return rows;
  })();

  // ── Month summary stats. ─────────────────────────────────────────────────────────────────────
  const traded = Object.entries(monthDays).map(([d, v]) => ({ day: +d, ...v })).sort((a, b) => a.day - b.day);
  const monthNet = traded.reduce((s, t) => s + t.pnl, 0);
  const winDays = traded.filter(t => t.pnl > 0).length;
  const lossDays = traded.filter(t => t.pnl < 0).length;
  const avgDay = monthNet / traded.length;
  const bestDay = traded.reduce((m, t) => (t.pnl > m.pnl ? t : m));
  const worstDay = traded.reduce((m, t) => (t.pnl < m.pnl ? t : m));
  const streak = (() => {
    let s = 0;
    for (let i = traded.length - 1; i >= 0; i--) {
      if (traded[i].pnl > 0) s++;
      else break;
    }
    return s;
  })();
  const DOW_LBL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const dowPnl = DOW_LBL.map((lbl, i) => ({
    lbl,
    pnl: traded.filter(t => new Date(2026, 5, t.day).getDay() === i + 1).reduce((s, t) => s + t.pnl, 0),
  }));

  // ── Selected day detail (mock trades). ───────────────────────────────────────────────────────
  const sel = $derived(selectedDay ? monthDays[selectedDay] : undefined);
  const dayTrades = [
    { time: '09:34', sym: 'ES', side: 'Long', qty: 2, pnl: 180 },
    { time: '10:12', sym: 'NQ', side: 'Short', qty: 1, pnl: -60 },
    { time: '11:48', sym: 'ES', side: 'Long', qty: 3, pnl: 240 },
    { time: '13:20', sym: 'CL', side: 'Short', qty: 1, pnl: 78 },
  ];
  const bestTrade = dayTrades.reduce((m, t) => (t.pnl > m.pnl ? t : m));
  const worstTrade = dayTrades.reduce((m, t) => (t.pnl < m.pnl ? t : m));

  // ── Year heatmap (deterministic representative data). ────────────────────────────────────────
  type YCell = { pnl: number; trading: boolean; m: number } | null;
  const yearCols: YCell[][] = (() => {
    const lead = new Date(2026, 0, 1).getDay();
    const flat: YCell[] = Array.from({ length: lead }, () => null);
    for (let i = 0; i < 365; i++) {
      const d = new Date(2026, 0, 1 + i);
      const dow = d.getDay();
      const trading = dow >= 1 && dow <= 5;
      const pnl = trading ? Math.round(Math.sin(i * 0.9) * 260 + Math.cos(i * 0.37) * 180 + 40) : 0;
      flat.push({ pnl, trading, m: d.getMonth() });
    }
    while (flat.length % 7 !== 0) flat.push(null);
    const cols: YCell[][] = [];
    for (let i = 0; i < flat.length; i += 7) cols.push(flat.slice(i, i + 7));
    return cols;
  })();
  const yearCells = yearCols.flat().filter((c): c is { pnl: number; trading: boolean; m: number } => !!c?.trading);
  const yearNet = yearCells.reduce((s, c) => s + c.pnl, 0);
  const yearWin = yearCells.filter(c => c.pnl > 0).length;
  const yearLoss = yearCells.filter(c => c.pnl < 0).length;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
</script>

{#snippet seg(active: boolean, label: string, onclick: () => void)}
  <button
    type="button"
    {onclick}
    class={cn('rounded px-2.5 py-1 text-xs transition-colors', active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}
  >
    {label}
  </button>
{/snippet}

{#snippet stat(label: string, value: string, tone: 'pos' | 'neg' | 'plain' = 'plain')}
  <div class="rounded-md border border-border bg-card px-3 py-2">
    <div class="text-[11px] text-muted-foreground">{label}</div>
    <div class={cn('mt-0.5 text-sm font-semibold tabular-nums', tone === 'pos' ? 'text-chart-2' : tone === 'neg' ? 'text-destructive' : 'text-foreground')}>
      {value}
    </div>
  </div>
{/snippet}

<div class="flex flex-col gap-4">
  <!-- Toolbar -->
  <div class="flex flex-wrap items-center gap-3">
    <div class="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {@render seg(view === 'month', 'Month', () => (view = 'month'))}
      {@render seg(view === 'year', 'Year', () => (view = 'year'))}
    </div>
    {#if view === 'month'}
      <div class="flex items-center gap-1.5">
        <Button variant="outline" size="icon" class="size-8" aria-label="Previous month"><ChevronLeft class="size-4" /></Button>
        <span class="min-w-[8.5rem] text-center text-sm font-semibold">June 2026</span>
        <Button variant="outline" size="icon" class="size-8" aria-label="Next month"><ChevronRight class="size-4" /></Button>
        <Button variant="secondary" size="sm">Latest</Button>
      </div>
      <!-- Daily target stepper -->
      <div class="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
        <span class="text-[11px] text-muted-foreground">Target/day</span>
        <button type="button" class="grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Lower target" onclick={() => (target = Math.max(0, target - 50))}>
          <Minus class="size-3" />
        </button>
        <span class="w-12 text-center text-xs tabular-nums">${target}</span>
        <button type="button" class="grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Raise target" onclick={() => (target += 50)}>
          <Plus class="size-3" />
        </button>
      </div>
    {:else}
      <span class="text-sm font-semibold">2026</span>
    {/if}
    <span class={cn('ml-auto text-sm font-semibold tabular-nums', (view === 'month' ? monthNet : yearNet) < 0 ? 'text-destructive' : 'text-chart-2')}>
      {money(view === 'month' ? monthNet : yearNet)}
    </span>
  </div>

  <div class="flex flex-col gap-4 xl:flex-row">
    <!-- Left: grid / heatmap -->
    <div class="min-w-0 flex-1">
      {#if view === 'month'}
        <div class="rounded-md border border-border bg-card p-3">
          <div class="grid grid-cols-[56px_repeat(7,1fr)] gap-1.5">
            <span class="pb-1 text-[11px] text-muted-foreground">Week</span>
            {#each DOW as d (d)}<span class="pb-1 text-center text-[11px] text-muted-foreground">{d}</span>{/each}
            {#each weeks as w, wi (wi)}
              <div class="flex flex-col justify-center gap-0.5 rounded border border-border bg-secondary px-1 py-1.5 text-center">
                <div class="text-[9px] uppercase tracking-wide text-muted-foreground">Wk {w.wk}</div>
                <div class={cn('text-[10px] font-bold tabular-nums', w.days ? (w.pnl >= 0 ? 'text-chart-2' : 'text-destructive') : 'text-muted-foreground')}>
                  {w.days ? money(w.pnl) : '$0'}
                </div>
                <div class="text-[9px] text-muted-foreground">{w.days}d</div>
              </div>
              {#each w.cells as c, ci (ci)}
                {#if c}
                  {@const hit = !!c.rec && c.rec.pnl >= target}
                  <button
                    type="button"
                    onclick={() => (selectedDay = selectedDay === c.day ? null : c.day)}
                    class={cn(
                      'relative flex min-h-20 flex-col rounded border p-1.5 text-left transition-colors',
                      c.rec ? shade(c.rec.pnl) : '',
                      c.rec ? (c.rec.pnl >= 0 ? 'border-chart-2/30' : 'border-destructive/30') : 'border-border hover:border-ring',
                      selectedDay === c.day && 'ring-2 ring-primary'
                    )}
                  >
                    {#if hit}<span class="absolute right-1 top-1 grid size-3 place-items-center rounded-full bg-chart-2 text-background" title="Hit daily target"><Check class="size-2" /></span>{/if}
                    <span class="flex items-center gap-1 text-[11px] text-muted-foreground">
                      {c.day}{#if c.rec?.note}<span class="size-1.5 rounded-full bg-primary" title="Has a note"></span>{/if}
                    </span>
                    {#if c.rec}
                      <span class={cn('mt-auto text-right text-xs font-bold tabular-nums', c.rec.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}>{money(c.rec.pnl)}</span>
                      <span class="text-right text-[9px] text-muted-foreground">{c.rec.trades} tr · {pct(c.rec.wins, c.rec.trades)}%</span>
                    {/if}
                  </button>
                {:else}
                  <div></div>
                {/if}
              {/each}
            {/each}
          </div>
          <p class="mt-3 text-[11px] text-muted-foreground">
            Cell shade scales with P&L size · <Check class="inline size-3 text-chart-2" /> = hit the ${target}/day target · dot = has a note.
          </p>
        </div>
      {:else}
        <!-- Year heatmap -->
        <div class="rounded-md border border-border bg-card p-4">
          <div class="overflow-x-auto">
            <div class="flex min-w-[680px] justify-between px-0.5 text-[10px] text-muted-foreground">
              {#each MON as m (m)}<span>{m}</span>{/each}
            </div>
            <div class="mt-1 flex min-w-[680px] gap-[3px]">
              {#each yearCols as col, ci (ci)}
                <div class="flex flex-col gap-[3px]">
                  {#each col as cell, ri (ri)}
                    <div
                      class={cn('size-[10px] rounded-[2px]', cell ? (cell.trading ? shade(cell.pnl) : 'bg-secondary/50') : 'bg-transparent')}
                      title={cell?.trading ? `${MON[cell.m]} · ${money(cell.pnl)}` : ''}
                    ></div>
                  {/each}
                </div>
              {/each}
            </div>
          </div>
          <div class="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Loss</span>
            <span class="size-[10px] rounded-[2px] bg-destructive/55"></span>
            <span class="size-[10px] rounded-[2px] bg-destructive/20"></span>
            <span class="size-[10px] rounded-[2px] bg-secondary/50"></span>
            <span class="size-[10px] rounded-[2px] bg-chart-2/20"></span>
            <span class="size-[10px] rounded-[2px] bg-chart-2/55"></span>
            <span>Profit</span>
          </div>
        </div>
      {/if}
    </div>

    <!-- Right rail: day detail + summary -->
    <div class="flex shrink-0 flex-col gap-4 xl:w-80">
      {#if view === 'month' && selectedDay && sel}
        <div class="rounded-md border border-border bg-card">
          <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span class="text-sm font-semibold">June {selectedDay}, 2026</span>
            <button type="button" class="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close day detail" onclick={() => (selectedDay = null)}>
              <X class="size-4" />
            </button>
          </div>
          <div class="space-y-3 p-4">
            <!-- Day stats -->
            <div class="grid grid-cols-2 gap-2">
              {@render stat('Day P&L', money(sel.pnl), sel.pnl >= 0 ? 'pos' : 'neg')}
              {@render stat('Win rate', `${pct(sel.wins, sel.trades)}%`)}
              {@render stat('Best trade', money(bestTrade.pnl), 'pos')}
              {@render stat('Worst trade', money(worstTrade.pnl), 'neg')}
            </div>

            <!-- Trades list -->
            <div>
              <div class="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Trades · {sel.trades}</div>
              <div class="overflow-hidden rounded-md border border-border">
                {#each dayTrades as t, i (i)}
                  <div class={cn('flex items-center gap-2 px-2.5 py-1.5 text-xs', i > 0 && 'border-t border-border')}>
                    <span class="tabular-nums text-muted-foreground">{t.time}</span>
                    <span class="font-medium">{t.sym}</span>
                    <span class={cn('rounded px-1 text-[10px]', t.side === 'Long' ? 'bg-chart-2/15 text-chart-2' : 'bg-destructive/15 text-destructive')}>{t.side}</span>
                    <span class="text-muted-foreground">×{t.qty}</span>
                    <span class={cn('ml-auto font-semibold tabular-nums', t.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}>{money(t.pnl)}</span>
                  </div>
                {/each}
              </div>
            </div>

            <!-- Journal note -->
            <div>
              <div class="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Journal note</div>
              <textarea
                class="h-24 w-full resize-none rounded-md border border-border bg-background p-2 text-xs leading-relaxed text-foreground outline-none focus-visible:border-ring"
                bind:value={note}
              ></textarea>
              <div class="mt-1.5 flex justify-end">
                <Button size="sm">Save note</Button>
              </div>
            </div>

            <!-- Attachments -->
            <div>
              <div class="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <Paperclip class="size-3" /> Attachments
              </div>
              <div class="grid grid-cols-3 gap-2">
                <div class="grid aspect-video place-items-center rounded border border-border bg-secondary text-muted-foreground"><ImagePlus class="size-4" /></div>
                <div class="aspect-video rounded border border-border bg-secondary"></div>
                <button type="button" class="grid aspect-video place-items-center rounded border border-dashed border-border text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Add attachment">
                  <Plus class="size-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- Month / year summary -->
      <div class="rounded-md border border-border bg-card">
        <div class="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {view === 'month' ? 'June summary' : '2026 summary'}
        </div>
        <div class="space-y-3 p-4">
          {#if view === 'month'}
            <div class="grid grid-cols-2 gap-2">
              {@render stat('Net P&L', money(monthNet), monthNet >= 0 ? 'pos' : 'neg')}
              {@render stat('Avg / day', money(Math.round(avgDay)), avgDay >= 0 ? 'pos' : 'neg')}
              {@render stat('Win days', `${winDays}`, 'pos')}
              {@render stat('Loss days', `${lossDays}`, 'neg')}
              {@render stat('Best day', money(bestDay.pnl), 'pos')}
              {@render stat('Worst day', money(worstDay.pnl), 'neg')}
            </div>
            <div class="rounded-md border border-border bg-background px-3 py-2 text-xs">
              <span class="text-muted-foreground">Current streak</span>
              <span class="ml-2 font-semibold text-chart-2">{streak} green days</span>
            </div>
            <div>
              <div class="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">By weekday</div>
              <div class="space-y-1">
                {#each dowPnl as d (d.lbl)}
                  <div class="flex items-center justify-between text-xs">
                    <span class="text-muted-foreground">{d.lbl}</span>
                    <span class={cn('font-medium tabular-nums', d.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}>{money(d.pnl)}</span>
                  </div>
                {/each}
              </div>
            </div>
          {:else}
            <div class="grid grid-cols-2 gap-2">
              {@render stat('Net P&L', money(yearNet), yearNet >= 0 ? 'pos' : 'neg')}
              {@render stat('Trading days', `${yearCells.length}`)}
              {@render stat('Win days', `${yearWin}`, 'pos')}
              {@render stat('Loss days', `${yearLoss}`, 'neg')}
            </div>
            <p class="text-[11px] text-muted-foreground">Pick a month from the heatmap to drill into its daily grid.</p>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>
