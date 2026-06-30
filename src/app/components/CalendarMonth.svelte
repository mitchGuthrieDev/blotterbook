<script lang="ts">
  // Sunday-first month calendar of daily P&L, derived from compute()'s m.days (A29 — no
  // recomputation). The cursor starts on the latest trade's month. Includes day-note dots, day
  // selection → dashboard scoping + curve cross-link, and the left ISO-Week column (A40).
  import { pad2, usd, money, usdWhole, isoWeek } from '../../lib/core/core.ts';
  import type { Metrics } from '../../lib/core/core.ts';
  import type { PanelBundle } from '../../lib/core/types.ts';
  import type { Snippet } from 'svelte';
  import Panel from './Panel.svelte';
  import { Button } from '$ui/button';

  // year/month are owned by App (so the all-time/month scope toggle can read the same cursor);
  // onnav(delta) asks App to shift the month. metrics here is the FILTERED all-time set, so the
  // grid colors reflect the active filters regardless of scope. selectedDate + journalDates +
  // onselect wire the day-notes journal: clicking a day selects it; days with a note get a dot.
  // `extra` is App's snippet for the contextual day-note editor, rendered inside this panel's body.
  interface Props {
    metrics: Metrics;
    year: number;
    month: number;
    onnav: (delta: number) => void;
    onjump?: () => void;
    selectedDate?: string | null;
    journalDates?: Set<string>;
    onselect?: (d: string) => void;
    panel?: PanelBundle;
    extra?: Snippet;
  }
  let { metrics, year, month, onnav, onjump = () => {}, selectedDate = null, journalDates = new Set(), onselect = () => {}, panel = {} as PanelBundle, extra }: Props = $props();

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // A97 (R18 — promoted to all surfaces, CH16): the calendar-day grouping caveat sits on the calendar
  // it describes, distributed from the standalone Definitions panel.

  const byDate = $derived(new Map((metrics && metrics.days ? metrics.days : []).map(d => [d.date, d])));
  // Weeks of the displayed month, each carrying its ISO week no. + weekly P&L + traded-day count
  // for the left Week column (A40 — parity with the vanilla render.js calendar). Mirrors the vanilla
  // 6-row, Sunday-first sweep (off-month days render as empty cells; rows past the month stop).
  const weeks = $derived(buildWeeks(year, month, byDate));
  const monthNet = $derived(weeks.reduce((a, w) => a + w.weekPnl, 0));

  function buildWeeks(y: number, m: number, map: Map<string, Metrics['days'][number]>) {
    const offset = new Date(y, m, 1).getDay(); // 0 = Sunday
    const cur = new Date(y, m, 1 - offset);
    const rows = [];
    for (let w = 0; w < 6; w++) {
      const cells = [];
      let weekPnl = 0,
        weekDays = 0,
        monthHit = false;
      for (let d = 0; d < 7; d++) {
        const yy = cur.getFullYear(),
          mo = cur.getMonth(),
          da = cur.getDate();
        const inMonth = mo === m;
        if (inMonth) monthHit = true;
        if (!inMonth) {
          cells.push(null);
        } else {
          const date = `${yy}-${pad2(mo + 1)}-${pad2(da)}`;
          const rec = map.get(date);
          if (rec) {
            weekPnl += rec.pnl;
            weekDays++;
          }
          cells.push({ d: da, date, pnl: rec ? rec.pnl : null, trades: rec ? rec.trades : 0, wins: rec ? rec.wins : 0 });
        }
        cur.setDate(cur.getDate() + 1);
      }
      if (w > 0 && !monthHit) break;
      const weekNo = isoWeek(new Date(cur.getTime() - 4 * 864e5)); // Wednesday of this row
      rows.push({ weekNo, weekPnl, weekDays, cells });
    }
    return rows;
  }

  // Compact whole-dollar label for a cell (the full value is in the title tooltip) — usdWhole (A92).
  const compact = usdWhole;
</script>

<Panel {...panel} title="Trading Calendar">
  <!-- A123: the month nav lives in a body TOOLBAR (not the panel header) so a narrow F26-grid column
       can't cram the header — the header stays light (title + menu + chevron) and never wraps, keeping
       the collapse chevron reachable (A121). -->
  <div class="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
    <div class="nav flex flex-wrap items-center gap-2.5">
      <button type="button" class="h-7 w-7 cursor-pointer rounded-md border border-line bg-panel2 text-[16px] leading-none text-txt hover:border-hover-line" aria-label="Previous month" title="Previous month" onclick={() => onnav(-1)}>‹</button>
      <span class="label min-w-[9.5em] text-center font-bold">{MONTHS[month]} {year}</span>
      <button type="button" class="h-7 w-7 cursor-pointer rounded-md border border-line bg-panel2 text-[16px] leading-none text-txt hover:border-hover-line" aria-label="Next month" title="Next month" onclick={() => onnav(1)}>›</button>
      <Button size="sm" class="today h-7 leading-none" title="Jump to the latest trade's month" onclick={() => onjump()}>Latest</Button>
    </div>
    <span class="font-mono font-bold {monthNet < 0 ? 'text-red' : 'text-green'}">{usd(monthNet)}</span>
  </div>

  <div class="calendar">
    <div class="calgrid">
      <span class="dow wk">Week</span>
      {#each DOW as d (d)}<span class="dow">{d}</span>{/each}
      {#each weeks as wk, wi (wi)}
        <div class="wkcell" title="ISO week {wk.weekNo} · {wk.weekDays} traded day{wk.weekDays === 1 ? '' : 's'}">
          <div class="wkno">Wk {wk.weekNo}</div>
          <div class="wkpnl" class:pos={wk.weekPnl > 0} class:neg={wk.weekPnl < 0}>{wk.weekDays ? usd(wk.weekPnl) : '$0.00'}</div>
          <div class="wkdays">{wk.weekDays} day{wk.weekDays === 1 ? '' : 's'}</div>
        </div>
        {#each wk.cells as c, i (i)}
          {#if c}
            <div
              class="cell"
              class:traded={c.pnl != null}
              class:pos={c.pnl != null && c.pnl > 0}
              class:neg={c.pnl != null && c.pnl < 0}
              class:selected={selectedDate === c.date}
              data-date={c.date}
              role="button"
              tabindex="0"
              title={c.pnl != null ? `${c.date}: ${money(c.pnl)} · ${c.trades} trade${c.trades === 1 ? '' : 's'}` : c.date}
              onclick={() => onselect(c.date)}
              onkeydown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onselect(c.date);
                }
              }}
            >
              <span class="dnum">{c.d}{#if journalDates.has(c.date)}<span class="notedot" aria-label="has a note"></span>{/if}</span>
              {#if c.pnl != null}
                <span class="dpnl">{compact(c.pnl)}</span>
                <span class="dmeta">{c.trades} tr · {c.trades ? Math.round((100 * c.wins) / c.trades) : 0}%</span>
              {/if}
            </div>
          {:else}
            <div class="cell empty"></div>
          {/if}
        {/each}
      {/each}
    </div>
  </div>
  <p class="mt-3 text-[11px] leading-[1.45] text-dim">Days are grouped by the literal date in the Time column, not the CME session day.</p>
  {@render extra?.()}
</Panel>

<style>
  .calgrid {
    display: grid;
    grid-template-columns: 52px repeat(7, 1fr);
    gap: 6px;
  }
  .dow {
    font-size: 11px;
    color: var(--faint);
    text-align: center;
    align-self: end;
    padding-bottom: 2px;
  }
  .dow.wk {
    text-align: left;
  }
  .wkcell {
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 5px 4px;
    background: var(--panel2);
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    text-align: center;
  }
  .wkno {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--faint);
  }
  .wkpnl {
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 700;
    color: var(--txt);
  }
  .wkpnl.pos {
    color: var(--green);
  }
  .wkpnl.neg {
    color: var(--red);
  }
  .wkdays {
    font-size: 9px;
    color: var(--dim);
  }
  .cell {
    min-height: 56px;
    border: 1px solid var(--line);
    border-radius: 7px;
    padding: 5px 6px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    cursor: pointer;
  }
  .cell:hover {
    border-color: var(--hover-line);
  }
  .cell:focus-visible {
    outline: 2px solid var(--primary);
    outline-offset: 1px;
  }
  .cell.selected {
    border-color: var(--primary);
    box-shadow: 0 0 0 1px var(--primary) inset;
  }
  .cell.empty {
    border-color: transparent;
    cursor: default;
  }
  .notedot {
    display: inline-block;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--primary);
    margin-left: 4px;
    vertical-align: middle;
  }
  .cell.pos {
    background: var(--green-bg);
    border-color: rgba(63, 185, 80, 0.4);
  }
  .cell.neg {
    background: var(--red-bg);
    border-color: rgba(240, 74, 74, 0.4);
  }
  .dnum {
    font-size: 11px;
    color: var(--dim);
  }
  .dpnl {
    font-family: var(--mono);
    font-size: 12px;
    font-weight: 700;
    text-align: right;
  }
  .cell.pos .dpnl {
    color: var(--green);
  }
  .cell.neg .dpnl {
    color: var(--red);
  }
  .dmeta {
    font-family: var(--mono);
    font-size: 9px;
    color: var(--faint);
    text-align: right;
  }
  /* A51/A123: the 8-col grid scrolls WITHIN the panel rather than clipping its cells or widening the
     page — needed both on phones AND in the narrow F26 grid column (A123), where the panel can be
     narrower than the grid's comfortable width. A min floor keeps day values from clipping; the panel
     absorbs any overflow as an internal scroll. */
  .calendar {
    overflow-x: auto;
  }
  .calgrid {
    min-width: 480px;
  }
  @media (max-width: 620px) {
    .calgrid {
      min-width: 520px;
    }
  }
</style>
