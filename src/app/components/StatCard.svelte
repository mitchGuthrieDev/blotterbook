<script lang="ts">
  // A single overview metric. tone ('' | 'pos' | 'neg') colors the value; `card` is a stable
  // hook (data-card) used by the e2e specs. Styles are scoped (CSP-friendly — A27 step 5).
  interface Props {
    card?: string;
    label?: string;
    value?: string;
    tone?: string;
    sub?: string;
    onclick?: (() => void) | null;
  }
  let { card = '', label = '', value = '', tone = '', sub = '', onclick = null }: Props = $props();
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex (role, tabindex and the keydown handler are all
     gated on `onclick`: when focusable it is a real button; the static check can't see the pairing) -->
<!-- A128: scoped CSS → Tailwind utilities (tokens via @theme). `.value` kept as the e2e hook. -->
<div
  class="rounded-[10px] border border-border bg-card px-3.5 py-3 {onclick
    ? 'cursor-pointer hover:border-ring focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary'
    : ''}"
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
  <div class="text-[11px] uppercase tracking-[0.5px] text-muted-foreground">{label}</div>
  <div class="value mt-1.5 font-mono text-[22px] font-bold {tone === 'pos' ? 'text-chart-2' : tone === 'neg' ? 'text-destructive' : 'text-foreground'}">{value}</div>
  {#if sub}<div class="mt-1 font-mono text-[11px] text-muted-foreground">{sub}</div>{/if}
</div>
