<script>
  // Sunday-first month calendar of daily P&L, derived from compute()'s m.days (A29 — no
  // recomputation). The cursor starts on the latest trade's month. Day-notes dots, selection →
  // dashboard scoping, and the curve cross-link from the vanilla calendar come in later A27 slices.
  import { pad2, usd, money } from '../../core.js';

  // year/month are owned by App (so the all-time/month scope toggle can read the same cursor);
  // onnav(delta) asks App to shift the month. metrics here is the FILTERED all-time set, so the
  // grid colors reflect the active filters regardless of scope. selectedDate + journalDates +
  // onselect wire the day-notes journal: clicking a day selects it; days with a note get a dot.
  let { metrics, year, month, onnav, selectedDate = null, journalDates = new Set(), onselect = () => {} } = $props();

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const byDate = $derived(new Map((metrics && metrics.days ? metrics.days : []).map(d => [d.date, d])));
  const cells = $derived(buildCells(year, month, byDate));
  const monthNet = $derived(cells.reduce((a, c) => a + (c && c.pnl != null ? c.pnl : 0), 0));

  function buildCells(y, m, map) {
    const first = new Date(y, m, 1).getDay(); // 0 = Sunday
    const dim = new Date(y, m + 1, 0).getDate();
    const out = [];
    for (let i = 0; i < first; i++) out.push(null);
    for (let d = 1; d <= dim; d++) {
      const date = `${y}-${pad2(m + 1)}-${pad2(d)}`;
      const rec = map.get(date);
      out.push({ d, date, pnl: rec ? rec.pnl : null, trades: rec ? rec.trades : 0 });
    }
    return out;
  }

  // Compact whole-dollar label for a cell (the full value is in the title tooltip).
  const compact = v => (v < 0 ? '-' : '+') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US');
</script>

<section class="panel calendar">
  <div class="phead">
    <h2>Trading Calendar</h2>
    <div class="nav">
      <button type="button" aria-label="Previous month" onclick={() => onnav(-1)}>‹</button>
      <span class="label">{MONTHS[month]} {year}</span>
      <button type="button" aria-label="Next month" onclick={() => onnav(1)}>›</button>
    </div>
    <span class="mnet" class:neg={monthNet < 0}>{usd(monthNet)}</span>
  </div>

  <div class="dow">
    {#each DOW as d (d)}<span>{d}</span>{/each}
  </div>

  <div class="calgrid">
    {#each cells as c, i (i)}
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
          {#if c.pnl != null}<span class="dpnl">{compact(c.pnl)}</span>{/if}
        </div>
      {:else}
        <div class="cell empty"></div>
      {/if}
    {/each}
  </div>
</section>

<style>
  .panel {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px 16px 16px;
    margin-top: 16px;
  }
  .phead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  h2 {
    margin: 0;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--faint);
    font-weight: 700;
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .nav button {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    width: 28px;
    height: 28px;
    font-size: 16px;
    line-height: 1;
    cursor: pointer;
  }
  .nav button:hover {
    border-color: var(--hover-line);
  }
  .nav .label {
    font-weight: 700;
    min-width: 9.5em;
    text-align: center;
  }
  .mnet {
    font-family: var(--mono);
    font-weight: 700;
    color: var(--green);
  }
  .mnet.neg {
    color: var(--red);
  }
  .dow {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
    font-size: 11px;
    color: var(--faint);
    text-align: center;
    margin-bottom: 6px;
  }
  .calgrid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
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
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .cell.selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 1px var(--accent) inset;
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
    background: var(--accent);
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
</style>
