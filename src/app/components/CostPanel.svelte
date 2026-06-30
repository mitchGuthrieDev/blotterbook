<script lang="ts">
  // Break-even & cost (A27; A32). REUSES costModel() verbatim (A29). The cost setup is now owned by
  // App and shared with the curve overlays — this panel binds its form to the shared `setup` object
  // and renders the breakdown from costModel(metrics, costInputs). No DOM-id coupling; App persists.
  import { costModel, BROKERS, BROKER_ORDER, BROKER_FEEDS, STATES, usd, money } from '../../lib/core/core.ts';
  import type { Metrics } from '../../lib/core/core.ts';
  import type { AppSetup, CostInputs, PanelBundle, StateRow } from '../../lib/core/types.ts';
  import Panel from './Panel.svelte';
  import Caveats from './Caveats.svelte';
  import * as Select from '$lib/components/ui/select';

  interface Props {
    metrics: Metrics;
    setup: AppSetup;
    costInputs: CostInputs;
    /** F22 (staging): figures are all-time / account-level, independent of scope + filters. */
    allTime?: boolean;
    /** A87: disable the cost-setup inputs on the demo surface (demo never mutates). */
    disabled?: boolean;
    panel?: PanelBundle;
  }
  let { metrics, setup, costInputs, allTime = false, disabled = false, panel = {} as PanelBundle }: Props = $props();

  // A97 (R18 — promoted to all surfaces, CH16): the cost/tax notes from the standalone Definitions panel
  // are folded into this panel's Assumptions (the Net PnL / take-home definition). The "raw PnL is gross"
  // caveat is already covered by the always-on "Costs assume gross P&L" bullet (A119).

  const feedGroups = $derived(BROKER_FEEDS[setup.broker] || {});
  const stateOpts = $derived(STATES.slice().sort((a: StateRow, b: StateRow) => (a[2] < b[2] ? -1 : 1)));
  const pct = (v: number) => (v * 100).toFixed(1) + '%';
  const cost = $derived(metrics ? costModel(metrics, costInputs) : null);

  // A128: select option/label arrays double as Root.items so Select.Value resolves the seeded value's
  // label while the listbox is closed.
  const brokerItems = $derived(BROKER_ORDER.map(k => ({ value: k, label: BROKERS[k].name })));
  const feedItems = $derived(
    Object.entries(feedGroups).flatMap(([, list]) => list.map(([name, c]) => ({ value: `${name}|${c}`, label: `${name} — $${c}` })))
  );
  const stateItems = $derived(stateOpts.map(([a, , n]) => ({ value: a, label: n })));

  function onBroker(v: string) {
    setup.broker = v;
    setup.feed = ''; // feed options depend on broker — reset like the vanilla populateFeeds()
  }
</script>

<Panel {...panel} title="Break-even &amp; Cost">
  <div class="costpanel">
  <div class="mb-4 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-[10px]">
    <div class="flex flex-col gap-1 text-[11px] text-muted-foreground">
      <span>Broker</span>
      <Select.Root type="single" value={setup.broker} onValueChange={onBroker} items={brokerItems} {disabled}>
        <Select.Trigger aria-label="Broker"><Select.Value placeholder="— Select broker —" /></Select.Trigger>
        <Select.Content>
          {#each brokerItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="flex flex-col gap-1 text-[11px] text-muted-foreground">
      <span>Data feed</span>
      <Select.Root type="single" bind:value={setup.feed} items={feedItems} {disabled}>
        <Select.Trigger aria-label="Data feed"><Select.Value placeholder="— Select data feed —" /></Select.Trigger>
        <Select.Content>
          {#each Object.entries(feedGroups) as [grp, list] (grp)}
            <Select.Group>
              <Select.Label class="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">{grp}</Select.Label>
              {#each list as [name, c] (name)}<Select.Item value={`${name}|${c}`} label={`${name} — $${c}`} />{/each}
            </Select.Group>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="flex flex-col gap-1 text-[11px] text-muted-foreground">
      <span>State</span>
      <Select.Root type="single" bind:value={setup.stateAbbr} items={stateItems} {disabled}>
        <Select.Trigger aria-label="State"><Select.Value placeholder="— Select state —" /></Select.Trigger>
        <Select.Content>
          {#each stateItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
        </Select.Content>
      </Select.Root>
    </div>
    <label class="flex flex-col gap-1 text-[11px] text-muted-foreground">
      <span>Platform fee ($/mo)</span>
      <input
        type="number"
        min="0"
        step="1"
        bind:value={setup.platform}
        {disabled}
        class="rounded-md border border-border bg-secondary px-2 py-[7px] font-mono text-[13px] text-foreground focus:border-primary focus:outline-none"
      />
    </label>
  </div>

  {#if cost}
    {#if allTime}
      <p class="mb-3 rounded-md border border-border bg-secondary px-[10px] py-[7px] text-[11px] leading-[1.4] text-muted-foreground">Account-level budget — computed from <b>all trades (all-time)</b>, independent of the scope toggle and filter bar.</p>
    {/if}
    <div>
      <div class="flex items-baseline justify-between border-b border-border pb-[10px] mb-2">
        <span class="text-[12px] text-muted-foreground">Estimated take-home</span>
        <span class="font-mono text-[24px] font-bold {cost.afterTax < 0 ? 'text-destructive' : 'text-chart-3'}" data-cost-takehome>{usd(cost.afterTax)}</span>
      </div>
      <div class="grid gap-[2px] [&_.line]:flex [&_.line]:justify-between [&_.line]:gap-3 [&_.line]:border-b [&_.line]:border-border [&_.line]:py-[6px] [&_.line]:text-[13px] [&_.line>span:first-child]:text-muted-foreground [&_.line>span:last-child]:font-mono [&_.line>span:last-child]:font-bold [&_.line>span:last-child]:text-foreground">
        <div class="line"><span>Gross P&amp;L</span><span class={cost.gross < 0 ? '!text-destructive' : ''}>{usd(cost.gross)}</span></div>
        <div class="line"><span>Commissions ({cost.contracts} contracts)</span><span class="!text-destructive">-{money(cost.totalComm)}</span></div>
        <div class="line"><span>Platform + data ({money(cost.fixedMo)}/mo × {cost.months} mo)</span><span class="!text-destructive">-{money(cost.fixedPeriod)}</span></div>
        <div class="line"><span>Pre-tax net</span><span class={cost.netPreTax < 0 ? '!text-destructive' : ''}>{usd(cost.netPreTax)}</span></div>
        <div class="line"><span>Est. tax (Section 1256 blend, {pct(cost.tEff)})</span><span class="!text-destructive">-{money(cost.tax)}</span></div>
        <div class="line"><span>Break-even / trade</span><span>{money(cost.bePer)}</span></div>
      </div>
    </div>

    {#if cost.bySym.length}
      <!-- A123: the 6-column table scrolls WITHIN the panel on a narrow width (mobile / narrow F26
           grid column) rather than clipping its last column past the module border. -->
      <div class="mt-[14px] overflow-x-auto">
        <table
          class="bysym w-full border-collapse text-[12px] [&_th]:border-b [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-right [&_th]:font-semibold [&_th]:text-muted-foreground [&_th:first-child]:text-left [&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-[5px] [&_td]:text-right [&_td]:font-mono [&_td:first-child]:text-left"
        >
          <thead><tr><th>Symbol</th><th>Trades</th><th>Contracts</th><th>$/side</th><th>$/RT</th><th>Commission</th></tr></thead>
          <tbody>
            {#each cost.bySym as r (r.root)}
              <tr>
                <td>{r.root}{#if !r.known}<span class="ml-[2px] text-chart-4" title="Exchange fee estimated (root not in fee table)">*</span>{/if}</td>
                <td>{r.count}</td>
                <td>{r.qty}</td>
                <td>{money(r.rate)}</td>
                <td>{money(r.rate * 2)}</td>
                <td>{money(r.total)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      {#if cost.bySym.some(r => !r.known)}
        <p class="mt-2 text-[11px] leading-[1.5] text-muted-foreground"><span class="ml-[2px] text-chart-4">*</span> No published exchange fee on file — priced with a fallback estimate. Add the symbol to <code class="font-mono text-foreground">data/exchange-fees.json</code> for an exact figure.</p>
      {/if}
    {/if}

    <Caveats>
      <li><b>Round-turn commission, per contract.</b> Each trade is a closed position; the round-turn commission — 2 × the symbol's per-side rate — is charged once per contract (× the trade's quantity).</li>
      <li><b>Per-symbol commissions.</b> The symbol root is priced as the selected broker's commission plus the contract's CME exchange/clearing/NFA fee. Symbols without a known exchange fee use a fallback and are flagged with *. All rates are editable estimates — verify against your account.</li>
      <li><b>Subscriptions are not prorated.</b> A full month of platform + data fee is charged for every calendar month from your first to your last trade (gap months included), since those fees bill whether or not you trade, across the {allTime ? 'full dataset (all-time)' : 'active scope'}.</li>
      <li><b>Costs assume gross P&amp;L.</b> The model treats the export's P&amp;L as <i>before</i> commissions and overlays the broker rates — if your platform already reports P&amp;L net of fees, commissions are double-counted. And a close-event export with no per-trade quantity (e.g. TradingView) is billed as a <i>single contract</i>, so a multi-contract position's commission is under-stated.</li>
      <li><b>Tax = blended 1256 rate:</b> 60% × 15% long-term + 40% × 24% ordinary (assumed bracket) + your state's top rate, applied only when net profit is positive.</li>
      <li><b>Break-even / trade</b> = total period costs ÷ trade count: the average gross each trade needed to clear costs.</li>
      <li><b>Net PnL &amp; take-home.</b> Net PnL = gross − per-symbol commissions − subscriptions. Take-home is Net PnL after the estimated Section 1256 tax, shown on the Net PnL card and here in the Break-even panel.</li>
    </Caveats>
  {/if}
  </div>
</Panel>
