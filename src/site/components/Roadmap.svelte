<script lang="ts">
  // Roadmap (A69 — ex roadmap.html static markup). Shared chrome + typography come from SiteShell;
  // the checklist (.checks/.tagchip) styles are page-specific and scoped below.
  import SiteShell from '../lib/SiteShell.svelte';
</script>

<SiteShell active="roadmap">
  <p class="eyebrow">The Plan</p>
  <h1>Roadmap</h1>
  <p class="blurb">
    Where <b>Blotterbook</b> is headed — the big picture, not a task list. You already get a full futures journal with a true-cost &amp;
    tax dashboard; next come numbers you can trust to the cent, deeper journaling, and sync across your devices — all built privacy-first.
    For the per-release detail, see the <a href="changelog.html">Changelog</a>.
  </p>

  <h2>Available now</h2>
  <ul class="checks">
    <li class="done">
      <span class="ck">&#10003;</span>
      <div class="ctxt">
        <b>Import from your platform in seconds</b>
        <p>
          Drop in a CSV from TradingView, Tradovate, Rithmic, Sierra&nbsp;Chart, TradeStation, MotiveWave, Webull, IBKR or
          Schwab/thinkorswim — the format is auto-detected, and re-uploads merge so only new trades are added.
        </p>
      </div>
    </li>
    <li class="done">
      <span class="ck">&#10003;</span>
      <div class="ctxt">
        <b>Your <i>true</i> P&amp;L, not just gross</b>
        <p>
          Every trade is costed with broker commissions, exchange &amp; NFA fees, your data-feed and platform subscriptions, and a
          Section&nbsp;1256 tax estimate — so you see net and real take-home, plus the break-even you need per trade.
        </p>
      </div>
    </li>
    <li class="done">
      <span class="ck">&#10003;</span>
      <div class="ctxt">
        <b>A dashboard that fills the screen</b>
        <p>
          An equity curve with gross / net / take-home overlays, a P&amp;L calendar, win rate, profit factor, drawdown and more —
          edge-to-edge on a wide monitor, single column on your phone.
        </p>
      </div>
    </li>
    <li class="done">
      <span class="ck">&#10003;</span>
      <div class="ctxt">
        <b>Arrange it your way</b>
        <p>Drag to reorder the modules, collapse what you don't need, and save named workspace layouts to switch between views.</p>
      </div>
    </li>
    <li class="done">
      <span class="ck">&#10003;</span>
      <div class="ctxt">
        <b>Filter, focus, and journal</b>
        <p>
          Slice by date range, symbol, side, session or weekday and save the filter views you reuse; keep day-by-day notes plus per-trade
          tags, notes, and screenshots.
        </p>
      </div>
    </li>
    <li class="done">
      <span class="ck">&#10003;</span>
      <div class="ctxt">
        <b>Reports worth sharing</b>
        <p>A clean, condensed performance report you can preview and download as PDF, image, or Markdown — or email to yourself.</p>
      </div>
    </li>
    <li class="done">
      <span class="ck">&#10003;</span>
      <div class="ctxt">
        <b>Private by default</b>
        <p>
          Everything runs and stays in your browser — no account, nothing uploaded. Back up or restore your entire journal as a single
          file anytime, and try it first on the live sample-data demo.
        </p>
      </div>
    </li>
  </ul>

  <h2>In progress</h2>
  <ul class="checks">
    <li class="now">
      <span class="ck">&#9679;</span>
      <div class="ctxt">
        <b>Numbers you can trust to the cent<span class="tagchip prio">High priority</span></b>
        <p>
          Today's fees and tax rates are careful estimates. We're wiring them to official sources — CME/exchange fee schedules, per-broker
          data-feed price lists, and per-state tax tables, refreshed on a schedule — so your cost and take-home figures are exact, not
          approximate.
        </p>
      </div>
    </li>
    <li class="now">
      <span class="ck">&#9679;</span>
      <div class="ctxt">
        <b>Broader, verified platform coverage</b>
        <p>
          Confirming each importer against real exports, widening the contract/point-value coverage, and adding a manual column-mapping
          fallback for any format we don't yet recognize.
        </p>
      </div>
    </li>
    <li class="now">
      <span class="ck">&#9679;</span>
      <div class="ctxt">
        <b>Deeper journaling</b>
        <p>
          The analytics serious traders expect: R-multiple and risk tracking, MAE/MFE (how far each trade ran for and against you), and
          setup tagging — toward full journal parity.
        </p>
      </div>
    </li>
  </ul>

  <h2>Planned</h2>
  <ul class="checks">
    <li class="next">
      <span class="ck">&#9633;</span>
      <div class="ctxt">
        <b>Sync across your devices<span class="tagchip stretch">$5/mo</span></b>
        <p>
          End-to-end-encrypted sync of your trades, notes, tags, and saved views, so your journal follows you to any device — and we never
          see your data. The one optional paid add-on; everything else stays free.
        </p>
      </div>
    </li>
    <li class="next">
      <span class="ck">&#9633;</span>
      <div class="ctxt">
        <b>Connect your broker directly</b>
        <p>Optionally pull fills, commissions, and live rates straight from your platform — and skip the CSV step entirely.</p>
      </div>
    </li>
    <li class="next">
      <span class="ck">&#9633;</span>
      <div class="ctxt">
        <b>Replay any trade on a chart<span class="tagchip stretch">Stretch</span></b>
        <p>Reconstruct a price chart with your entry and exit for each trade, straight from the imported data, for visual review.</p>
      </div>
    </li>
    <li class="next">
      <span class="ck">&#9633;</span>
      <div class="ctxt">
        <b>A power-user workspace</b>
        <p>
          Resizable, snapping modules; multiple tabbed workspaces; and Portfolios that capture a full set of layouts and data — a
          trading-terminal feel for traders who want it.
        </p>
      </div>
    </li>
  </ul>

  <div class="note">
    <b>Have an idea or a bug?</b> Tell us what would make Blotterbook more useful —
    <a href="mailto:contact@blotterbook.com?subject=Blotterbook%20roadmap">contact@blotterbook.com</a>.
  </div>
</SiteShell>

<style>
  /* checklist (roadmap) */
  .checks {
    list-style: none;
    padding: 0;
    margin: 18px 0 0;
  }
  .checks li {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 11px 0;
    border-bottom: 1px solid var(--line);
  }
  .checks li .ck {
    flex: none;
    width: 20px;
    height: 20px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 1px;
    font-size: 12px;
    border: 1px solid var(--line);
  }
  .checks li.done .ck {
    background: rgba(63, 185, 80, 0.14);
    border-color: rgba(63, 185, 80, 0.45);
    color: var(--green);
  }
  .checks li.now .ck {
    background: rgba(106, 160, 255, 0.14);
    border-color: rgba(106, 160, 255, 0.5);
    color: var(--accent);
  }
  .checks li.next .ck {
    color: var(--faint);
  }
  .checks .ctxt {
    flex: 1;
  }
  .checks .ctxt b {
    color: var(--txt);
  }
  /* shipped items read as available (not crossed-off tasks) — the green check carries the status */
  .checks li.done .ctxt b {
    color: var(--txt);
  }
  .checks .ctxt p {
    margin: 3px 0 0;
    font-size: 13.5px;
    color: var(--dim);
    line-height: 1.5;
  }
  .tagchip {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    padding: 2px 8px;
    border-radius: 999px;
    margin-left: 8px;
    vertical-align: middle;
  }
  .tagchip.prio {
    color: var(--warn);
    background: rgba(227, 179, 65, 0.12);
    border: 1px solid rgba(227, 179, 65, 0.35);
  }
  .tagchip.stretch {
    color: var(--take);
    background: rgba(201, 139, 255, 0.12);
    border: 1px solid rgba(201, 139, 255, 0.3);
  }
</style>
