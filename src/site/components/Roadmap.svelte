<script lang="ts">
  // Roadmap (A69 — ex roadmap.html static markup). Shared chrome + typography come from SiteShell;
  // the checklist + tag-chip styling is page-specific (Tailwind utilities inline, A128).
  import SiteShell from '../lib/SiteShell.svelte';
</script>

<SiteShell active="roadmap">
  <p class="eyebrow">The Plan</p>
  <h1>Roadmap</h1>
  <p class="blurb">
    Where <b>Blotterbook</b> is headed — the big picture, not a task list. You already get a full futures journal with a true-cost &amp; tax
    dashboard; next come numbers you can trust to the cent, deeper journaling, and sync across your devices — all built privacy-first. For
    the per-release detail, see the <a href="changelog.html">Changelog</a>.
  </p>

  <h2>Available now</h2>
  <ul class="mt-[18px] list-none p-0">
    <li class="flex items-start gap-3 border-b border-border py-[11px]">
      <span
        class="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border border-chart-2/45 bg-chart-2/15 text-[12px] text-chart-2"
        >&#10003;</span
      >
      <div class="flex-1">
        <b class="text-foreground">Import from your platform in seconds</b>
        <p class="mt-[3px] mb-0 text-[13.5px] leading-[1.5] text-muted-foreground">
          Drop in a CSV from TradingView, Tradovate, Rithmic, Sierra&nbsp;Chart, TradeStation, MotiveWave, Webull, IBKR or
          Schwab/thinkorswim — the format is auto-detected, and re-uploads merge so only new trades are added.
        </p>
      </div>
    </li>
    <li class="flex items-start gap-3 border-b border-border py-[11px]">
      <span
        class="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border border-chart-2/45 bg-chart-2/15 text-[12px] text-chart-2"
        >&#10003;</span
      >
      <div class="flex-1">
        <b class="text-foreground">Your <i>true</i> P&amp;L, not just gross</b>
        <p class="mt-[3px] mb-0 text-[13.5px] leading-[1.5] text-muted-foreground">
          Every trade is costed with broker commissions, exchange &amp; NFA fees, your data-feed and platform subscriptions, and a
          Section&nbsp;1256 tax estimate — so you see net and real take-home, plus the break-even you need per trade.
        </p>
      </div>
    </li>
    <li class="flex items-start gap-3 border-b border-border py-[11px]">
      <span
        class="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border border-chart-2/45 bg-chart-2/15 text-[12px] text-chart-2"
        >&#10003;</span
      >
      <div class="flex-1">
        <b class="text-foreground">A dashboard that fills the screen</b>
        <p class="mt-[3px] mb-0 text-[13.5px] leading-[1.5] text-muted-foreground">
          An equity curve with gross / net / take-home overlays, a P&amp;L calendar, win rate, profit factor, drawdown and more —
          edge-to-edge on a wide monitor, single column on your phone.
        </p>
      </div>
    </li>
    <li class="flex items-start gap-3 border-b border-border py-[11px]">
      <span
        class="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border border-chart-2/45 bg-chart-2/15 text-[12px] text-chart-2"
        >&#10003;</span
      >
      <div class="flex-1">
        <b class="text-foreground">Arrange it your way</b>
        <p class="mt-[3px] mb-0 text-[13.5px] leading-[1.5] text-muted-foreground">
          Drag to reorder the modules, collapse what you don't need, and save named workspace layouts to switch between views.
        </p>
      </div>
    </li>
    <li class="flex items-start gap-3 border-b border-border py-[11px]">
      <span
        class="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border border-chart-2/45 bg-chart-2/15 text-[12px] text-chart-2"
        >&#10003;</span
      >
      <div class="flex-1">
        <b class="text-foreground">Filter, focus, and journal</b>
        <p class="mt-[3px] mb-0 text-[13.5px] leading-[1.5] text-muted-foreground">
          Slice by date range, symbol, side, session or weekday and save the filter views you reuse; keep day-by-day notes plus per-trade
          tags, notes, and screenshots.
        </p>
      </div>
    </li>
    <li class="flex items-start gap-3 border-b border-border py-[11px]">
      <span
        class="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border border-chart-2/45 bg-chart-2/15 text-[12px] text-chart-2"
        >&#10003;</span
      >
      <div class="flex-1">
        <b class="text-foreground">Reports worth sharing</b>
        <p class="mt-[3px] mb-0 text-[13.5px] leading-[1.5] text-muted-foreground">
          A clean, condensed performance report you can preview and download as PDF, image, or Markdown — or email to yourself.
        </p>
      </div>
    </li>
    <li class="flex items-start gap-3 border-b border-border py-[11px]">
      <span
        class="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border border-chart-2/45 bg-chart-2/15 text-[12px] text-chart-2"
        >&#10003;</span
      >
      <div class="flex-1">
        <b class="text-foreground">Private by default</b>
        <p class="mt-[3px] mb-0 text-[13.5px] leading-[1.5] text-muted-foreground">
          Everything runs and stays in your browser — no account, nothing uploaded. Back up or restore your entire journal as a single file
          anytime, and try it first on the live sample-data demo.
        </p>
      </div>
    </li>
  </ul>

  <h2>In progress</h2>
  <ul class="mt-[18px] list-none p-0">
    <li class="flex items-start gap-3 border-b border-border py-[11px]">
      <span
        class="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border border-primary/50 bg-primary/14 text-[12px] text-primary"
        >&#9679;</span
      >
      <div class="flex-1">
        <b class="text-foreground"
          >Numbers you can trust to the cent<span
            class="ml-2 rounded-full border border-chart-4/35 bg-chart-4/12 px-2 py-0.5 align-middle font-mono text-[10px] tracking-[0.08em] uppercase text-chart-4"
            >High priority</span
          ></b
        >
        <p class="mt-[3px] mb-0 text-[13.5px] leading-[1.5] text-muted-foreground">
          Today's fees and tax rates are careful estimates. We're wiring them to official sources — CME/exchange fee schedules, per-broker
          data-feed price lists, and per-state tax tables, refreshed on a schedule — so your cost and take-home figures are exact, not
          approximate.
        </p>
      </div>
    </li>
    <li class="flex items-start gap-3 border-b border-border py-[11px]">
      <span
        class="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border border-primary/50 bg-primary/14 text-[12px] text-primary"
        >&#9679;</span
      >
      <div class="flex-1">
        <b class="text-foreground">Broader, verified platform coverage</b>
        <p class="mt-[3px] mb-0 text-[13.5px] leading-[1.5] text-muted-foreground">
          Confirming each importer against real exports, widening the contract/point-value coverage, and adding a manual column-mapping
          fallback for any format we don't yet recognize.
        </p>
      </div>
    </li>
    <li class="flex items-start gap-3 border-b border-border py-[11px]">
      <span
        class="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border border-primary/50 bg-primary/14 text-[12px] text-primary"
        >&#9679;</span
      >
      <div class="flex-1">
        <b class="text-foreground">Deeper journaling</b>
        <p class="mt-[3px] mb-0 text-[13.5px] leading-[1.5] text-muted-foreground">
          The analytics serious traders expect: R-multiple and risk tracking, MAE/MFE (how far each trade ran for and against you), and
          setup tagging — toward full journal parity.
        </p>
      </div>
    </li>
  </ul>

  <h2>Planned</h2>
  <ul class="mt-[18px] list-none p-0">
    <li class="flex items-start gap-3 border-b border-border py-[11px]">
      <span
        class="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border border-border text-[12px] text-muted-foreground"
        >&#9633;</span
      >
      <div class="flex-1">
        <b class="text-foreground"
          >Sync across your devices<span
            class="ml-2 rounded-full border border-chart-3/30 bg-chart-3/12 px-2 py-0.5 align-middle font-mono text-[10px] tracking-[0.08em] uppercase text-chart-3"
            >$5/mo</span
          ></b
        >
        <p class="mt-[3px] mb-0 text-[13.5px] leading-[1.5] text-muted-foreground">
          End-to-end-encrypted sync of your trades, notes, tags, and saved filters, so your journal follows you to any device — and we never
          see your data. The one optional paid add-on; everything else stays free.
        </p>
      </div>
    </li>
    <li class="flex items-start gap-3 border-b border-border py-[11px]">
      <span
        class="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border border-border text-[12px] text-muted-foreground"
        >&#9633;</span
      >
      <div class="flex-1">
        <b class="text-foreground">Connect your broker directly</b>
        <p class="mt-[3px] mb-0 text-[13.5px] leading-[1.5] text-muted-foreground">
          Optionally pull fills, commissions, and live rates straight from your platform — and skip the CSV step entirely.
        </p>
      </div>
    </li>
    <li class="flex items-start gap-3 border-b border-border py-[11px]">
      <span
        class="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border border-border text-[12px] text-muted-foreground"
        >&#9633;</span
      >
      <div class="flex-1">
        <b class="text-foreground"
          >Replay any trade on a chart<span
            class="ml-2 rounded-full border border-chart-3/30 bg-chart-3/12 px-2 py-0.5 align-middle font-mono text-[10px] tracking-[0.08em] uppercase text-chart-3"
            >Stretch</span
          ></b
        >
        <p class="mt-[3px] mb-0 text-[13.5px] leading-[1.5] text-muted-foreground">
          Reconstruct a price chart with your entry and exit for each trade, straight from the imported data, for visual review.
        </p>
      </div>
    </li>
    <li class="flex items-start gap-3 border-b border-border py-[11px]">
      <span
        class="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-[6px] border border-border text-[12px] text-muted-foreground"
        >&#9633;</span
      >
      <div class="flex-1">
        <b class="text-foreground">A power-user workspace</b>
        <p class="mt-[3px] mb-0 text-[13.5px] leading-[1.5] text-muted-foreground">
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
