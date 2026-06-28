<script>
  // Filter + scope bar (A27). Drives the whole dashboard: App applies these filters to the trade
  // set and recomputes metrics. `filters` is a shared reactive object (mutated in place — Svelte 5
  // deep reactivity propagates to App's deriveds). Scope = all-time vs the calendar's current month.
  // Session + tag filters and saved-filter views from the vanilla bar are deferred to a later slice.
  let { filters, roots, tags = [], savedFilters = [], count = 0, onclear, onsave = () => {}, onapply = () => {}, ondelete = () => {} } = $props();
  let viewName = $state('');
  const save = () => {
    onsave(viewName);
    viewName = '';
  };
  const SIDES = [
    ['', 'Both sides'],
    ['long', 'Long'],
    ['short', 'Short'],
  ];
  const SESSIONS = [
    ['', 'All sessions'],
    ['rth', 'RTH'],
    ['eth', 'ETH'],
  ];
  const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const toggleDow = d => (filters.dows = filters.dows.includes(d) ? filters.dows.filter(x => x !== d) : [...filters.dows, d]);
</script>

<section class="filterbar">
  <div class="scope" role="group" aria-label="Scope">
    <button type="button" class:on={filters.scope === 'all'} aria-pressed={filters.scope === 'all'} onclick={() => (filters.scope = 'all')}>All time</button>
    <button type="button" class:on={filters.scope === 'month'} aria-pressed={filters.scope === 'month'} onclick={() => (filters.scope = 'month')}>Calendar month</button>
  </div>
  <label>From<input type="date" bind:value={filters.from} /></label>
  <label>To<input type="date" bind:value={filters.to} /></label>
  <label>Symbol
    <select bind:value={filters.root}>
      <option value="">All</option>
      {#each roots as r (r)}<option value={r}>{r}</option>{/each}
    </select>
  </label>
  <label>Side
    <select bind:value={filters.side}>
      {#each SIDES as [v, l] (v)}<option value={v}>{l}</option>{/each}
    </select>
  </label>
  <label>Session
    <select bind:value={filters.session}>
      {#each SESSIONS as [v, l] (v)}<option value={v}>{l}</option>{/each}
    </select>
  </label>
  {#if tags.length}
    <label>Tag
      <select bind:value={filters.tag}>
        <option value="">All tags</option>
        {#each tags as tg (tg)}<option value={tg}>{tg}</option>{/each}
      </select>
    </label>
  {/if}
  <div class="dows" role="group" aria-label="Day of week">
    {#each DOW as d, i (d)}
      <button type="button" class:on={filters.dows.includes(i)} aria-pressed={filters.dows.includes(i)} onclick={() => toggleDow(i)}>{d}</button>
    {/each}
  </div>
  <span class="count">{count} trade{count === 1 ? '' : 's'}</span>
  <button type="button" class="clear" onclick={onclear}>Clear</button>
</section>

<section class="saved">
  <input class="vname" type="text" placeholder="Name this view…" bind:value={viewName} onkeydown={e => e.key === 'Enter' && save()} />
  <button type="button" class="savebtn" onclick={save}>Save view</button>
  {#each savedFilters as sf (sf.id)}
    <span class="chip">
      <button type="button" class="apply" onclick={() => onapply(sf)}>{sf.name}</button>
      <button type="button" class="del" aria-label="Delete view {sf.name}" onclick={() => ondelete(sf.id)}>×</button>
    </span>
  {/each}
</section>

<style>
  .filterbar {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px 12px;
    padding: 12px 14px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    margin-bottom: 16px;
  }
  .scope {
    display: flex;
    gap: 0;
  }
  .scope button {
    background: var(--panel2);
    color: var(--dim);
    border: 1px solid var(--line);
    padding: 7px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .scope button:first-child {
    border-radius: 6px 0 0 6px;
  }
  .scope button:last-child {
    border-radius: 0 6px 6px 0;
    border-left: 0;
  }
  .scope button.on {
    background: var(--accent);
    color: #0d1014;
    border-color: var(--accent);
    font-weight: 700;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 11px;
    color: var(--faint);
  }
  input,
  select {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 13px;
    font-family: var(--sans);
  }
  input:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
  }
  .dows {
    display: flex;
    gap: 3px;
    align-self: flex-end;
  }
  .dows button {
    background: var(--panel2);
    color: var(--dim);
    border: 1px solid var(--line);
    border-radius: 5px;
    padding: 6px 7px;
    font-size: 11px;
    font-family: var(--mono);
    cursor: pointer;
  }
  .dows button.on {
    background: var(--accent);
    color: #0d1014;
    border-color: var(--accent);
    font-weight: 700;
  }
  .count {
    margin-left: auto;
    font-size: 12px;
    font-family: var(--mono);
    color: var(--faint);
    align-self: center;
  }
  .clear {
    background: transparent;
    color: var(--dim);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 7px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .clear:hover {
    border-color: var(--hover-line);
    color: var(--txt);
  }
  .saved {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: -8px 0 16px;
  }
  .vname {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 12px;
  }
  .savebtn {
    background: var(--panel2);
    color: var(--txt);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .chip {
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--line);
    border-radius: 6px;
    overflow: hidden;
  }
  .chip .apply {
    background: var(--panel);
    color: var(--accent);
    border: 0;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .chip .del {
    background: var(--panel);
    color: var(--faint);
    border: 0;
    border-left: 1px solid var(--line);
    padding: 6px 8px;
    cursor: pointer;
  }
  .chip .del:hover {
    color: var(--red);
  }
</style>
