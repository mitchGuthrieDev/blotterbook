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

  <div class="grid grid-cols-[222px_1fr] gap-9 mt-[30px] items-start max-[760px]:grid-cols-1 max-[760px]:gap-[18px]">
    <nav class="sticky top-[70px] text-[13.5px] max-[760px]:static" aria-label="How-to contents">
      <div class="font-mono text-[10.5px] tracking-[0.1em] uppercase text-muted-foreground mt-4 mb-1.5">Background</div>
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#intro-futures">What is futures trading?</a
      >
      <div class="font-mono text-[10.5px] tracking-[0.1em] uppercase text-muted-foreground mt-4 mb-1.5">Getting started</div>
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#gs-firstrun">First run</a
      >
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#gs-setup">Broker &amp; costs</a
      >
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#gs-load">Loading your CSV</a
      >
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#gs-dashboard">Reading the dashboard</a
      >
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#gs-manage">Managing &amp; backing up data</a
      >
      <div class="font-mono text-[10.5px] tracking-[0.1em] uppercase text-muted-foreground mt-4 mb-1.5">Importing by platform</div>
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#imp-tradingview">TradingView</a
      >
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#imp-tradovate">Tradovate</a
      >
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#imp-quantower">Quantower</a
      >
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#imp-rithmic">Rithmic R|Trader</a
      >
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#imp-sierrachart">Sierra Chart</a
      >
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#imp-tradestation">TradeStation</a
      >
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#imp-motivewave">MotiveWave</a
      >
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#imp-webull">Webull</a
      >
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#imp-ibkr">Interactive Brokers</a
      >
      <a
        class="block text-muted-foreground py-[5px] px-2.5 rounded-[7px] border-l-2 border-transparent no-underline hover:text-foreground hover:bg-card hover:no-underline"
        href="#imp-schwab">Schwab / thinkorswim</a
      >
    </nav>

    <main>
      <!-- ============ BACKGROUND ============ -->
      <section id="intro-futures" class="scroll-mt-[72px]">
        <h2 class="mt-0">What is futures trading?</h2>
        <p>
          A <b>futures contract</b> is a standardized agreement to buy or sell something — a stock index, crude oil, gold, the euro — at a
          set price on a future date. Traders rarely hold to delivery; they buy and sell the contracts themselves to profit from price
          moves, then close out before expiry. Index futures like the <b>E-mini S&amp;P 500 (ES)</b> and its smaller <b>Micro (MES)</b>
          sibling are among the most actively traded.
        </p>
        <p>
          Two things set futures apart from buying shares: <b>leverage</b> — a single contract controls a large notional value for a small
          margin deposit, so gains <i>and</i> losses are amplified — and <b>standardization</b> — every contract's size, tick value, and trading
          hours are fixed by the exchange. That leverage is exactly why tracking your real, after-cost performance matters: small per-trade costs
          compound fast.
        </p>
        <p><b>Getting set up — broker, platform, and data feed.</b> Three separate pieces that are easy to confuse:</p>
        <ol class="steps">
          <li>
            <b>Broker</b> — the firm that holds your account and routes orders to the exchange. It sets your <b>commission</b> per contract. Choose
            on commissions, funding terms, supported markets, and reputation.
          </li>
          <li>
            <b>Platform</b> — the software you actually chart and trade in (TradingView, Tradovate, Sierra Chart, …). Some brokers bundle
            one; many platforms connect to several brokers, sometimes for a monthly <b>platform fee</b>. This is the piece you export your
            CSV from for Blotterbook.
          </li>
          <li>
            <b>Data feed</b> — the real-time market data your platform displays, billed monthly by the exchange (e.g. CME) and/or the platform.
            Non-professional feeds are inexpensive; pick the markets you actually trade.
          </li>
        </ol>
        <p>
          Together these are your true cost of trading — commissions per round-turn plus monthly subscriptions — on top of any taxes owed.
        </p>
        <p>
          <b>Where Blotterbook fits.</b> Blotterbook is the journal that ties it together. Export a CSV from your <b>platform</b>, set your
          <b>broker</b>, <b>data feed</b>, and <b>state</b> once, and it shows your performance <b>after</b> commissions, subscriptions, and an
          estimated Section&nbsp;1256 tax — not just gross P&amp;L — entirely in your browser, with nothing uploaded. Ready to start? The setup
          walkthrough is just below.
        </p>
      </section>

      <!-- ============ GETTING STARTED ============ -->
      <section id="gs-firstrun" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
        <h2 class="mt-0">First run</h2>
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

      <section id="gs-setup" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
        <h2 class="mt-0">Broker &amp; costs</h2>
        <p>
          The <b>Broker &amp; Costs</b> panel sets how your true costs are modeled. Your <i>broker</i> sets commission rates; your
          <i>data feed</i> and <i>platform fee</i> are monthly subscriptions; your <i>state</i> drives the tax estimate (it's auto-filled from
          your region, but you can change it). None of this depends on which platform your CSV came from.
        </p>
        <div class="bg-card border border-border rounded-xl p-3.5 my-4">
          <p class="font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground m-0 mb-2.5">Broker &amp; Costs</p>
          <div class="flex gap-2.5 flex-wrap">
            <div class="flex-1 min-w-[130px]">
              <span class="block text-[10px] tracking-[0.06em] uppercase text-muted-foreground mb-1">Broker</span>
              <div
                class="bg-secondary border border-border rounded-md px-2.5 py-2 font-mono text-[12px] text-foreground flex justify-between items-center"
              >
                TradingView PaperTrade <span class="text-muted-foreground">&#9662;</span>
              </div>
            </div>
            <div class="flex-1 min-w-[130px]">
              <span class="block text-[10px] tracking-[0.06em] uppercase text-muted-foreground mb-1">Data feed /mo</span>
              <div
                class="bg-secondary border border-border rounded-md px-2.5 py-2 font-mono text-[12px] text-foreground flex justify-between items-center"
              >
                CME Group — $7 <span class="text-muted-foreground">&#9662;</span>
              </div>
            </div>
            <div class="flex-1 min-w-[130px]">
              <span class="block text-[10px] tracking-[0.06em] uppercase text-muted-foreground mb-1">Platform fee /mo</span>
              <div
                class="bg-secondary border border-border rounded-md px-2.5 py-2 font-mono text-[12px] text-foreground flex justify-between items-center"
              >
                $35
              </div>
            </div>
            <div class="flex-1 min-w-[130px]">
              <span class="block text-[10px] tracking-[0.06em] uppercase text-muted-foreground mb-1">State (tax)</span>
              <div
                class="bg-secondary border border-border rounded-md px-2.5 py-2 font-mono text-[12px] text-foreground flex justify-between items-center"
              >
                Texas <span class="text-muted-foreground">&#9662;</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="gs-load" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
        <h2 class="mt-0">Loading your CSV</h2>
        <p>
          Click <b>Load CSV</b> and choose your platform's export. Blotterbook reads the header row, <b>auto-detects the platform</b>, and
          shows what it found — it does not enter the app until you confirm. If detection is wrong or blank, pick the platform from the
          dropdown to re-parse. Only <code>.csv</code> files are accepted, and nothing imports unless parsing succeeds.
        </p>
        <div class="bg-card border border-border rounded-xl p-3.5 my-4">
          <p class="font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground m-0 mb-2.5">Load &amp; detect</p>
          <div class="flex gap-2.5 flex-wrap">
            <div class="flex-1 min-w-[130px] max-w-[150px]">
              <span class="block text-[10px] tracking-[0.06em] uppercase text-muted-foreground mb-1">&nbsp;</span>
              <div
                class="bg-secondary border border-border rounded-md px-2.5 py-2 font-mono text-[12px] text-foreground flex justify-between items-center"
              >
                Load CSV
              </div>
            </div>
            <div class="flex-1 min-w-[130px]">
              <span class="block text-[10px] tracking-[0.06em] uppercase text-muted-foreground mb-1">Platform</span>
              <div
                class="bg-secondary border border-border rounded-md px-2.5 py-2 font-mono text-[12px] text-foreground flex justify-between items-center"
              >
                TradingView <span class="text-muted-foreground">&#9662;</span>
              </div>
            </div>
          </div>
          <p class="font-mono text-[12px] text-chart-2 mt-3">Detected TradingView · 63 trades ready to import</p>
        </div>
        <p>
          Then press <b>Start Blotterbook</b>. Re-uploads are safe — trades are de-duplicated by a stable id, so importing an overlapping
          export only adds genuinely new rows, and a richer duplicate <b>fills in</b> fields the stored trade lacks (hold time, quantity, commission)
          without touching what's already there.
        </p>
        <p>
          <b>Not every export carries the same data.</b> The import preview states what a file provides before you confirm; this is the full picture
          per format:
        </p>
        <div class="overflow-x-auto my-4">
          <table class="w-full border border-border rounded-md text-[12.5px]">
            <thead>
              <tr class="bg-card text-left">
                <th class="px-3 py-2 font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground">Export</th>
                <th class="px-3 py-2 font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground">P&amp;L</th>
                <th class="px-3 py-2 font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground">Qty</th>
                <th class="px-3 py-2 font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground">Hold time</th>
                <th class="px-3 py-2 font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground">Commissions</th>
              </tr>
            </thead>
            <tbody>
              <tr class="border-t border-border">
                <td class="px-3 py-1.5">TradingView — balance history</td>
                <td class="px-3 py-1.5 text-chart-2">exact</td>
                <td class="px-3 py-1.5 text-muted-foreground">—</td>
                <td class="px-3 py-1.5 text-muted-foreground">—</td>
                <td class="px-3 py-1.5 text-muted-foreground">—</td>
              </tr>
              <tr class="border-t border-border">
                <td class="px-3 py-1.5">TradingView — order history</td>
                <td class="px-3 py-1.5">derived</td>
                <td class="px-3 py-1.5 text-chart-2">yes</td>
                <td class="px-3 py-1.5 text-chart-2">yes</td>
                <td class="px-3 py-1.5">when your broker reports them</td>
              </tr>
              <tr class="border-t border-border">
                <td class="px-3 py-1.5">MotiveWave — trade report</td>
                <td class="px-3 py-1.5 text-chart-2">exact</td>
                <td class="px-3 py-1.5 text-chart-2">yes</td>
                <td class="px-3 py-1.5 text-chart-2">yes</td>
                <td class="px-3 py-1.5 text-muted-foreground">—</td>
              </tr>
              <tr class="border-t border-border">
                <td class="px-3 py-1.5">Fills exports (Tradovate, Rithmic, Sierra Chart, TradeStation, Webull, Schwab)</td>
                <td class="px-3 py-1.5">derived</td>
                <td class="px-3 py-1.5 text-chart-2">yes</td>
                <td class="px-3 py-1.5 text-chart-2">yes</td>
                <td class="px-3 py-1.5 text-muted-foreground">—</td>
              </tr>
              <tr class="border-t border-border">
                <td class="px-3 py-1.5">Interactive Brokers — trades/Flex</td>
                <td class="px-3 py-1.5 text-chart-2">broker-reported</td>
                <td class="px-3 py-1.5 text-chart-2">yes</td>
                <td class="px-3 py-1.5 text-chart-2">yes</td>
                <td class="px-3 py-1.5 text-chart-2">yes (IBCommission)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          “Derived” P&amp;L is computed from fill prices × contract size; “—” means the field simply isn't in that export — the cost model
          estimates commissions from your broker setting, and hold-time stats note their coverage. You can import <b
            >multiple export types and multiple platforms</b
          > side by side (people switch platforms over time) — everything normalizes to one trade shape and de-duplicates.
        </p>
      </section>

      <section id="gs-dashboard" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
        <h2 class="mt-0">Reading the dashboard</h2>
        <p>
          Once loaded, the dashboard summarizes performance <b>after</b> costs and an estimated tax bill — not just gross P&amp;L. The headline
          cards give you the shape at a glance:
        </p>
        <div class="bg-card border border-border rounded-xl p-3.5 my-4">
          <p class="font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground m-0 mb-2.5">Headline stats</p>
          <div class="grid grid-cols-3 gap-2.5 max-[560px]:grid-cols-2">
            <div class="bg-secondary border border-border rounded-[9px] px-3 py-[11px]">
              <div class="text-[10px] tracking-[0.07em] uppercase text-muted-foreground">Net P&amp;L</div>
              <div class="font-mono text-[20px] font-semibold mt-[5px] pos">+$3,771</div>
            </div>
            <div class="bg-secondary border border-border rounded-[9px] px-3 py-[11px]">
              <div class="text-[10px] tracking-[0.07em] uppercase text-muted-foreground">Win rate</div>
              <div class="font-mono text-[20px] font-semibold mt-[5px]">60.3%</div>
            </div>
            <div class="bg-secondary border border-border rounded-[9px] px-3 py-[11px]">
              <div class="text-[10px] tracking-[0.07em] uppercase text-muted-foreground">Profit factor</div>
              <div class="font-mono text-[20px] font-semibold mt-[5px] pos">4.03</div>
            </div>
          </div>
        </div>
        <p>
          The <b>Performance</b> graph plots cumulative P&amp;L; toggle the Gross / Net / Take-home overlays to see what costs and tax remove:
        </p>
        <div class="bg-card border border-border rounded-xl p-3.5 my-4">
          <p class="font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground m-0 mb-2.5">
            Performance — cumulative P&amp;L
          </p>
          <svg
            viewBox="0 0 560 150"
            width="100%"
            height="140"
            preserveAspectRatio="none"
            role="img"
            aria-label="Example rising equity curve"
          >
            <line x1="40" y1="20" x2="540" y2="20" class="gl" />
            <line x1="40" y1="75" x2="540" y2="75" class="gl" />
            <line x1="40" y1="130" x2="540" y2="130" class="gl" />
            <path d="M40,128 L120,108 L200,96 L280,72 L360,60 L440,34 L540,18 L540,130 L40,130 Z" class="area" />
            <path
              d="M40,128 L120,108 L200,96 L280,72 L360,60 L440,34 L540,18"
              fill="none"
              class="gross"
              stroke-width="2.5"
              stroke-linejoin="round"
            />
            <path d="M40,132 L120,116 L200,108 L280,90 L360,82 L440,60 L540,46" fill="none" class="net" stroke-width="1.8" opacity=".85" />
          </svg>
        </div>
        <p>The <b>Break-even &amp; Cost Budget</b> panel itemizes exactly where the money goes, from gross to take-home:</p>
        <div class="bg-card border border-border rounded-xl p-3.5 my-4">
          <p class="font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground m-0 mb-2.5">Break-even &amp; cost budget</p>
          <div class="flex justify-between py-[7px] border-b border-border text-[13px]">
            <span class="text-muted-foreground">Gross P&amp;L</span><span class="font-mono pos">$3,899.50</span>
          </div>
          <div class="flex justify-between py-[7px] border-b border-border text-[13px]">
            <span class="text-muted-foreground">Commissions (all-in)</span><span class="font-mono neg">-$78.30</span>
          </div>
          <div class="flex justify-between py-[7px] border-b border-border text-[13px]">
            <span class="text-muted-foreground">Subscriptions ($50/mo &times; 1)</span><span class="font-mono neg">-$50.00</span>
          </div>
          <div class="flex justify-between py-[7px] border-b border-border text-[13px]">
            <span class="text-foreground font-semibold">Net P&amp;L (pre-tax)</span><span class="font-mono text-foreground font-semibold"
              >$3,771.20</span
            >
          </div>
          <div class="flex justify-between py-[7px] border-b border-border text-[13px]">
            <span class="text-muted-foreground">Est. 1256 tax (22.5%)</span><span class="font-mono neg">-$848.52</span>
          </div>
          <div class="flex justify-between py-[7px] text-[13px]">
            <span class="text-foreground font-semibold">After-tax take-home</span><span class="font-mono text-foreground font-semibold pos"
              >$2,922.68</span
            >
          </div>
        </div>
        <p>
          The <b>Trading Calendar</b>, <b>Advanced Statistics</b> (expectancy, streaks, best/worst day, and <i>Avg Hold Time</i> for
          fills-based imports), and <b>Filters</b> round out the view.
        </p>
      </section>

      <section id="gs-manage" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
        <h2 class="mt-0">Managing &amp; backing up data</h2>
        <p>
          Open <b>Manage data</b> (top bar) to import more CSVs, search and delete individual trades, and — importantly —
          <b>Download backup (.json)</b>. Because everything is stored locally in this browser, a backup is your portable copy: keep one
          before clearing data or switching browsers, and restore it any time. Export a polished <b>performance report</b> from the top bar to
          download or email a condensed summary.
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
          <li>Open the <b>Trading Panel</b> at the bottom of the chart and select the <b>Account</b> (e.g. Paper Trading).</li>
          <li>Go to the <b>History</b> / <b>List of Trades</b> tab.</li>
          <li>Use the export / download icon to save a <b>CSV</b>.</li>
        </ol>
        <p>
          <b>Balance history</b> (recommended) — columns <code>Time</code>, <code>Action</code>, <code>Realized PnL (value)</code>. Each row
          is a closed position, so P&amp;L is exact and no hold time is derived.
        </p>
        <p>
          <b>Order history</b> — columns <code>Symbol</code>, <code>Side</code>, <code>Fill price</code>, <code>Status</code>,
          <code>Closing time</code>. A fills export: Blotterbook pairs entries→exits, which unlocks <b>hold time</b>, and reads the
          <code>Commission</code> column when your broker fills it in. One caveat: this export only reaches back a limited number of orders —
          if it starts mid-position, the earliest round trips can misprice (you'll see an open-lots notice on import). Import both and Blotterbook
          reconciles them automatically: identical trades de-duplicate and enrich each other, and where the two disagree the balance history's
          exact P&amp;L wins over the derived figure — in either import order. The other exports on that panel (positions, orders, trading journal)
          aren't trade data — Blotterbook will decline them.
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
          Blotterbook reads three of the export types; import any or all of them (overlapping trades merge, never double-count):
        </p>
        <ol class="steps">
          <li>
            <b>Performance</b> — the platform's own round-trip pairing (P&amp;L, quantities, entry/exit times, hold time). The best single file
            to import.
          </li>
          <li>
            <b>Fills</b> — per-fill executions <b>with your real commissions</b>, which override Blotterbook's modeled rates per trade.
          </li>
          <li>
            <b>Orders</b> — also supported (<code>Orders.csv</code> via <b>Download Report</b>); no commission column, so modeled rates
            apply.
          </li>
        </ol>
        <p>
          The other exports on that panel (Cash History, Account Balance History, Position History) aren't per-trade data — Blotterbook will
          decline them.
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
          <li>In Quantower, open the <b>Trades</b> panel (not Orders history — that's order lifecycle, not trade data).</li>
          <li>Set your account and date range, then export the table to CSV — you'll get <code>Trades.csv</code>.</li>
        </ol>
        <p>
          Detected columns: <code>Side</code>, <code>Symbol</code>, <code>Price</code>, <code>Gross P/L</code>, <code>Fee</code>,
          <code>Date/Time</code>. Each fill carries its own realized P&amp;L — Blotterbook uses those exact figures when pairing your round
          trips — and the <code>Fee</code> column supplies your real per-fill costs, which override the modeled commission rates.
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

      <section id="imp-sierrachart" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
        <h2 class="mt-0">
          Sierra Chart
          <span
            class="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] px-[9px] py-[3px] rounded-[7px] border border-chart-4/35 bg-chart-4/10 text-chart-4"
            ><span class="w-[7px] h-[7px] rounded-full bg-chart-4"></span>Beta · synthetic-tested</span
          >
        </h2>
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

      <section id="imp-tradestation" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
        <h2 class="mt-0">
          TradeStation
          <span
            class="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em] px-[9px] py-[3px] rounded-[7px] border border-chart-4/35 bg-chart-4/10 text-chart-4"
            ><span class="w-[7px] h-[7px] rounded-full bg-chart-4"></span>Beta · synthetic-tested</span
          >
        </h2>
        <ol class="steps">
          <li>From the platform's <b>Accounts</b> / trade history (or Client Center), choose a date range.</li>
          <li>Exclude broken/canceled trades and <b>download as CSV</b>.</li>
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
          <li>Add a <b>Trades</b> panel (Trade Report).</li>
          <li>Click <b>Export to CSV</b> on the right of the panel.</li>
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
          <li>Select a date range (up to 90 days per export) and click <b>Export CSV</b>.</li>
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
          <li>Create a <b>Flex Query</b> (Trade Confirmation / Trades) — or use an Activity Statement.</li>
          <li>
            Include <b>DateTime</b>, <b>Symbol</b>, <b>Buy/Sell</b>, <b>Quantity</b>, <b>TradePrice</b>, and (ideally)
            <b>Realized&nbsp;P/L</b>.
          </li>
          <li>Run it and download the <b>CSV</b>.</li>
        </ol>
        <p>
          When the export carries <code>Realized&nbsp;P/L</code> per closing row, Blotterbook uses it directly; otherwise P&amp;L is computed
          from price &times; the contract's point value.
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
  /* Step lists use CSS counters + a ::before badge (genuinely bespoke — kept scoped). */
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
    background: var(--secondary);
    border: 1px solid var(--border);
    color: var(--primary);
    font-family: var(--font-mono);
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
  }
  .steps > li b {
    color: var(--foreground);
  }
  /* Illustrative equity-curve SVG — colors driven from the token source (var/color-mix) rather than
     hardcoded hex, since SVG presentation attributes can't take var() (A113). */
  .gl {
    stroke: var(--border);
  }
  .area {
    fill: color-mix(in srgb, var(--chart-2) 18%, transparent);
  }
  .gross {
    stroke: var(--chart-2);
  }
  .net {
    stroke: var(--primary);
  }
</style>
