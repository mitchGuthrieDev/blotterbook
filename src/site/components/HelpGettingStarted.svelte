<script lang="ts">
  // Help > Getting started (A273 — migrated verbatim from the old Howto.svelte "Getting started"
  // sections; anchor ids unchanged so old #gs-* deep links keep working). Shared chrome from
  // HelpShell (SiteShell + the HelpNav sidebar); the numbered `.steps` styling is global, defined in
  // HelpShell itself.
  import HelpShell from '../lib/HelpShell.svelte';
</script>

<HelpShell active="getting-started">
  <p class="eyebrow">Blotterbook Help</p>
  <h1>Getting started</h1>
  <p class="blurb">
    A walkthrough of first run, broker &amp; cost setup, loading your CSV, reading the dashboard, and backing up your data. Ready to export
    a CSV from a specific platform? See <a href="/help/import.html">Importing your trades</a>.
  </p>

  <section id="gs-firstrun" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">First run</h2>
    <p>
      Blotterbook runs entirely in your browser — your trade data never leaves the page. Launching the app takes a free account (a passkey,
      no password); the <a href="/app/demo.html">demo</a> needs no sign-up. Open the app and you'll land on the setup screen. The whole flow is
      four steps:
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
      <i>data feed</i> and <i>platform fee</i> are monthly subscriptions; your <i>state</i> drives the tax estimate (it's auto-filled from your
      region, but you can change it). None of this depends on which platform your CSV came from.
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
      Click <b>Load CSV</b> and choose your platform's export. Blotterbook reads the header row, <b>auto-detects the platform</b>, and shows
      what it found — it does not enter the app until you confirm. If detection is wrong or blank, pick the platform from the dropdown to
      re-parse. Only <code>.csv</code> files are accepted, and nothing imports unless parsing succeeds.
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
      Then press <b>Start Blotterbook</b>. Re-uploads are safe — trades are de-duplicated by a stable id, so importing an overlapping export
      only adds genuinely new rows, and a richer duplicate <b>fills in</b> fields the stored trade lacks (hold time, quantity, commission) without
      touching what's already there.
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
            <td class="px-3 py-1.5">Tradovate / NinjaTrader — Performance</td>
            <td class="px-3 py-1.5 text-chart-2">exact (platform-paired)</td>
            <td class="px-3 py-1.5 text-chart-2">yes</td>
            <td class="px-3 py-1.5 text-chart-2">yes</td>
            <td class="px-3 py-1.5 text-muted-foreground">—</td>
          </tr>
          <tr class="border-t border-border">
            <td class="px-3 py-1.5">Tradovate / NinjaTrader — Fills</td>
            <td class="px-3 py-1.5">derived</td>
            <td class="px-3 py-1.5 text-chart-2">yes</td>
            <td class="px-3 py-1.5 text-chart-2">yes</td>
            <td class="px-3 py-1.5 text-chart-2">yes (real, per-fill)</td>
          </tr>
          <tr class="border-t border-border">
            <td class="px-3 py-1.5">Tradovate / NinjaTrader — Orders</td>
            <td class="px-3 py-1.5">derived</td>
            <td class="px-3 py-1.5 text-chart-2">yes</td>
            <td class="px-3 py-1.5 text-chart-2">yes</td>
            <td class="px-3 py-1.5 text-muted-foreground">—</td>
          </tr>
          <tr class="border-t border-border">
            <td class="px-3 py-1.5">Quantower — Trades</td>
            <td class="px-3 py-1.5 text-chart-2">exact (per-fill)</td>
            <td class="px-3 py-1.5 text-chart-2">yes</td>
            <td class="px-3 py-1.5 text-chart-2">yes</td>
            <td class="px-3 py-1.5 text-chart-2">yes (Fee)</td>
          </tr>
          <tr class="border-t border-border">
            <td class="px-3 py-1.5">ATAS X — statistics workbook (Journal sheet)</td>
            <td class="px-3 py-1.5 text-chart-2">exact</td>
            <td class="px-3 py-1.5 text-chart-2">yes</td>
            <td class="px-3 py-1.5 text-chart-2">yes</td>
            <td class="px-3 py-1.5 text-muted-foreground">—</td>
          </tr>
          <tr class="border-t border-border">
            <td class="px-3 py-1.5">MotiveWave — trade report</td>
            <td class="px-3 py-1.5 text-chart-2">exact</td>
            <td class="px-3 py-1.5 text-chart-2">yes</td>
            <td class="px-3 py-1.5 text-chart-2">yes</td>
            <td class="px-3 py-1.5 text-muted-foreground">—</td>
          </tr>
          <tr class="border-t border-border">
            <td class="px-3 py-1.5">Other fills exports (Rithmic, Sierra Chart, TradeStation, Webull, Schwab)</td>
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
      "Derived" P&amp;L is computed from fill prices × contract size; "—" means the field simply isn't in that export — the cost model
      estimates commissions from your broker setting, and hold-time stats note their coverage. You can import <b
        >multiple export types and multiple platforms</b
      > side by side (people switch platforms over time) — everything normalizes to one trade shape and de-duplicates.
    </p>
  </section>

  <section id="gs-dashboard" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">Reading the dashboard</h2>
    <p>
      Once loaded, the dashboard summarizes performance <b>after</b> costs and an estimated tax bill — not just gross P&amp;L. The headline cards
      give you the shape at a glance:
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
      <p class="font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground m-0 mb-2.5">Performance — cumulative P&amp;L</p>
      <svg viewBox="0 0 560 150" width="100%" height="140" preserveAspectRatio="none" role="img" aria-label="Example rising equity curve">
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
      The <b>Trading Calendar</b>, <b>Advanced Statistics</b> (expectancy, streaks, best/worst day, and <i>Avg Hold Time</i> for fills-based
      imports), and <b>Filters</b> round out the view.
    </p>
  </section>

  <section id="gs-manage" class="scroll-mt-[72px] mt-[18px] border-t border-border pt-6">
    <h2 class="mt-0">Managing &amp; backing up data</h2>
    <p>
      Open <b>Manage data</b> (top bar) to import more CSVs, search and delete individual trades, and — importantly —
      <b>Download backup (.json)</b>. Because everything is stored locally in this browser, a backup is your portable copy: keep one before
      clearing data or switching browsers, and restore it any time. Export a polished <b>performance report</b> from the top bar to download or
      email a condensed summary.
    </p>
  </section>
</HelpShell>

<style>
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
