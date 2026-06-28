<script>
  // A single overview metric. tone ('' | 'pos' | 'neg') colors the value; `card` is a stable
  // hook (data-card) used by the e2e specs. Styles are scoped (CSP-friendly — A27 step 5).
  let { card = '', label = '', value = '', tone = '', sub = '', onclick = null } = $props();
</script>

<div
  class="card"
  class:clickable={!!onclick}
  data-card={card}
  role={onclick ? 'button' : undefined}
  tabindex={onclick ? 0 : undefined}
  onclick={onclick || undefined}
  onkeydown={onclick
    ? e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onclick();
        }
      }
    : undefined}
>
  <div class="label">{label}</div>
  <div class="value" class:pos={tone === 'pos'} class:neg={tone === 'neg'}>{value}</div>
  {#if sub}<div class="sub">{sub}</div>{/if}
</div>

<style>
  .card {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 12px 14px;
  }
  .card.clickable {
    cursor: pointer;
  }
  .card.clickable:hover {
    border-color: var(--hover-line);
  }
  .card.clickable:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--faint);
  }
  .value {
    font-family: var(--mono);
    font-size: 22px;
    font-weight: 700;
    margin-top: 6px;
    color: var(--txt);
  }
  .value.pos {
    color: var(--green);
  }
  .value.neg {
    color: var(--red);
  }
  .sub {
    margin-top: 4px;
    font-size: 11px;
    color: var(--dim);
    font-family: var(--mono);
  }
</style>
