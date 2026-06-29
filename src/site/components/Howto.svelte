<script lang="ts">
  // How-To wiki (A69 — ex howto.html static markup). Shared chrome + typography from SiteShell
  // (wide layout); the wiki layout, step lists, status pills, and app-module mockups are
  // page-specific and scoped below.
  import SiteShell from '../lib/SiteShell.svelte';
</script>

<SiteShell active="howto" wide>
  <p class="eyebrow">The Wiki</p>
  <h1>How to use Blotterbook</h1>
  <p class="blurb">
    A reference for getting set up and for exporting the right CSV from each supported trading platform. Remember: parsing is keyed to the
    <b>platform</b> you export from — your broker is a separate, cost-only setting.
  </p>

  <div class="wikilayout">
    <nav class="wikinav" aria-label="How-to contents">
      <div class="grp">Background</div>
      <a href="#intro-futures">What is futures trading?</a>
      <div class="grp">Getting started</div>
      <a href="#gs-firstrun">First run</a>
      <a href="#gs-setup">Broker &amp; costs</a>
      <a href="#gs-load">Loading your CSV</a>
      <a href="#gs-dashboard">Reading the dashboard</a>
      <a href="#gs-manage">Managing &amp; backing up data</a>
      <div class="grp">Importing by platform</div>
      <a href="#imp-tradingview">TradingView</a>
      <a href="#imp-tradovate">Tradovate</a>
      <a href="#imp-rithmic">Rithmic R|Trader</a>
      <a href="#imp-sierrachart">Sierra Chart</a>
      <a href="#imp-tradestation">TradeStation</a>
      <a href="#imp-motivewave">MotiveWave</a>
      <a href="#imp-webull">Webull</a>
      <a href="#imp-ibkr">Interactive Brokers</a>
      <a href="#imp-schwab">Schwab / thinkorswim</a>
    </nav>

    <main class="wikimain">
      <!-- ============ BACKGROUND ============ -->
      <section id="intro-futures">
        <h2>What is futures trading?</h2>
        <p>
          A <b>futures contract</b> is a standardized agreement to buy or sell something — a stock index, crude oil, gold, the euro — at a
          set price on a future date. Traders rarely hold to delivery; they buy and sell the contracts themselves to profit from price
          moves, then close out before expiry. Index futures like the <b>E-mini S&amp;P 500 (ES)</b> and its smaller <b>Micro (MES)</b>
          sibling are among the most actively traded.
        </p>
        <p>
          Two things set futures apart from buying shares: <b>leverage</b> — a single contract controls a large notional value for a small
          margin deposit, so gains <i>and</i> losses are amplified — and <b>standardization</b> — every contract's size, tick value, and
          trading hours are fixed by the exchange. That leverage is exactly why tracking your real, after-cost performance matters: small
          per-trade costs compound fast.
        </p>
        <p><b>Getting set up — broker, platform, and data feed.</b> Three separate pieces that are easy to confuse:</p>
        <ol class="steps">
          <li>
            <b>Broker</b> — the firm that holds your account and routes orders to the exchange. It sets your <b>commission</b> per contract.
            Choose on commissions, funding terms, supported markets, and reputation.
          </li>
          <li>
            <b>Platform</b> — the software you actually chart and trade in (TradingView, Tradovate, Sierra Chart, …). Some brokers bundle
            one; many platforms connect to several brokers, sometimes for a monthly <b>platform fee</b>. This is the piece you export your
            CSV from for Blotterbook.
          </li>
          <li>
            <b>Data feed</b> — the real-time market data your platform displays, billed monthly by the exchange (e.g. CME) and/or the
            platform. Non-professional feeds are inexpensive; pick the markets you actually trade.
          </li>
        </ol>
        <p>
          Together these are your true cost of trading — commissions per round-turn plus monthly subscriptions — on top of any taxes owed.
        </p>
        <p>
          <b>Where Blotterbook fits.</b> Blotterbook is the journal that ties it together. Export a CSV from your <b>platform</b>, set your
          <b>broker</b>, <b>data feed</b>, and <b>state</b> once, and it shows your performance <b>after</b> commissions, subscriptions, and
          an estimated Section&nbsp;1256 tax — not just gross P&amp;L — entirely in your browser, with nothing uploaded. Ready to start? The
          setup walkthrough is just below.
        </p>
      </section>

      <!-- ============ GETTING STARTED ============ -->
      <section id="gs-firstrun">
        <h2>First run</h2>
        <p>
          Blotterbook runs entirely in your browser — there's no sign-up and your trade data never leaves the page. Open the app and you'll
          land on the setup screen. The whole flow is four steps:
        </p>
        <ol class="steps">
          <li><b>Pick your broker, data feed, and state</b> — these drive the cost &amp; tax model.</li>
          <li><b>Load CSV</b> — choose the export from your trading platform; Blotterbook detects the format.</li>
          <li><b>Confirm the platform</b> and hit <b>Start Blotterbook</b>.</li>
          <li><b>Explore</b> your dashboard — cards, equity curve, calendar, costs, and stats.</li>
        </ol>
        <div class="note">
          Just want to look around? Open the <a href="/app/demo.html">demo</a> for a generated, profitable sample month — no upload needed.
        </div>
      </section>

      <section id="gs-setup">
        <h2>Broker &amp; costs</h2>
        <p>
          The <b>Broker &amp; Costs</b> panel sets how your true costs are modeled. Your <i>broker</i> sets commission rates; your
          <i>data feed</i> and <i>platform fee</i> are monthly subscriptions; your <i>state</i> drives the tax estimate (it's auto-filled
          from your region, but you can change it). None of this depends on which platform your CSV came from.
        </p>
        <div class="mock">
          <p class="mlabel">Broker &amp; Costs</p>
          <div class="msetup">
            <div class="mfield"><span class="mfl">Broker</span><div class="sel">TradingView PaperTrade <span class="cv">&#9662;</span></div></div>
            <div class="mfield"><span class="mfl">Data feed /mo</span><div class="sel">CME Group — $7 <span class="cv">&#9662;</span></div></div>
            <div class="mfield"><span class="mfl">Platform fee /mo</span><div class="sel">$35</div></div>
            <div class="mfield"><span class="mfl">State (tax)</span><div class="sel">Texas <span class="cv">&#9662;</span></div></div>
          </div>
        </div>
      </section>

      <section id="gs-load">
        <h2>Loading your CSV</h2>
        <p>
          Click <b>Load CSV</b> and choose your platform's export. Blotterbook reads the header row, <b>auto-detects the platform</b>, and
          shows what it found — it does not enter the app until you confirm. If detection is wrong or blank, pick the platform from the
          dropdown to re-parse. Only <code>.csv</code> files are accepted, and nothing imports unless parsing succeeds.
        </p>
        <div class="mock">
          <p class="mlabel">Load &amp; detect</p>
          <div class="msetup">
            <div class="mfield narrow"><span class="mfl">&nbsp;</span><div class="sel">Load CSV</div></div>
            <div class="mfield"><span class="mfl">Platform</span><div class="sel">TradingView <span class="cv">&#9662;</span></div></div>
          </div>
          <p class="mstatus">Detected TradingView · 63 trades ready to import</p>
        </div>
        <p>
          Then press <b>Start Blotterbook</b>. Re-uploads are safe — trades are de-duplicated by a stable id, so importing an overlapping
          export only adds genuinely new rows.
        </p>
      </section>

      <section id="gs-dashboard">
        <h2>Reading the dashboard</h2>
        <p>
          Once loaded, the dashboard summarizes performance <b>after</b> costs and an estimated tax bill — not just gross P&amp;L. The
          headline cards give you the shape at a glance:
        </p>
        <div class="mock">
          <p class="mlabel">Headline stats</p>
          <div class="mcards">
            <div class="mcard"><div class="k">Net P&amp;L</div><div class="v pos">+$3,771</div></div>
            <div class="mcard"><div class="k">Win rate</div><div class="v">60.3%</div></div>
            <div class="mcard"><div class="k">Profit factor</div><div class="v pos">4.03</div></div>
          </div>
        </div>
        <p>
          The <b>Performance</b> graph plots cumulative P&amp;L; toggle the Gross / Net / Take-home overlays to see what costs and tax
          remove:
        </p>
        <div class="mock">
          <p class="mlabel">Performance — cumulative P&amp;L</p>
          <svg viewBox="0 0 560 150" width="100%" height="140" preserveAspectRatio="none" role="img" aria-label="Example rising equity curve">
            <line x1="40" y1="20" x2="540" y2="20" stroke="#262d38" />
            <line x1="40" y1="75" x2="540" y2="75" stroke="#262d38" />
            <line x1="40" y1="130" x2="540" y2="130" stroke="#262d38" />
            <path d="M40,128 L120,108 L200,96 L280,72 L360,60 L440,34 L540,18 L540,130 L40,130 Z" fill="rgba(63,185,80,.18)" />
            <path d="M40,128 L120,108 L200,96 L280,72 L360,60 L440,34 L540,18" fill="none" stroke="#3fb950" stroke-width="2.5" stroke-linejoin="round" />
            <path d="M40,132 L120,116 L200,108 L280,90 L360,82 L440,60 L540,46" fill="none" stroke="#6aa0ff" stroke-width="1.8" opacity=".85" />
          </svg>
        </div>
        <p>The <b>Break-even &amp; Cost Budget</b> panel itemizes exactly where the money goes, from gross to take-home:</p>
        <div class="mock">
          <p class="mlabel">Break-even &amp; cost budget</p>
          <div class="mrow"><span class="ml">Gross P&amp;L</span><span class="mv pos">$3,899.50</span></div>
          <div class="mrow"><span class="ml">Commissions (all-in)</span><span class="mv neg">-$78.30</span></div>
          <div class="mrow"><span class="ml">Subscriptions ($50/mo &times; 1)</span><span class="mv neg">-$50.00</span></div>
          <div class="mrow tot"><span class="ml">Net P&amp;L (pre-tax)</span><span class="mv">$3,771.20</span></div>
          <div class="mrow"><span class="ml">Est. 1256 tax (22.5%)</span><span class="mv neg">-$848.52</span></div>
          <div class="mrow tot"><span class="ml">After-tax take-home</span><span class="mv pos">$2,922.68</span></div>
        </div>
        <p>
          The <b>Trading Calendar</b>, <b>Advanced Statistics</b> (expectancy, streaks, best/worst day, and <i>Avg Hold Time</i> for
          fills-based imports), and <b>Filters</b> round out the view.
        </p>
      </section>

      <section id="gs-manage">
        <h2>Managing &amp; backing up data</h2>
        <p>
          Open <b>Manage data</b> (top bar) to import more CSVs, search and delete individual trades, and — importantly —
          <b>Download backup (.json)</b>. Because everything is stored locally in this browser, a backup is your portable copy: keep one
          before clearing data or switching browsers, and restore it any time. Export a polished <b>performance report</b> from the top bar
          to download or email a condensed summary.
        </p>
      </section>

      <!-- ============ IMPORTING BY PLATFORM ============ -->
      <section id="imp-tradingview">
        <h2>TradingView <span class="pill verified"><span class="d"></span>Tested on real data</span></h2>
        <p>Blotterbook's reference format. Works with the Paper Trading account and connected brokers.</p>
        <ol class="steps">
          <li>Open the <b>Trading Panel</b> at the bottom of the chart and select the <b>Account</b> (e.g. Paper Trading).</li>
          <li>Go to the <b>History</b> / <b>List of Trades</b> tab.</li>
          <li>Use the export / download icon to save a <b>CSV</b>.</li>
        </ol>
        <p>
          Expected columns: <code>Time</code>, <code>Action</code>, <code>Realized PnL (value)</code>. Each row is a closed position, so
          P&amp;L is exact and no hold time is derived.
        </p>
      </section>

      <section id="imp-tradovate">
        <h2>Tradovate <span class="pill beta"><span class="d"></span>Beta · synthetic-tested</span></h2>
        <ol class="steps">
          <li>In the Tradovate web app, open the <b>Orders</b> tab (not Performance).</li>
          <li>Set your date range and filters, then click <b>Download Report</b> to get <code>Orders.csv</code>.</li>
        </ol>
        <p>
          Detected columns: <code>B/S</code>, <code>Contract</code>, <code>Avg Fill Price</code>, <code>Fill Time</code> (a fills export —
          Blotterbook pairs entries→exits and computes hold time). Tradovate doesn't include commissions in this file, so set them via the
          broker selector.
        </p>
      </section>

      <section id="imp-rithmic">
        <h2>Rithmic R|Trader <span class="pill beta"><span class="d"></span>Beta · synthetic-tested</span></h2>
        <ol class="steps">
          <li>In R&nbsp;|&nbsp;Trader, click <b>File → Orders History</b>.</li>
          <li>Choose the account and date (one day at a time), then export to <b>CSV</b>.</li>
          <li>
            Make sure <b>Buy/Sell</b>, <b>Symbol</b>, <b>Qty Filled</b>, <b>Avg Fill Price</b>, and a time column are visible — hidden
            columns aren't exported.
          </li>
        </ol>
        <p>
          Detected columns: <code>Buy/Sell</code>, <code>Symbol</code>, <code>Qty Filled</code>, <code>Avg Fill Price</code>,
          <code>Update Time</code> (fills).
        </p>
      </section>

      <section id="imp-sierrachart">
        <h2>Sierra Chart <span class="pill beta"><span class="d"></span>Beta · synthetic-tested</span></h2>
        <ol class="steps">
          <li>Open <b>Trade → Trade Activity Log</b>.</li>
          <li>Use <b>Save Log As…</b> (not <i>Export</i> — Export writes raw, unadjusted prices) to save a text/CSV file.</li>
          <li>Keep the <b>Symbol</b>, <b>Quantity</b>, <b>BuySell</b>, <b>FillPrice</b>, and date/time columns visible.</li>
        </ol>
        <p>
          The file is usually <b>tab-separated</b>; Blotterbook handles that automatically. Detected columns: <code>BuySell</code>,
          <code>Symbol</code>, <code>FillPrice</code>, <code>Quantity</code>, <code>DateTime</code> (fills).
        </p>
      </section>

      <section id="imp-tradestation">
        <h2>TradeStation <span class="pill beta"><span class="d"></span>Beta · synthetic-tested</span></h2>
        <ol class="steps">
          <li>From the platform's <b>Accounts</b> / trade history (or Client Center), choose a date range.</li>
          <li>Exclude broken/canceled trades and <b>download as CSV</b>.</li>
        </ol>
        <p>
          Detected columns: <code>Symbol</code>, <code>Type</code> (Buy/Sell), <code>Quantity</code>, <code>Price</code>,
          <code>Date/Time</code> (fills). Verify the filled price column is populated.
        </p>
      </section>

      <section id="imp-motivewave">
        <h2>MotiveWave <span class="pill beta"><span class="d"></span>Beta · synthetic-tested</span></h2>
        <ol class="steps">
          <li>Add a <b>Trades</b> panel (Trade Report).</li>
          <li>Click <b>Export to CSV</b> on the right of the panel.</li>
        </ol>
        <p>
          Detected columns: <code>Instrument</code>, <code>Side</code>, <code>Entry/Exit Price</code>, <code>Entry/Exit Time</code>,
          <code>P/L</code>. These are closed round-trips, so hold time comes straight from the export.
        </p>
      </section>

      <section id="imp-webull">
        <h2>Webull <span class="pill beta"><span class="d"></span>Beta · synthetic-tested</span></h2>
        <ol class="steps">
          <li>On Webull <b>desktop</b>, go to <b>Account → Orders → Order History</b>.</li>
          <li>Select a date range (up to 90 days per export) and click <b>Export CSV</b>.</li>
        </ol>
        <p>
          Detected columns: <code>Symbol</code>, <code>Side</code>, <code>Status</code>, <code>Filled</code>, <code>Avg Price</code>,
          <code>Filled Time</code> (equities fills; only filled rows are used).
        </p>
      </section>

      <section id="imp-ibkr">
        <h2>Interactive Brokers <span class="pill beta"><span class="d"></span>Beta · synthetic-tested</span></h2>
        <ol class="steps">
          <li>Create a <b>Flex Query</b> (Trade Confirmation / Trades) — or use an Activity Statement.</li>
          <li>Include <b>DateTime</b>, <b>Symbol</b>, <b>Buy/Sell</b>, <b>Quantity</b>, <b>TradePrice</b>, and (ideally) <b>Realized&nbsp;P/L</b>.</li>
          <li>Run it and download the <b>CSV</b>.</li>
        </ol>
        <p>
          When the export carries <code>Realized&nbsp;P/L</code> per closing row, Blotterbook uses it directly; otherwise P&amp;L is computed
          from price &times; the contract's point value.
        </p>
      </section>

      <section id="imp-schwab">
        <h2>Schwab / thinkorswim <span class="pill beta"><span class="d"></span>Beta · synthetic-tested</span></h2>
        <ol class="steps">
          <li>Open the desktop <b>thinkorswim</b> platform → <b>Monitor → Account Statement</b>.</li>
          <li>Set the date range, then the gear icon → <b>Export to file</b> → <b>CSV</b>.</li>
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
        <a href="mailto:contact@blotterbook.com?subject=Blotterbook">let us know</a>.
      </p>
    </main>
  </div>
</SiteShell>

<style>
  /* status pills (platform tested state) */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    padding: 3px 9px;
    border-radius: 7px;
    border: 1px solid var(--line);
    color: var(--dim);
  }
  .pill .d {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--faint);
  }
  .pill.verified {
    color: var(--green);
    border-color: rgba(63, 185, 80, 0.4);
    background: rgba(63, 185, 80, 0.1);
  }
  .pill.verified .d {
    background: var(--green);
  }
  .pill.beta {
    color: var(--warn);
    border-color: rgba(227, 179, 65, 0.35);
    background: rgba(227, 179, 65, 0.1);
  }
  .pill.beta .d {
    background: var(--warn);
  }

  /* how-to wiki layout */
  .wikilayout {
    display: grid;
    grid-template-columns: 222px 1fr;
    gap: 36px;
    margin-top: 30px;
    align-items: start;
  }
  @media (max-width: 760px) {
    .wikilayout {
      grid-template-columns: 1fr;
      gap: 18px;
    }
  }
  .wikinav {
    position: sticky;
    top: 70px;
    font-size: 13.5px;
  }
  @media (max-width: 760px) {
    .wikinav {
      position: static;
    }
  }
  .wikinav .grp {
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--faint);
    margin: 16px 0 6px;
  }
  .wikinav a {
    display: block;
    color: var(--dim);
    padding: 5px 10px;
    border-radius: 7px;
    border-left: 2px solid transparent;
    text-decoration: none;
  }
  .wikinav a:hover {
    color: var(--txt);
    background: var(--panel);
    text-decoration: none;
  }
  .wikimain section {
    scroll-margin-top: 72px;
  }
  .wikimain section + section {
    margin-top: 18px;
    border-top: 1px solid var(--line);
    padding-top: 24px;
  }
  .wikimain h2 {
    margin-top: 0;
  }
  .steps {
    counter-reset: step;
    list-style: none;
    padding: 0;
    margin: 14px 0;
  }
  .steps > li {
    position: relative;
    padding: 0 0 18px 42px;
    counter-increment: step;
  }
  .steps > li::before {
    content: counter(step);
    position: absolute;
    left: 0;
    top: -2px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: var(--panel2);
    border: 1px solid var(--line);
    color: var(--accent);
    font-family: var(--mono);
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
  }
  .steps > li b {
    color: var(--txt);
  }

  /* non-interactive app-module mockups */
  .mock {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px;
    margin: 16px 0;
  }
  .mock .mlabel {
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--faint);
    margin: 0 0 10px;
  }
  .mcards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  @media (max-width: 560px) {
    .mcards {
      grid-template-columns: 1fr 1fr;
    }
  }
  .mcard {
    background: var(--panel2);
    border: 1px solid var(--line);
    border-radius: 9px;
    padding: 11px 12px;
  }
  .mcard .k {
    font-size: 10px;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--dim);
  }
  .mcard .v {
    font-family: var(--mono);
    font-size: 20px;
    font-weight: 600;
    margin-top: 5px;
  }
  .msetup {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
  }
  .mfield {
    flex: 1;
    min-width: 130px;
  }
  .mfield .mfl {
    display: block;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--faint);
    margin-bottom: 4px;
  }
  .mfield .sel {
    background: var(--panel2);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 8px 10px;
    font-family: var(--mono);
    font-size: 12px;
    color: var(--txt);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .mfield .sel .cv {
    color: var(--faint);
  }
  .mstatus {
    font-family: var(--mono);
    font-size: 12px;
    color: var(--green);
    margin-top: 12px;
  }
  .mrow {
    display: flex;
    justify-content: space-between;
    padding: 7px 0;
    border-bottom: 1px solid var(--line);
    font-size: 13px;
  }
  .mrow:last-child {
    border-bottom: none;
  }
  .mrow .ml {
    color: var(--dim);
  }
  .mrow .mv {
    font-family: var(--mono);
  }
  .mrow.tot .ml,
  .mrow.tot .mv {
    color: var(--txt);
    font-weight: 600;
  }
  /* A55/S18: extracted from a former inline style="" attribute (howto mock field). */
  .mfield.narrow {
    max-width: 150px;
  }
</style>
