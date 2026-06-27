<script>
  // A single overview metric. tone ('' | 'pos' | 'neg') colors the value; `card` is a stable
  // hook (data-card) used by the e2e specs. Styles are scoped (CSP-friendly — A27 step 5).
  let { card = '', label = '', value = '', tone = '', sub = '' } = $props();
</script>

<div class="card" data-card={card}>
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
