<script lang="ts">
  // CH36 (from the A104 styling audit): the "Assumptions & caveats" <details> block — shared by the
  // Advanced Statistics and Break-even & Cost panels, which previously each carried a near-identical
  // copy of this markup + CSS. The caller passes the <li> bullets as children.
  import type { Snippet } from 'svelte';

  interface Props {
    summary?: string;
    children: Snippet;
  }
  let { summary = 'Assumptions & caveats', children }: Props = $props();
</script>

<details class="caveats mt-[14px] border-t border-border pt-[10px]">
  <summary
    class="cursor-pointer text-[12px] font-bold uppercase tracking-[0.5px] text-muted-foreground"
    >{summary}</summary
  >
  <ul class="mt-[10px] mb-0 pl-[18px]">{@render children()}</ul>
</details>

<style>
  /* The <li>/<b>/<em>/<i> bullets come from the caller's snippet (the parent component's scope), so
     they're styled with :global — contained under the Caveats-owned .caveats/ul. */
  .caveats :global(li) {
    font-size: 12px;
    line-height: 1.55;
    color: var(--muted-foreground);
    margin-bottom: 6px;
  }
  .caveats :global(b) {
    color: var(--foreground);
  }
  .caveats :global(em),
  .caveats :global(i) {
    color: var(--foreground);
    font-style: italic;
  }
</style>
