<script lang="ts" module>
  export type CalDay = { pnl: number; trades: number; wins: number; note?: boolean };
  export type DayTrade = { time: string; sym: string; side: 'Long' | 'Short'; qty: number; pnl: number };
</script>

<script lang="ts">
  // Calendar surface (UI redesign). A full, dashboard-sized trade calendar — richer than the dashboard
  // Calendar module. Master–detail: a big month grid (or a year heatmap) on the left + a persistent
  // right rail with the selected day's detail and the month/year summary. Cell treatments: heatmap
  // intensity (P&L magnitude → opacity bucket, via literal utility classes so they stay CSP-safe), a
  // per-day target marker, the ISO-week totals column, and note dots. Data comes from props (real
  // metrics + journal on the staging app); the defaults below are the /dev mock. Color only in the P&L.
  import { ChevronLeft, ChevronRight, X, Minus, Plus, Paperclip, ImagePlus, Check } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import * as Card from '$lib/components/ui/card';
  import { cn } from '$lib/utils';

  // ── Mock defaults (the /dev preview) — June 2026 (1st is a Monday). ────────────────────────────
  const MOCK_DAYS: Record<number, CalDay> = {
    2: { pnl: 454, trades: 4, wins: 3 }, 3: { pnl: 383, trades: 4, wins: 3, note: true }, 4: { pnl: 216, trades: 3, wins: 2 },
    5: { pnl: 90, trades: 4, wins: 2 }, 8: { pnl: 355, trades: 5, wins: 3 }, 9: { pnl: 426, trades: 3, wins: 3 },
    10: { pnl: -106, trades: 2, wins: 0 }, 11: { pnl: -91, trades: 4, wins: 1, note: true }, 12: { pnl: -28, trades: 2, wins: 1 },
    15: { pnl: 338, trades: 2, wins: 2 }, 16: { pnl: 48, trades: 4, wins: 2 }, 17: { pnl: 96, trades: 3, wins: 1 },
    18: { pnl: 438, trades: 5, wins: 5, note: true }, 22: { pnl: 93, trades: 5, wins: 3 }, 23: { pnl: 319, trades: 4, wins: 2 },
    24: { pnl: 380, trades: 5, wins: 4 }, 25: { pnl: 448, trades: 4, wins: 4 }, 26: { pnl: -270, trades: 5, wins: 1 },
    30: { pnl: 430, trades: 5, wins: 3 },
  };
  const MOCK_TRADES: DayTrade[] = [
    { time: '09:34', sym: 'ES', side: 'Long', qty: 2, pnl: 180 },
    { time: '10:12', sym: 'NQ', side: 'Short', qty: 1, pnl: -60 },
    { time: '11:48', sym: 'ES', side: 'Long', qty: 3, pnl: 240 },
    { time: '13:20', sym: 'CL', side: 'Short', qty: 1, pnl: 78 },
  ];
  const MOCK_NOTE = 'Held the morning ES long through the 09:45 push — sized right, trailed the stop under the 5m. Cut the NQ short fast when it failed. Discipline good.';
  // Deterministic year heatmap for the /dev preview (a representative spread).
  const MOCK_YEAR: Record<string, number> = (() => {
    const o: Record<string, number> = {};
    for (let i = 0; i < 365; i++) {
      const d = new Date(2026, 0, 1 + i);
      if (d.getDay() >= 1 && d.getDay() <= 5) o[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] = Math.round(Math.sin(i * 0.9) * 260 + Math.cos(i * 0.37) * 180 + 40);
    }
    return o;
  })();

  interface Props {
    monthDays?: Record<number, CalDay>;
    year?: number;
    month?: number; // 0-based
    monthLabel?: string;
    yearPnl?: Record<string, number>; // 'YYYY-MM-DD' → net P&L (for the heatmap)
    onprev?: () => void;
    onnext?: () => void;
    onlatest?: () => void;
    tradesForDay?: (day: number) => DayTrade[];
    getNote?: (day: number) => string;
    onsavenote?: (day: number, text: string) => void;
  }
  let {
    monthDays = MOCK_DAYS,
    year = 2026,
    month = 5,
    monthLabel = 'June 2026',
    yearPnl = MOCK_YEAR,
    onprev,
    onnext,
    onlatest,
    tradesForDay = () => MOCK_TRADES,
    getNote = () => MOCK_NOTE,
    onsavenote,
  }: Props = $props();

  let view = $state<'month' | 'year'>('month');
  let selectedDay = $state<number | null>(null);
  let target = $state(200);
  let note = $state('');
  // Load the selected day's note when the selection (or the underlying journal) changes.
  $effect(() => {
    note = selectedDay ? getNote(selectedDay) : '';
  });

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
  // ISO-8601 week number (matches the core helper; inlined so the screen stays self-contained).
  const isoWeek = (d: Date) => {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t.getTime() - ys.getTime()) / 86400000 + 1) / 7);
  };

  // ── Month grid (Sunday-first, ISO-week column). ──────────────────────────────────────────────
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  type Cell = { day: number; rec?: CalDay } | null;
  const weeks = $derived.by<{ wk: number; cells: Cell[]; pnl: number; days: number }[]>(() => {
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const flat: Cell[] = [
      ...Array.from({ length: firstDow }, () => null),
      ...Array.from({ length: daysInMonth }, (_, i) => ({ day: i + 1, rec: monthDays[i + 1] })),
    ];
    while (flat.length % 7 !== 0) flat.push(null);
    const rows: { wk: number; cells: Cell[]; pnl: number; days: number }[] = [];
    for (let i = 0; i < flat.length; i += 7) {
      const cells = flat.slice(i, i + 7);
      const traded = cells.filter((c): c is { day: number; rec: CalDay } => !!c?.rec);
      const anyDay = cells.find((c): c is { day: number; rec?: CalDay } => !!c);
      rows.push({ wk: anyDay ? isoWeek(new Date(year, month, anyDay.day)) : 0, cells, pnl: traded.reduce((s, c) => s + c.rec.pnl, 0), days: traded.length });
    }
    return rows;
  });

  // ── Month summary stats. ─────────────────────────────────────────────────────────────────────
  const traded = $derived(
    Object.entries(monthDays)
      .map(([d, v]) => ({ day: +d, ...v }))
      .sort((a, b) => a.day - b.day)
  );
  const monthNet = $derived(traded.reduce((s, t) => s + t.pnl, 0));
  const winDays = $derived(traded.filter(t => t.pnl > 0).length);
  const lossDays = $derived(traded.filter(t => t.pnl < 0).length);
  const avgDay = $derived(traded.length ? monthNet / traded.length : 0);
  const bestDay = $derived(traded.length ? traded.reduce((m, t) => (t.pnl > m.pnl ? t : m)) : null);
  const worstDay = $derived(traded.length ? traded.reduce((m, t) => (t.pnl < m.pnl ? t : m)) : null);
  const streak = $derived.by(() => {
    let s = 0;
    for (let i = traded.length - 1; i >= 0; i--) {
      if (traded[i].pnl > 0) s++;
      else break;
    }
    return s;
  });
  const DOW_LBL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const dowPnl = $derived(
    DOW_LBL.map((lbl, i) => ({
      lbl,
      pnl: traded.filter(t => new Date(year, month, t.day).getDay() === i + 1).reduce((s, t) => s + t.pnl, 0),
    }))
  );

  // ── Selected day detail (real trades for the day). ───────────────────────────────────────────
  const sel = $derived(selectedDay ? monthDays[selectedDay] : undefined);
  const dayTrades = $derived(selectedDay ? tradesForDay(selectedDay) : []);
  const bestTrade = $derived(dayTrades.length ? dayTrades.reduce((m, t) => (t.pnl > m.pnl ? t : m)) : null);
  const worstTrade = $derived(dayTrades.length ? dayTrades.reduce((m, t) => (t.pnl < m.pnl ? t : m)) : null);

  // ── Year heatmap (week columns, Sunday-first; trading = a day with P&L). ──────────────────────
  type YCell = { date: string; pnl: number; trading: boolean; m: number } | null;
  const yearCols = $derived.by<YCell[][]>(() => {
    const lead = new Date(year, 0, 1).getDay();
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    const len = isLeap ? 366 : 365;
    const flat: YCell[] = Array.from({ length: lead }, () => null);
    for (let i = 0; i < len; i++) {
      const d = new Date(year, 0, 1 + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const has = key in yearPnl;
      flat.push({ date: key, pnl: yearPnl[key] ?? 0, trading: has, m: d.getMonth() });
    }
    while (flat.length % 7 !== 0) flat.push(null);
    const cols: YCell[][] = [];
    for (let i = 0; i < flat.length; i += 7) cols.push(flat.slice(i, i + 7));
    return cols;
  });
  const yearCells = $derived(yearCols.flat().filter((c): c is { date: string; pnl: number; trading: boolean; m: number } => !!c?.trading));
  const yearNet = $derived(yearCells.reduce((s, c) => s + c.pnl, 0));
  const yearWin = $derived(yearCells.filter(c => c.pnl > 0).length);
  const yearLoss = $derived(yearCells.filter(c => c.pnl < 0).length);
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
  <Card.Root class="px-3 py-2">
    <div class="text-[11px] text-muted-foreground">{label}</div>
    <div class={cn('mt-0.5 text-sm font-semibold tabular-nums', tone === 'pos' ? 'text-chart-2' : tone === 'neg' ? 'text-destructive' : 'text-foreground')}>
      {value}
    </div>
  </Card.Root>
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
        <Button variant="outline" size="icon" class="size-8" aria-label="Previous month" onclick={() => onprev?.()}><ChevronLeft class="size-4" /></Button>
        <span class="min-w-[8.5rem] text-center text-sm font-semibold">{monthLabel}</span>
        <Button variant="outline" size="icon" class="size-8" aria-label="Next month" onclick={() => onnext?.()}><ChevronRight class="size-4" /></Button>
        <Button variant="secondary" size="sm" onclick={() => onlatest?.()}>Latest</Button>
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
      <span class="text-sm font-semibold">{year}</span>
    {/if}
    <span class={cn('ml-auto text-sm font-semibold tabular-nums', (view === 'month' ? monthNet : yearNet) < 0 ? 'text-destructive' : 'text-chart-2')}>
      {money(view === 'month' ? monthNet : yearNet)}
    </span>
  </div>

  <div class="flex flex-col gap-4 xl:flex-row">
    <!-- Left: grid / heatmap -->
    <div class="min-w-0 flex-1">
      {#if view === 'month'}
        <Card.Root class="p-3">
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
        </Card.Root>
      {:else}
        <!-- Year heatmap -->
        <Card.Root class="p-4">
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
                      title={cell?.trading ? `${cell.date} · ${money(cell.pnl)}` : ''}
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
        </Card.Root>
      {/if}
    </div>

    <!-- Right rail: day detail + summary -->
    <div class="flex shrink-0 flex-col gap-4 xl:w-80">
      {#if view === 'month' && selectedDay && sel}
        <Card.Root>
          <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
            <span class="text-sm font-semibold">{monthLabel.split(' ')[0]} {selectedDay}, {year}</span>
            <button type="button" class="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close day detail" onclick={() => (selectedDay = null)}>
              <X class="size-4" />
            </button>
          </div>
          <div class="space-y-3 p-4">
            <!-- Day stats -->
            <div class="grid grid-cols-2 gap-2">
              {@render stat('Day P&L', money(sel.pnl), sel.pnl >= 0 ? 'pos' : 'neg')}
              {@render stat('Win rate', `${pct(sel.wins, sel.trades)}%`)}
              {@render stat('Best trade', bestTrade ? money(bestTrade.pnl) : '—', 'pos')}
              {@render stat('Worst trade', worstTrade ? money(worstTrade.pnl) : '—', 'neg')}
            </div>

            <!-- Trades list -->
            <div>
              <div class="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Trades · {sel.trades}</div>
              <div class="overflow-hidden rounded-md border border-border">
                {#each dayTrades as t, i (i)}
                  <div class={cn('flex items-center gap-2 px-2.5 py-1.5 text-xs', i > 0 && 'border-t border-border')}>
                    <span class="tabular-nums text-muted-foreground">{t.time || '—'}</span>
                    <span class="font-medium">{t.sym}</span>
                    <Badge variant="outline" class={t.side === 'Long' ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}>{t.side}</Badge>
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
                <Button size="sm" onclick={() => selectedDay && onsavenote?.(selectedDay, note)}>Save note</Button>
              </div>
            </div>

            <!-- Attachments (storage deferred — Phase 3 wires notes; screenshots land next) -->
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
        </Card.Root>
      {/if}

      <!-- Month / year summary -->
      <Card.Root>
        <div class="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {view === 'month' ? `${monthLabel.split(' ')[0]} summary` : `${year} summary`}
        </div>
        <div class="space-y-3 p-4">
          {#if view === 'month'}
            <div class="grid grid-cols-2 gap-2">
              {@render stat('Net P&L', money(monthNet), monthNet >= 0 ? 'pos' : 'neg')}
              {@render stat('Avg / day', money(Math.round(avgDay)), avgDay >= 0 ? 'pos' : 'neg')}
              {@render stat('Win days', `${winDays}`, 'pos')}
              {@render stat('Loss days', `${lossDays}`, 'neg')}
              {@render stat('Best day', bestDay ? money(bestDay.pnl) : '—', 'pos')}
              {@render stat('Worst day', worstDay ? money(worstDay.pnl) : '—', 'neg')}
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
            <p class="text-[11px] text-muted-foreground">Switch to Month to drill into a day's trades and note.</p>
          {/if}
        </div>
      </Card.Root>
    </div>
  </div>
</div>
