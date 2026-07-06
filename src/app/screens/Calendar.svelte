<script lang="ts" module>
  export type CalDay = { pnl: number; trades: number; wins: number; note?: boolean; tags?: string[] };
  export type DayTrade = { time: string; sym: string; side: 'Long' | 'Short'; qty: number; pnl: number };
</script>

<script lang="ts">
  // Calendar surface (UI redesign). A full, dashboard-sized trade calendar — richer than the dashboard
  // Calendar module. Master–detail: a big month grid (or a year heatmap) on the left + a persistent
  // right rail with the selected day's detail and the month/year summary. Cell treatments: heatmap
  // intensity (P&L magnitude → opacity bucket, via literal utility classes so they stay CSP-safe), a
  // per-day target marker, the ISO-week totals column, and note dots. Data comes from props (real
  // metrics + journal, wired by App.svelte on all surfaces). Color only in the P&L.
  import { ChevronLeft, ChevronRight, X, Minus, Plus, Paperclip, ImagePlus, Check } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import IconTip from '$lib/components/IconTip.svelte';
  import { Badge } from '$lib/components/ui/badge';
  import * as Card from '$lib/components/ui/card';
  import { cn } from '$lib/utils';
  import { usdWhole, tone, fmtDate, isoWeek, monthCells, dowPnlRows, MONTH_ABBR, DOW_LABEL } from '../../lib/core/core.ts';
  import { cleanTag } from '../../lib/core/store.ts';
  import { readImage } from '../lib/files.ts';
  import ScreenshotLightbox from '../parts/ScreenshotLightbox.svelte';
  import SegmentedControl from '../parts/SegmentedControl.svelte';
  import TagInput from '../parts/TagInput.svelte';
  import { fly } from 'svelte/transition';
  import { dur } from '../lib/motion.ts';

  interface Props {
    monthDays: Record<number, CalDay>;
    year: number;
    month: number; // 0-based
    monthLabel: string;
    yearPnl: Record<string, number>; // 'YYYY-MM-DD' → net P&L (for the heatmap)
    onprev?: () => void;
    onnext?: () => void;
    onlatest?: () => void;
    tradesForDay: (day: number) => DayTrade[];
    getJournal: (day: number) => { text: string; tags: string[]; shots: string[] };
    /** The existing day-tag vocabulary, for the tag-input autocomplete (A167). */
    tagVocab?: string[];
    onsavenote?: (day: number, text: string, tags: string[], shots: string[]) => void;
  }
  let {
    monthDays,
    year,
    month,
    monthLabel,
    yearPnl,
    onprev,
    onnext,
    onlatest,
    tradesForDay,
    getJournal,
    tagVocab = [],
    onsavenote,
  }: Props = $props();

  let view = $state<'month' | 'year'>('month');
  let selectedDay = $state<number | null>(null);
  let target = $state(200);
  let note = $state('');
  let tags = $state<string[]>([]);
  let shots = $state<string[]>([]);
  let tagDraft = $state('');
  // Load the selected day's journal (note + tags + shots) when the selection (or the underlying
  // journal) changes.
  $effect(() => {
    if (selectedDay) {
      const j = getJournal(selectedDay);
      note = j.text;
      tags = j.tags;
      shots = j.shots;
    } else {
      note = '';
      tags = [];
      shots = [];
    }
    tagDraft = '';
  });

  function addTag() {
    // A153: canonicalize at entry (the same cleanTag the Store applies on save), so the chip the
    // user sees is exactly the persisted form — no case/markup divergence, no case-dup chips.
    const t = cleanTag(tagDraft);
    if (t && !tags.includes(t)) tags = [...tags, t];
    tagDraft = '';
  }
  function removeTag(t: string) {
    tags = tags.filter(x => x !== t);
  }
  async function addShot(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    const url = await readImage(f);
    if (url) shots = [...shots, url];
  }
  function removeShot(idx: number) {
    shots = shots.filter((_, j) => j !== idx);
  }
  // Enlarged-screenshot lightbox (the shared ScreenshotLightbox part, mounted below — A152).
  let zoomShot = $state<string | null>(null);

  // ── Heatmap shades — literal classes (Tailwind-scannable), bucketed by |P&L|. ─────────────────
  // A140: cap the ramp at /55 (was /75). The top buckets were saturated enough that the same-hue P&L
  // text (text-chart-2 on bg-chart-2, text-destructive on bg-destructive) and the muted day number
  // lost contrast on the biggest win/loss days. /55 keeps a clear intensity gradient and matches the
  // legend swatches; the day number is also promoted to text-foreground on cells (see the grid below).
  const POS = ['bg-chart-2/10', 'bg-chart-2/18', 'bg-chart-2/28', 'bg-chart-2/40', 'bg-chart-2/55'];
  const NEG = ['bg-destructive/10', 'bg-destructive/18', 'bg-destructive/28', 'bg-destructive/40', 'bg-destructive/55'];
  const lvl = (pnl: number) => {
    const a = Math.abs(pnl);
    return a > 400 ? 4 : a > 250 ? 3 : a > 120 ? 2 : a > 40 ? 1 : 0;
  };
  const shade = (pnl: number) => (pnl >= 0 ? POS : NEG)[lvl(pnl)];
  const pct = (w: number, t: number) => (t ? Math.round((100 * w) / t) : 0);

  // ── Month grid (Sunday-first, ISO-week column). ──────────────────────────────────────────────
  type Cell = { day: number; rec?: CalDay } | null;
  const weeks = $derived.by<{ wk: number; cells: Cell[]; pnl: number; days: number }[]>(() => {
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const flat: Cell[] = monthCells(firstDow, daysInMonth).map(d => (d === null ? null : { day: d, rec: monthDays[d] }));
    const rows: { wk: number; cells: Cell[]; pnl: number; days: number }[] = [];
    for (let i = 0; i < flat.length; i += 7) {
      const cells = flat.slice(i, i + 7);
      const traded = cells.filter((c): c is { day: number; rec: CalDay } => !!c?.rec);
      // A150: label the row by its MONDAY. The grid is Sunday-first but ISO weeks are Monday-first —
      // a Sunday belongs to the ISO week that ENDED that day, so labeling by the first cell tagged
      // every full row with the PRIOR week's number (and duplicated it across two rows). When the
      // Monday slot is empty, fall back to the first day present, shifted +1 if it's the Sunday.
      const labelCell = cells[1] ?? cells.find((c): c is { day: number; rec?: CalDay } => !!c);
      const labelDate = labelCell ? new Date(year, month, labelCell.day + (labelCell === cells[0] ? 1 : 0)) : null;
      rows.push({
        wk: labelDate ? isoWeek(labelDate) : 0,
        cells,
        pnl: traded.reduce((s, c) => s + c.rec.pnl, 0),
        days: traded.length,
      });
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
  // A174: all seven weekdays — Globex Sunday (and holiday-Saturday) sessions count in the month
  // total, so a Mon–Fri-only list silently dropped them from the bars. The bucket/filter rule is
  // the node-tested core dowPnlRows (A194).
  const dowPnl = $derived(dowPnlRows(traded.map(t => ({ dow: new Date(year, month, t.day).getDay(), pnl: t.pnl }))));

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
      const key = fmtDate(d);
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
</script>

{#snippet stat(label: string, value: string, tone: 'pos' | 'neg' | 'plain' = 'plain')}
  <Card.Root class="px-3 py-2">
    <div class="text-[11px] text-muted-foreground">{label}</div>
    <div
      class={cn(
        'mt-0.5 text-sm font-semibold tabular-nums',
        tone === 'pos' ? 'text-chart-2' : tone === 'neg' ? 'text-destructive' : 'text-foreground'
      )}
    >
      {value}
    </div>
  </Card.Root>
{/snippet}

<div class="flex flex-col gap-4">
  <!-- Toolbar -->
  <div class="flex flex-wrap items-center gap-3">
    <SegmentedControl
      segments={[
        { key: 'month', label: 'Month' },
        { key: 'year', label: 'Year' },
      ]}
      value={view}
      onselect={k => (view = k as 'month' | 'year')}
    />
    {#if view === 'month'}
      <div class="flex items-center gap-1.5">
        <IconTip label="Previous month">
          {#snippet button(tip)}
            <Button {...tip} variant="outline" size="icon" class="size-8" aria-label="Previous month" onclick={() => onprev?.()}
              ><ChevronLeft class="size-4" /></Button
            >
          {/snippet}
        </IconTip>
        <span class="min-w-[8.5rem] text-center text-sm font-semibold">{monthLabel}</span>
        <IconTip label="Next month">
          {#snippet button(tip)}
            <Button {...tip} variant="outline" size="icon" class="size-8" aria-label="Next month" onclick={() => onnext?.()}
              ><ChevronRight class="size-4" /></Button
            >
          {/snippet}
        </IconTip>
        <Button variant="secondary" size="sm" onclick={() => onlatest?.()}>Latest</Button>
      </div>
      <!-- Daily target stepper -->
      <div class="flex items-center gap-1.5 rounded-md border border-border px-2 py-1">
        <span class="text-[11px] text-muted-foreground">Target/day</span>
        <IconTip label="Lower target by $50">
          {#snippet button(tip)}
            <button
              {...tip}
              type="button"
              class="grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Lower target"
              onclick={() => (target = Math.max(0, target - 50))}
            >
              <Minus class="size-3" />
            </button>
          {/snippet}
        </IconTip>
        <span class="w-12 text-center text-xs tabular-nums">${target}</span>
        <IconTip label="Raise target by $50">
          {#snippet button(tip)}
            <button
              {...tip}
              type="button"
              class="grid size-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Raise target"
              onclick={() => (target += 50)}
            >
              <Plus class="size-3" />
            </button>
          {/snippet}
        </IconTip>
      </div>
    {:else}
      <span class="text-sm font-semibold">{year}</span>
    {/if}
    <span
      class={cn(
        'ml-auto text-sm font-semibold tabular-nums',
        (view === 'month' ? monthNet : yearNet) < 0 ? 'text-destructive' : 'text-chart-2'
      )}
    >
      {usdWhole(view === 'month' ? monthNet : yearNet)}
    </span>
  </div>

  <div class="flex flex-col gap-4 xl:flex-row">
    <!-- Left: grid / heatmap -->
    <div class="min-w-0 flex-1">
      {#if view === 'month'}
        <Card.Root class="p-3">
          <!-- A182: minmax(0,1fr) columns + min-w-0/overflow-hidden cells keep the month inside the
               card at mobile widths (no right-edge clipping, no horizontal scroll); the Week summary
               column is desktop-only (it would eat a day column's width on a phone). Day cells are
               square on mobile and the P&L truncates instead of escaping the border. -->
          <div class="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-1 sm:grid-cols-[56px_repeat(7,minmax(0,1fr))] sm:gap-1.5">
            <span class="hidden pb-1 text-[11px] text-muted-foreground sm:block">Week</span>
            {#each DOW_LABEL as d (d)}<span class="pb-1 text-center text-[11px] text-muted-foreground">{d}</span>{/each}
            {#each weeks as w, wi (wi)}
              <div
                class="hidden flex-col justify-center gap-0.5 rounded-md border border-border bg-secondary px-1 py-1.5 text-center sm:flex"
              >
                <div class="text-[9px] uppercase tracking-wide text-muted-foreground">Wk {w.wk}</div>
                <div
                  class={cn(
                    'text-[10px] font-semibold tabular-nums',
                    w.days ? (w.pnl >= 0 ? 'text-chart-2' : 'text-destructive') : 'text-muted-foreground'
                  )}
                >
                  {w.days ? usdWhole(w.pnl) : '$0'}
                </div>
                <div class="text-[9px] text-muted-foreground">{w.days}d</div>
              </div>
              {#each w.cells as c, ci (ci)}
                {#if c}
                  {@const hit = !!c.rec && c.rec.pnl >= target}
                  <button
                    type="button"
                    data-testid="cal-day"
                    onclick={() => (selectedDay = selectedDay === c.day ? null : c.day)}
                    title={c.rec?.tags?.length ? `Day tags: ${c.rec.tags.join(' · ')}` : undefined}
                    class={cn(
                      'relative flex aspect-square min-w-0 flex-col overflow-hidden rounded-md border p-1 text-left transition-colors sm:aspect-auto sm:min-h-20 sm:p-1.5',
                      c.rec ? shade(c.rec.pnl) : '',
                      c.rec ? (c.rec.pnl >= 0 ? 'border-chart-2/30' : 'border-destructive/30') : 'border-border hover:border-ring',
                      selectedDay === c.day && 'ring-2 ring-primary'
                    )}
                  >
                    {#if hit}<span
                        class="absolute right-1 top-1 grid size-3 place-items-center rounded-full bg-chart-2 text-background"
                        title="Hit daily target"><Check class="size-2" /></span
                      >{/if}
                    <span
                      class={cn('flex items-center gap-1 text-[11px]', c.rec ? 'font-medium text-foreground' : 'text-muted-foreground')}
                    >
                      {c.day}{#if c.rec?.note}<span class="size-1.5 rounded-full bg-primary" title="Has a note"></span>{/if}
                    </span>
                    {#if c.rec}
                      <span
                        class={cn(
                          'mt-auto truncate text-right text-[10px] font-semibold tabular-nums sm:text-xs',
                          c.rec.pnl >= 0 ? 'text-chart-2' : 'text-destructive'
                        )}>{usdWhole(c.rec.pnl)}</span
                      >
                      <span class="hidden text-right text-[9px] text-foreground/70 sm:block"
                        >{c.rec.trades} tr · {pct(c.rec.wins, c.rec.trades)}%</span
                      >
                    {/if}
                  </button>
                {:else}
                  <div></div>
                {/if}
              {/each}
            {/each}
          </div>
          <p class="mt-3 text-[11px] text-muted-foreground">
            Cell shade scales with P&L size · <Check class="inline size-3 text-chart-2" /> = hit the ${target}/day target · dot = has a
            note.
          </p>
        </Card.Root>
      {:else}
        <!-- Year heatmap -->
        <Card.Root class="p-4">
          <div class="overflow-x-auto">
            <div class="flex min-w-[680px] justify-between px-0.5 text-[10px] text-muted-foreground">
              {#each MONTH_ABBR as m (m)}<span>{m}</span>{/each}
            </div>
            <div class="mt-1 flex min-w-[680px] gap-[3px]">
              {#each yearCols as col, ci (ci)}
                <div class="flex flex-col gap-[3px]">
                  {#each col as cell, ri (ri)}
                    <div
                      class={cn(
                        'size-[10px] rounded-[2px]',
                        cell ? (cell.trading ? shade(cell.pnl) : 'bg-secondary/50') : 'bg-transparent'
                      )}
                      title={cell?.trading ? `${cell.date} · ${usdWhole(cell.pnl)}` : ''}
                    ></div>
                  {/each}
                </div>
              {/each}
            </div>
          </div>
          <!-- A164: the legend renders actual ramp steps (NEG/POS above), so it can't drift from the heatmap. -->
          <div class="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>Loss</span>
            <span class={cn('size-[10px] rounded-[2px]', NEG[4])}></span>
            <span class={cn('size-[10px] rounded-[2px]', NEG[1])}></span>
            <span class="size-[10px] rounded-[2px] bg-secondary/50"></span>
            <span class={cn('size-[10px] rounded-[2px]', POS[1])}></span>
            <span class={cn('size-[10px] rounded-[2px]', POS[4])}></span>
            <span>Profit</span>
          </div>
        </Card.Root>
      {/if}
    </div>

    <!-- Right rail: day detail + summary -->
    <div class="flex shrink-0 flex-col gap-4 xl:w-80">
      {#if view === 'month' && selectedDay && sel}
        <!-- A146: the day detail slides in beside the grid (instant under reduced motion). -->
        <div in:fly={{ x: 16, duration: dur(150) }}>
          <Card.Root>
            <div class="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span class="text-sm font-semibold">{monthLabel.split(' ')[0]} {selectedDay}, {year}</span>
              <button
                type="button"
                class="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close day detail"
                onclick={() => (selectedDay = null)}
              >
                <X class="size-4" />
              </button>
            </div>
            <div class="space-y-3 p-4">
              <!-- Day stats -->
              <div class="grid grid-cols-2 gap-2">
                {@render stat('Day P&L', usdWhole(sel.pnl), tone(sel.pnl))}
                {@render stat('Win rate', `${pct(sel.wins, sel.trades)}%`)}
                {@render stat('Best trade', bestTrade ? usdWhole(bestTrade.pnl) : '—', 'pos')}
                {@render stat('Worst trade', worstTrade ? usdWhole(worstTrade.pnl) : '—', 'neg')}
              </div>

              <!-- Trades list -->
              <div>
                <div class="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Trades · {sel.trades}</div>
                <div class="overflow-hidden rounded-md border border-border">
                  {#each dayTrades as t, i (i)}
                    <div class={cn('flex items-center gap-2 px-2.5 py-1.5 text-xs', i > 0 && 'border-t border-border')}>
                      <span class="tabular-nums text-muted-foreground">{t.time || '—'}</span>
                      <span class="font-medium">{t.sym}</span>
                      <Badge
                        variant="outline"
                        class={t.side === 'Long' ? 'border-chart-2/40 text-chart-2' : 'border-destructive/40 text-destructive'}
                        >{t.side}</Badge
                      >
                      <span class="text-muted-foreground">×{t.qty}</span>
                      <span class={cn('ml-auto font-semibold tabular-nums', t.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}
                        >{usdWhole(t.pnl)}</span
                      >
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
              </div>

              <!-- Tags -->
              <div>
                <div class="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Tags</div>
                <div class="mb-1.5 flex flex-wrap gap-1">
                  {#each tags as t (t)}
                    <Badge variant="secondary" class="gap-1">
                      {t}<button
                        type="button"
                        class="text-muted-foreground hover:text-foreground"
                        aria-label="Remove tag {t}"
                        onclick={() => removeTag(t)}><X class="size-3" /></button
                      >
                    </Badge>
                  {/each}
                  {#if !tags.length}<span class="text-xs text-muted-foreground">No tags</span>{/if}
                </div>
                <TagInput bind:value={tagDraft} suggestions={tagVocab} onadd={addTag} />
              </div>

              <!-- Screenshots -->
              <div>
                <div class="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <Paperclip class="size-3" /> Screenshots
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  {#each shots as shot, i (i)}
                    <span class="relative inline-block">
                      <button type="button" class="block" onclick={() => (zoomShot = shot)} aria-label="Enlarge screenshot {i + 1}">
                        <img src={shot} alt="screenshot {i + 1}" class="block h-12 rounded-md border border-border" />
                      </button>
                      <IconTip label="Remove screenshot">
                        {#snippet button(tip)}
                          <button
                            {...tip}
                            type="button"
                            class="absolute -right-1.5 -top-1.5 grid size-[18px] place-items-center rounded-full bg-destructive text-white"
                            aria-label="Remove screenshot"
                            onclick={() => removeShot(i)}><X class="size-3" /></button
                          >
                        {/snippet}
                      </IconTip>
                    </span>
                  {/each}
                  <label
                    class="grid aspect-video w-16 cursor-pointer place-items-center rounded border border-dashed border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label="Add screenshot"
                  >
                    <ImagePlus class="size-4" />
                    <input type="file" accept="image/*" class="hidden" onchange={addShot} />
                  </label>
                </div>
              </div>

              <div class="flex justify-end">
                <Button size="sm" onclick={() => selectedDay && onsavenote?.(selectedDay, note, tags, shots)}>Save note</Button>
              </div>
            </div>
          </Card.Root>
        </div>
      {/if}

      <!-- Month / year summary -->
      <Card.Root>
        <div class="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {view === 'month' ? `${monthLabel.split(' ')[0]} summary` : `${year} summary`}
        </div>
        <div class="space-y-3 p-4">
          {#if view === 'month'}
            <div class="grid grid-cols-2 gap-2">
              {@render stat('Net P&L', usdWhole(monthNet), tone(monthNet))}
              {@render stat('Avg / day', usdWhole(Math.round(avgDay)), tone(avgDay))}
              {@render stat('Win days', `${winDays}`, 'pos')}
              {@render stat('Loss days', `${lossDays}`, 'neg')}
              {@render stat('Best day', bestDay ? usdWhole(bestDay.pnl) : '—', 'pos')}
              {@render stat('Worst day', worstDay ? usdWhole(worstDay.pnl) : '—', 'neg')}
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
                    <span class={cn('font-medium tabular-nums', d.pnl >= 0 ? 'text-chart-2' : 'text-destructive')}>{usdWhole(d.pnl)}</span>
                  </div>
                {/each}
              </div>
            </div>
          {:else}
            <div class="grid grid-cols-2 gap-2">
              {@render stat('Net P&L', usdWhole(yearNet), tone(yearNet))}
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

<!-- Screenshot lightbox (shared part — A152): 'Enlarge screenshot' had no dialog before. -->
<ScreenshotLightbox shot={zoomShot} onclose={() => (zoomShot = null)} />
