<script lang="ts">
  // Break-even & cost (A27; A32). REUSES costModel() verbatim (A29). The cost setup is now owned by
  // App and shared with the curve overlays — this panel binds its form to the shared `setup` object
  // and renders the breakdown from costModel(metrics, costInputs). No DOM-id coupling; App persists.
  import { costModel, BROKERS, BROKER_ORDER, BROKER_FEEDS, STATES, usd, money } from '../../lib/core.ts';
  import type { Metrics } from '../../lib/core.ts';
  import type { AppSetup, CostInputs, PanelBundle, StateRow } from '../../lib/types.ts';
  import Panel from './Panel.svelte';
  import Caveats from './Caveats.svelte';
  import * as Select from '$ui/select';

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
  <div class="setup">
    <div class="field">
      <span>Broker</span>
      <Select.Root type="single" value={setup.broker} onValueChange={onBroker} items={brokerItems} {disabled}>
        <Select.Trigger aria-label="Broker"><Select.Value placeholder="— Select broker —" /></Select.Trigger>
        <Select.Content>
          {#each brokerItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="field">
      <span>Data feed</span>
      <Select.Root type="single" bind:value={setup.feed} items={feedItems} {disabled}>
        <Select.Trigger aria-label="Data feed"><Select.Value placeholder="— Select data feed —" /></Select.Trigger>
        <Select.Content>
          {#each Object.entries(feedGroups) as [grp, list] (grp)}
            <Select.Group>
              <Select.GroupHeading class="px-2 py-1 text-[10px] uppercase tracking-wide text-faint">{grp}</Select.GroupHeading>
              {#each list as [name, c] (name)}<Select.Item value={`${name}|${c}`} label={`${name} — $${c}`} />{/each}
            </Select.Group>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="field">
      <span>State</span>
      <Select.Root type="single" bind:value={setup.stateAbbr} items={stateItems} {disabled}>
        <Select.Trigger aria-label="State"><Select.Value placeholder="— Select state —" /></Select.Trigger>
        <Select.Content>
          {#each stateItems as it (it.value)}<Select.Item value={it.value} label={it.label} />{/each}
        </Select.Content>
      </Select.Root>
    </div>
    <label>
      <span>Platform fee ($/mo)</span>
      <input type="number" min="0" step="1" bind:value={setup.platform} {disabled} />
    </label>
  </div>

  {#if cost}
    {#if allTime}
      <p class="allnote">Account-level budget — computed from <b>all trades (all-time)</b>, independent of the scope toggle and filter bar.</p>
    {/if}
    <div class="breakdown">
      <div class="takehome" class:neg={cost.afterTax < 0}>
        <span class="lbl">Estimated take-home</span>
        <span class="val" data-cost-takehome>{usd(cost.afterTax)}</span>
      </div>
      <div class="lines">
        <div class="line"><span>Gross P&amp;L</span><span class:neg={cost.gross < 0}>{usd(cost.gross)}</span></div>
        <div class="line"><span>Commissions ({cost.contracts} contracts)</span><span class="neg">-{money(cost.totalComm)}</span></div>
        <div class="line"><span>Platform + data ({money(cost.fixedMo)}/mo × {cost.months} mo)</span><span class="neg">-{money(cost.fixedPeriod)}</span></div>
        <div class="line sub"><span>Pre-tax net</span><span class:neg={cost.netPreTax < 0}>{usd(cost.netPreTax)}</span></div>
        <div class="line"><span>Est. tax (Section 1256 blend, {pct(cost.tEff)})</span><span class="neg">-{money(cost.tax)}</span></div>
        <div class="line"><span>Break-even / trade</span><span>{money(cost.bePer)}</span></div>
      </div>
    </div>

    {#if cost.bySym.length}
      <!-- A123: the 6-column table scrolls WITHIN the panel on a narrow width (mobile / narrow F26
           grid column) rather than clipping its last column past the module border. -->
      <div class="bywrap">
        <table class="bysym">
          <thead><tr><th>Symbol</th><th>Trades</th><th>Contracts</th><th>$/side</th><th>$/RT</th><th>Commission</th></tr></thead>
          <tbody>
            {#each cost.bySym as r (r.root)}
              <tr>
                <td>{r.root}{#if !r.known}<span class="est" title="Exchange fee estimated (root not in fee table)">*</span>{/if}</td>
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
        <p class="cnote"><span class="est">*</span> No published exchange fee on file — priced with a fallback estimate. Add the symbol to <code>data/exchange-fees.json</code> for an exact figure.</p>
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

<style>
  .allnote {
    margin: 0 0 12px;
    padding: 7px 10px;
    font-size: 11px;
    line-height: 1.4;
    color: var(--dim);
    background: var(--panel2);
    border: 1px solid var(--line);
    border-radius: 6px;
  }
  .setup {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }
  label,
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 11px;
    color: var(--faint);
  }
  input {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 7px 8px;
    font-size: 13px;
    font-family: var(--mono);
  }
  input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .takehome {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding-bottom: 10px;
    margin-bottom: 8px;
    border-bottom: 1px solid var(--line);
  }
  .takehome .lbl {
    font-size: 12px;
    color: var(--dim);
  }
  .takehome .val {
    font-family: var(--mono);
    font-size: 24px;
    font-weight: 700;
    color: var(--take);
  }
  .takehome.neg .val {
    color: var(--red);
  }
  .lines {
    display: grid;
    gap: 2px;
  }
  .line {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
    font-size: 13px;
    border-bottom: 1px solid var(--line);
  }
  .line span:first-child {
    color: var(--dim);
  }
  .line span:last-child {
    font-family: var(--mono);
    font-weight: 700;
    color: var(--txt);
  }
  .line .neg {
    color: var(--red);
  }
  .line.sub span:last-child {
    color: var(--txt);
  }
  /* A123: scroll the by-symbol table within the panel on narrow widths (no clipping past the border). */
  .bywrap {
    overflow-x: auto;
    margin-top: 14px;
  }
  .bysym {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .bysym th {
    text-align: right;
    color: var(--faint);
    font-weight: 600;
    padding: 4px 8px;
    border-bottom: 1px solid var(--line);
  }
  .bysym th:first-child {
    text-align: left;
  }
  .bysym td {
    text-align: right;
    padding: 5px 8px;
    font-family: var(--mono);
    border-bottom: 1px solid var(--line);
  }
  .bysym td:first-child {
    text-align: left;
  }
  .est {
    color: var(--warn);
    margin-left: 2px;
  }
  .cnote {
    margin: 8px 0 0;
    font-size: 11px;
    line-height: 1.5;
    color: var(--dim);
  }
  .cnote code {
    font-family: var(--mono);
    color: var(--txt);
  }
  /* CH36: the "Assumptions & caveats" block moved to the shared Caveats.svelte component. */
</style>
