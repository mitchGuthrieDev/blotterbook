<script lang="ts">
  // Shared Rows / Prev / Next cluster for the paged tables (pairs with createPagination — A157;
  // Blotter + Trade Editor carried near-verbatim copies of this footer markup).
  import { Button } from '$lib/components/ui/button';
  import { PAGE_SIZES, type Pager } from '../lib/pagination.svelte.ts';

  let { pager }: { pager: Pager } = $props();
</script>

<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
  <span class="mr-1">Rows:</span>
  {#each PAGE_SIZES as sz (sz)}
    <button
      type="button"
      onclick={() => (pager.pageSize = sz)}
      class={['rounded px-1.5 py-0.5 transition-colors', pager.pageSize === sz ? 'bg-secondary text-foreground' : 'hover:text-foreground']}
    >
      {sz === Infinity ? 'All' : sz}
    </button>
  {/each}
  <Button variant="outline" size="sm" class="ml-1 h-7" disabled={pager.page === 0} onclick={() => pager.prev()}>Prev</Button>
  <span class="tabular-nums">{pager.page + 1}/{pager.totalPages}</span>
  <Button variant="outline" size="sm" class="h-7" disabled={pager.page >= pager.totalPages - 1} onclick={() => pager.next()}>Next</Button>
</span>
