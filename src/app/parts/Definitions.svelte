<script lang="ts">
  // Definitions & Caveats (CH16 redesign chrome). Static informational content porting the legacy
  // src/app/components/Definitions.svelte (the foundational parsing caveats) plus the cost/tax
  // disclaimers previously carried in the Caveats <details>. Plain prose in the greyscale token
  // style. Self-contained — optional `class` only.
  import { cn } from '$lib/utils';

  let { class: className }: { class?: string } = $props();
</script>

<div class={cn('rounded-md border border-border bg-card p-3', className)}>
  <!-- CH37: card-header tier (600) for the section title, matching the app-wide text-xs/[11px]
       font-semibold uppercase section-header convention (Dashboard moduleHeader, ActivityTerminal,
       DetectionStatus, etc); the dt terms below are the same tier ("emphasis"). -->
  <h2 class="m-0 mb-3 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted-foreground">Definitions &amp; Caveats</h2>

  <div class="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-x-7 gap-y-0">
    <dl class="m-0">
      <dt class="mt-3 text-[12px] font-semibold text-foreground">Trade = one closed position</dt>
      <dd class="mt-[3px] mb-0 text-[12px] leading-[1.55] text-muted-foreground">
        Each trade is one realized-P&amp;L event. Depending on the platform Blotterbook auto-detects, that's either one row per closed
        position (close-event exports like TradingView) or entry/exit fills paired into round-trips by a FIFO matcher (which also recovers
        hold time). A fill that closes lots opened at different times books one trade per matched lot, so the trade count can exceed your
        platform's order count; positions still open at the end of a fills export aren't imported. TradingView is verified; the other eight
        adapters are beta — verify the parsed numbers against your statement.
      </dd>
    </dl>

    <dl class="m-0">
      <dt class="mt-3 text-[12px] font-semibold text-chart-4">US dates &amp; Eastern time assumed</dt>
      <dd class="mt-[3px] mb-0 text-[12px] leading-[1.55] text-muted-foreground">
        Timestamps are read as written, in the export's own clock — no timezone conversion. Dates parse as US <b class="text-foreground"
          >M/D/Y</b
        >; an unambiguous day &gt; 12 (e.g. 25/06) is auto-detected as D/M/Y, but ambiguous non-US dates can land on the wrong day. Session
        (RTH/ETH) classification assumes US Eastern time. Export in a US/ET format, or verify the parsed dates before trusting
        day/week/month grouping.
      </dd>
    </dl>

    <dl class="m-0">
      <dt class="mt-3 text-[12px] font-semibold text-foreground">Costs &amp; take-home are estimates</dt>
      <dd class="mt-[3px] mb-0 text-[12px] leading-[1.55] text-muted-foreground">
        Commissions apply your selected broker's per-side rate plus the CME exchange/clearing/NFA fee for each contract root, charged per
        round-turn contract (2 sides × qty). Platform + data-feed subscriptions accrue over every calendar month spanned by your trades
        (inclusive), not just the months you traded. All figures are editable snapshot estimates — confirm against your broker's live
        schedule.
      </dd>
    </dl>

    <dl class="m-0">
      <dt class="mt-3 text-[12px] font-semibold text-chart-4">Tax figures are not tax advice</dt>
      <dd class="mt-[3px] mb-0 text-[12px] leading-[1.55] text-muted-foreground">
        Take-home applies a simplified Section 1256 blended federal rate (60/40 long/short-term) plus your selected state's top marginal
        rate to net-of-cost profit; losses are not carried and tax on a losing period is zero. Note the base is net of subscriptions as a
        simplification — subscriptions don't actually reduce a §1256 gain for a non-trader-tax-status filer, so the estimate can understate
        tax slightly. This is a rough planning estimate, not tax advice — consult a professional for your actual liability. Sharpe uses
        daily-P&amp;L dispersion and is not annualized; small per-weekday samples are noisy.
      </dd>
    </dl>
  </div>
</div>
