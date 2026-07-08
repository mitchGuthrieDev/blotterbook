<script lang="ts">
  // Help > Importing your trades (A273 — migrated verbatim from the old Howto.svelte "What is
  // futures trading?" background + the ten per-platform import sections; anchor ids unchanged so old
  // #imp-* deep links keep working. The add-adapter workflow appends one section here — see
  // .claude/skills/add-adapter/SKILL.md). Shared chrome from HelpShell; `.steps` styling is global,
  // defined in HelpShell itself.
  import HelpShell from '../lib/HelpShell.svelte';

  const platforms: { id: string; label: string }[] = [
    { id: 'imp-tradingview', label: 'TradingView' },
    { id: 'imp-tradovate', label: 'Tradovate' },
    { id: 'imp-quantower', label: 'Quantower' },
    { id: 'imp-atas', label: 'ATAS X' },
    { id: 'imp-rithmic', label: 'Rithmic R|Trader' },
    { id: 'imp-sierrachart', label: 'Sierra Chart' },
    { id: 'imp-tradestation', label: 'TradeStation' },
    { id: 'imp-motivewave', label: 'MotiveWave' },
    { id: 'imp-webull', label: 'Webull' },
    { id: 'imp-ibkr', label: 'Interactive Brokers' },
    { id: 'imp-schwab', label: 'Schwab / thinkorswim' },
  ];
</script>

<HelpShell active="import">
  <p class="eyebrow">Blotterbook Help</p>
  <h1>Importing your trades</h1>
  <p class="blurb">
    Exporting the right CSV from your platform, one section per platform. Remember: parsing is keyed to the <b>platform</b> you export from
    — your broker is a separate, cost-only setting (see <a href="/help/getting-started.html#gs-setup">Broker &amp; costs</a>).
  </p>

  <nav class="flex flex-wrap gap-1.5 my-4" aria-label="Jump to a platform">
    {#each platforms as p (p.id)}
      <a
        class="rounded-[7px] border border-border bg-card px-2.5 py-1 text-[12px] text-muted-foreground no-underline hover:border-primary/50 hover:text-foreground hover:no-underline"
        href="#{p.id}">{p.label}</a
      >
    {/each}
  </nav>

  <!-- ============ BACKGROUND ============ -->
  <section id="intro-futures" class="scroll-mt-[72px]">
    <h2 class="mt-0">What is futures trading?</h2>
    <p>
      A <b>futures contract</b> is a standardized agreement to buy or sell something — a stock index, crude oil, gold, the euro — at a set
      price on a future date. Traders rarely hold to delivery; they buy and sell the contracts themselves to profit from price moves, then
      close out before expiry. Index futures like the <b>E-mini S&amp;P 500 (ES)</b> and its smaller <b>Micro (MES)</b>
      sibling are among the most actively traded.
    </p>
    <p>
      Two things set futures apart from buying shares: <b>leverage</b> — a single contract controls a large notional value for a small
      margin deposit, so gains <i>and</i> losses are amplified — and <b>standardization</b> — every contract's size, tick value, and trading hours
      are fixed by the exchange. That leverage is exactly why tracking your real, after-cost performance matters: small per-trade costs compound
      fast.
    </p>
    <p><b>Getting set up — broker, platform, and data feed.</b> Three separate pieces that are easy to confuse:</p>
    <ol class="steps">
      <li>
        <b>Broker</b> — the firm that holds your account and routes orders to the exchange. It sets your <b>commission</b> per contract. Choose
        on commissions, funding terms, supported markets, and reputation.
      </li>
      <li>
        <b>Platform</b> — the software you actually chart and trade in (TradingView, Tradovate, Sierra Chart, …). Some brokers bundle one;
        many platforms connect to several brokers, sometimes for a monthly <b>platform fee</b>. This is the piece you export your CSV from
        for Blotterbook.
      </li>
      <li>
        <b>Data feed</b> — the real-time market data your platform displays, billed monthly by the exchange (e.g. CME) and/or the platform. Non-professional
        feeds are inexpensive; pick the markets you actually trade.
      </li>
    </ol>
    <p>Together these are your true cost of trading — commissions per round-turn plus monthly subscriptions — on top of any taxes owed.</p>
    <p>
      <b>Where Blotterbook fits.</b> Blotterbook is the journal that ties it together. Export a CSV from your <b>platform</b>, set your
      <b>broker</b>, <b>data feed</b>, and <b>state</b> once, and it shows your performance <b>after</b> commissions, subscriptions, and an
      estimated Section&nbsp;1256 tax — not just gross P&amp;L — entirely in your browser, with nothing uploaded. Ready to start? See
      <a href="/help/getting-started.html">Getting started</a>.
    </p>
  </section>

  <!-- ============ IMPORTING BY PLATFORM ============ -->
  <section id="imp-tradingview" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">
      TradingView
      <span
        class="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] px-[9px] py-[3px] rounded-[7px] border border-chart-2/40 bg-chart-2/10 text-chart-2"
        ><span class="w-[7px] h-[7px] rounded-full bg-chart-2"></span>Tested on real data</span
      >
    </h2>
    <p>Blotterbook's reference format. Works with the Paper Trading account and connected brokers. Two export types import:</p>
    <ol class="steps">
      <li>
        Open the <b>Trading Panel</b> at the bottom of the chart, pick the <b>Account</b> (e.g. Paper Trading), then the <b>History</b> tab.
      </li>
      <li>
        Click the <b>&#8942;</b> (column-picker) above the table and check every column — TradingView only exports the columns currently
        visible, and a hidden <code>Status</code> or <code>Commission</code> column silently drops that data from the file.
      </li>
      <li>
        Click the download icon in the table's top-right corner, choose <b>Balance history</b> or <b>Order history</b> from the dropdown,
        and click <b>Download</b> — each produces its own CSV, and you can repeat for both.
      </li>
    </ol>
    <p>
      <b>Balance history</b> (recommended) — columns <code>Time</code>, <code>Action</code>, <code>Realized PnL (value)</code>. Each row is
      a closed position, so P&amp;L is exact and no hold time is derived.
    </p>
    <p>
      <b>Order history</b> — columns <code>Symbol</code>, <code>Side</code>, <code>Fill price</code>, <code>Status</code>,
      <code>Closing time</code>. A fills export: Blotterbook pairs entries→exits, which unlocks <b>hold time</b>, and reads the
      <code>Commission</code> column when your broker fills it in. One caveat: this export only reaches back a limited number of orders — if it
      starts mid-position, the earliest round trips can misprice (you'll see an open-lots notice on import). Import both and Blotterbook reconciles
      them automatically: identical trades de-duplicate and enrich each other, and where the two disagree the balance history's exact P&amp;L
      wins over the derived figure — in either import order. The other exports on that panel (positions, orders, trading journal) aren't trade
      data — Blotterbook will decline them.
    </p>
  </section>

  <section id="imp-tradovate" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">
      Tradovate / NinjaTrader
      <span
        class="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] px-[9px] py-[3px] rounded-[7px] border border-chart-2/35 bg-chart-2/10 text-chart-2"
        ><span class="w-[7px] h-[7px] rounded-full bg-chart-2"></span>Verified · real exports</span
      >
    </h2>
    <p>
      NinjaTrader (web) runs on the Tradovate platform, so both apps produce the <b>same</b> export files — everything below applies to either.
    </p>
    <ol class="steps">
      <li>Click your account name (top of the platform) → the gear icon → <b>Account Reports</b>.</li>
      <li>Pick a report type from the tabs there, set the account and date range, then click <b>Download Report</b> to get a CSV.</li>
    </ol>
    <p>Blotterbook reads three of the report types; import any or all of them (overlapping trades merge, never double-count):</p>
    <ol class="steps">
      <li>
        <b>Performance</b> — the platform's own round-trip pairing (P&amp;L, quantities, entry/exit times, hold time). The best single file to
        import.
      </li>
      <li>
        <b>Fills</b> — per-fill executions <b>with your real commissions</b>, which override Blotterbook's modeled rates per trade.
      </li>
      <li>
        <b>Orders</b> (<code>Orders.csv</code>) — also supported; no commission column, so modeled rates apply.
      </li>
    </ol>
    <p>
      The other report types on that panel (Cash History, Account Balance History, Position History) aren't per-trade data — Blotterbook
      will decline them. Cash History does list per-contract commission cash lines if you need to sanity-check Fills against the broker's
      own numbers.
    </p>
  </section>

  <section id="imp-quantower" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">
      Quantower
      <span
        class="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] px-[9px] py-[3px] rounded-[7px] border border-chart-2/35 bg-chart-2/10 text-chart-2"
        ><span class="w-[7px] h-[7px] rounded-full bg-chart-2"></span>Verified · real exports</span
      >
    </h2>
    <ol class="steps">
      <li>In Quantower, open the <b>Trades</b> panel (not <b>Orders history</b> — that's order lifecycle, not trade data).</li>
      <li>Right-click the panel's tab → <b>Export data</b>, pick <b>comma separated</b>, and check every column.</li>
      <li>Click <b>Export file</b> — you'll get <code>Trades.csv</code>.</li>
    </ol>
    <p>
      Detected columns: <code>Side</code>, <code>Symbol</code>, <code>Price</code>, <code>Gross P/L</code>, <code>Fee</code>,
      <code>Date/Time</code>. Each fill carries its own realized P&amp;L — Blotterbook uses those exact figures when pairing your round
      trips — and the <code>Fee</code> column supplies your real per-fill costs, which override the modeled commission rates.
    </p>
  </section>

  <section id="imp-atas" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">
      ATAS X
      <span
        class="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] px-[9px] py-[3px] rounded-[7px] border border-chart-2/35 bg-chart-2/10 text-chart-2"
        ><span class="w-[7px] h-[7px] rounded-full bg-chart-2"></span>Verified · real exports</span
      >
    </h2>
    <ol class="steps">
      <li>
        In ATAS X, open your account <b>Statistics</b> and use <b>Export</b> — the platform writes a single <code>.xlsx</code> workbook for
        the selected account and date range (e.g. <code>ATAS X_statistics_….xlsx</code>), not a CSV.
      </li>
      <li>
        Import that <code>.xlsx</code> file directly — no need to re-save it as CSV. Like everything else, it's read entirely in your
        browser; only the <b>Journal</b> sheet inside is used.
      </li>
    </ol>
    <p>
      The workbook carries three sheets — Statistics (aggregates), <b>Journal</b> (closed round trips — the part that imports), and
      Executions. Detected columns: <code>Instrument</code>, <code>Open time</code>/<code>Close time</code>,
      <code>Open price</code>/<code>Close price</code>, <code>Open volume</code>, <code>PnL</code>. Each row is a finished round trip, so
      P&amp;L is exact and <b>hold time</b> comes straight from the open/close timestamps; the export carries no explicit direction column, so
      long/short is derived from the price move against the P&amp;L sign. The export has no commission column — modeled rates apply.
    </p>
  </section>

  <section id="imp-rithmic" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">
      Rithmic R|Trader
      <span
        class="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] px-[9px] py-[3px] rounded-[7px] border border-chart-4/35 bg-chart-4/10 text-chart-4"
        ><span class="w-[7px] h-[7px] rounded-full bg-chart-4"></span>Beta · synthetic-tested</span
      >
    </h2>
    <ol class="steps">
      <li>
        In R&nbsp;|&nbsp;Trader, click <b>File → Orders History</b>, pick the account, and set the date — Rithmic exports one day at a time,
        so pull each session separately for a longer history.
      </li>
      <li>
        In the <b>Completed Orders</b> section (not Working Orders), right-click the column headers to add any that are missing — Rithmic only
        exports the columns currently visible in the grid.
      </li>
      <li>
        Confirm <b>Buy/Sell</b>, <b>Symbol</b>, <b>Qty Filled</b>, <b>Avg Fill Price</b>, and a time column (<code>Update Time</code> or
        <code>Create Time</code>) are shown, then use the export icon to save a <b>CSV</b>.
      </li>
    </ol>
    <p>
      Detected columns: <code>Buy/Sell</code>, <code>Symbol</code>, <code>Qty Filled</code>, <code>Avg Fill Price</code>,
      <code>Update Time</code> (fills).
    </p>
  </section>

  <section id="imp-sierrachart" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">
      Sierra Chart
      <span
        class="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] px-[9px] py-[3px] rounded-[7px] border border-chart-4/35 bg-chart-4/10 text-chart-4"
        ><span class="w-[7px] h-[7px] rounded-full bg-chart-4"></span>Beta · synthetic-tested</span
      >
    </h2>
    <ol class="steps">
      <li>Open <b>Trade → Trade Activity Log</b> to open the log window for the chart's symbol/account.</li>
      <li>
        From that window's <b>File</b> menu use <b>Save Log As…</b> — not <b>Export</b>, which writes raw, unadjusted prices that won't
        match what you see in the log — to save a tab-separated text file.
      </li>
      <li>Before saving, keep the <b>Symbol</b>, <b>Quantity</b>, <b>BuySell</b>, <b>FillPrice</b>, and date/time columns visible.</li>
    </ol>
    <p>
      The file is usually <b>tab-separated</b>; Blotterbook handles that automatically. Detected columns: <code>BuySell</code>,
      <code>Symbol</code>, <code>FillPrice</code>, <code>Quantity</code>, <code>DateTime</code> (fills).
    </p>
  </section>

  <section id="imp-tradestation" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">
      TradeStation
      <span
        class="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] px-[9px] py-[3px] rounded-[7px] border border-chart-4/35 bg-chart-4/10 text-chart-4"
        ><span class="w-[7px] h-[7px] rounded-full bg-chart-4"></span>Beta · synthetic-tested</span
      >
    </h2>
    <ol class="steps">
      <li>Log into <b>TradeStation Client Center</b> (the web portal) and open the <b>Accounts</b> tab.</li>
      <li>
        Pick your account and a date range — TradeStation caps each download at roughly six months, so pull multiple ranges to cover a
        longer history.
      </li>
      <li>Check <b>Exclude broken/canceled trades</b>, choose <b>CSV</b> as the format, and click <b>View / Download</b>.</li>
    </ol>
    <p>
      Detected columns: <code>Symbol</code>, <code>Type</code> (Buy/Sell), <code>Quantity</code>, <code>Price</code>,
      <code>Date/Time</code> (fills). Verify the filled price column is populated.
    </p>
  </section>

  <section id="imp-motivewave" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">
      MotiveWave
      <span
        class="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] px-[9px] py-[3px] rounded-[7px] border border-chart-4/35 bg-chart-4/10 text-chart-4"
        ><span class="w-[7px] h-[7px] rounded-full bg-chart-4"></span>Beta · synthetic-tested</span
      >
    </h2>
    <ol class="steps">
      <li>Add a <b>Trades</b> panel to your workspace (sometimes labeled Trade Report).</li>
      <li>
        Use the panel's <b>Export</b> button (top-right corner) to save the trade list as CSV. If you don't see an Export button, you're likely
        looking at a summary/stats view rather than the trade list itself — those don't export.
      </li>
    </ol>
    <p>
      Detected columns: <code>Instrument</code>, <code>Side</code>, <code>Entry/Exit Price</code>, <code>Entry/Exit Time</code>,
      <code>P/L</code>. These are closed round-trips, so hold time comes straight from the export.
    </p>
  </section>

  <section id="imp-webull" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">
      Webull
      <span
        class="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] px-[9px] py-[3px] rounded-[7px] border border-chart-4/35 bg-chart-4/10 text-chart-4"
        ><span class="w-[7px] h-[7px] rounded-full bg-chart-4"></span>Beta · synthetic-tested</span
      >
    </h2>
    <ol class="steps">
      <li>On Webull <b>desktop</b>, go to <b>Account → Orders → Order History</b>.</li>
      <li>
        Select a date range and click <b>Export</b>. Webull caps each export at 90 days — for a longer history, repeat with back-to-back
        90-day windows and import each CSV (overlapping rows de-duplicate).
      </li>
    </ol>
    <p>
      Detected columns: <code>Symbol</code>, <code>Side</code>, <code>Status</code>, <code>Filled</code>, <code>Avg Price</code>,
      <code>Filled Time</code> (equities fills; only filled rows are used).
    </p>
  </section>

  <section id="imp-ibkr" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">
      Interactive Brokers
      <span
        class="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] px-[9px] py-[3px] rounded-[7px] border border-chart-4/35 bg-chart-4/10 text-chart-4"
        ><span class="w-[7px] h-[7px] rounded-full bg-chart-4"></span>Beta · synthetic-tested</span
      >
    </h2>
    <ol class="steps">
      <li>
        In IBKR's <b>Client Portal</b>, go to <b>Performance &amp; Reports → Flex Queries</b> and create a new <b>Trade Confirmation</b>
        Flex Query.
      </li>
      <li>
        Under <b>Executions</b>, select every field — at minimum you need <b>DateTime</b>, <b>Symbol</b>, <b>Buy/Sell</b>,
        <b>Quantity</b>, <b>TradePrice</b>, and (ideally) <b>Realized&nbsp;P/L</b> and <b>IBCommission</b> — set the output format to
        <b>CSV</b>, and save.
      </li>
      <li>
        Back on the Flex Queries list, run your saved query, pick a date range, and download the <b>CSV</b>. An Activity Statement export
        works too, as long as it includes the same trade-execution fields.
      </li>
    </ol>
    <p>
      When the export carries <code>Realized&nbsp;P/L</code> per closing row, Blotterbook uses it directly; otherwise P&amp;L is computed from
      price &times; the contract's point value.
    </p>
  </section>

  <section id="imp-schwab" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">
      Schwab / thinkorswim
      <span
        class="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] px-[9px] py-[3px] rounded-[7px] border border-chart-4/35 bg-chart-4/10 text-chart-4"
        ><span class="w-[7px] h-[7px] rounded-full bg-chart-4"></span>Beta · synthetic-tested</span
      >
    </h2>
    <ol class="steps">
      <li>Open the desktop <b>thinkorswim</b> platform → <b>Monitor → Account Statement</b>.</li>
      <li>
        Set the date range — for a first import, pull as far back as your account allows — then the gear icon →
        <b>Export to file</b> → <b>CSV</b>.
      </li>
    </ol>
    <p>
      The export has several sections; Blotterbook locates the <b>Account Trade History</b> block (columns <code>Exec Time</code>,
      <code>Side</code>, <code>Qty</code>, <code>Pos Effect</code>, <code>Symbol</code>, <code>Price</code>) and pairs the fills.
    </p>
    <div class="note warn">
      Multi-section statements vary the most between versions — double-check the parsed trades against your statement, and tell us if a
      column looks off.
    </div>
  </section>

  <p class="endnote">
    Platform steps may change as brokers update their exports — if a CSV looks misparsed,
    <a href="mailto:contact@blotterbook.com?subject=Blotterbook">let us know</a>, or see <a href="/help/support.html">Support</a>.
  </p>
</HelpShell>
