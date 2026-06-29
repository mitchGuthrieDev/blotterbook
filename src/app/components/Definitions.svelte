<script lang="ts">
  // Definitions & Caveats (A37). Static glossary + warnings.
  // A97 (R18 — promoted to all surfaces, CH16): the per-metric definitions now live in the panels/modals
  // that own each number (AdvancedStats "Assumptions", the F14 stat-card modals, CostPanel, EquityCurve,
  // CalendarMonth, the scope toggle). This panel is therefore trimmed everywhere to just the cross-cutting
  // *parsing* caveats that gate every grouping and need one discoverable home (what a "trade" is;
  // US-date/Eastern-time assumptions).
  import Panel from './Panel.svelte';
  import type { PanelBundle } from '../../lib/types.ts';

  interface Props {
    panel?: PanelBundle;
    /** F27 (staging): render the caveats as a page footer (contentinfo) instead of a dashboard panel. */
    footer?: boolean;
  }
  let { panel = {} as PanelBundle, footer = false }: Props = $props();
</script>

<!-- A97: trimmed to the foundational parsing caveats — these gate the trustworthiness of every
     downstream number, so they stay in one place a user can read before trusting any grouping. -->
{#snippet body()}
  <dl>
    <dt>Trade = one closed position</dt>
    <dd>Each trade is one realized-PnL event. Depending on the platform Blotterbook auto-detects, that's either one row per closed position (close-event exports like TradingView) or entry/exit fills paired into round-trips by a FIFO matcher (which also recovers hold time). TradingView is verified; the other eight adapters are beta — verify the parsed numbers against your statement.</dd>
  </dl>
  <dl class="warn">
    <dt>US dates &amp; Eastern time assumed</dt>
    <dd>Timestamps are read as written, in the export's own clock — no timezone conversion. Dates parse as US <b>M/D/Y</b>; an unambiguous day &gt; 12 (e.g. 25/06) is auto-detected as D/M/Y, but ambiguous non-US dates can land on the wrong day. Session (RTH/ETH) classification assumes US Eastern time. Export in a US/ET format, or verify the parsed dates before trusting day/week/month grouping.</dd>
  </dl>
{/snippet}

{#if footer}
  <!-- F27 (staging): the Definitions & Caveats module is relegated to a page footer. -->
  <footer class="defs deffoot" aria-label="Definitions and caveats">
    <h2 class="foothd">Definitions &amp; Caveats</h2>
    <div class="defbody">{@render body()}</div>
  </footer>
{:else}
  <Panel {...panel} title="Definitions &amp; Caveats">
    <div class="defs defbody">{@render body()}</div>
  </Panel>
{/if}

<style>
  .defbody {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 0 28px;
  }
  /* F27 (staging): footer variant — a muted band below the dashboard, separated by a top rule. */
  .deffoot {
    margin-top: 28px;
    padding-top: 16px;
    border-top: 1px solid var(--line);
  }
  .foothd {
    margin: 0 0 8px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--faint);
    font-weight: 700;
  }
  dl {
    margin: 0;
  }
  dt {
    font-size: 12px;
    font-weight: 700;
    color: var(--txt);
    margin-top: 12px;
  }
  dd {
    margin: 3px 0 0;
    font-size: 12px;
    line-height: 1.55;
    color: var(--dim);
  }
  dl.warn dt {
    color: var(--warn);
  }
</style>
