<script lang="ts">
  import type { WithElementRef } from 'bits-ui';
  import type { HTMLThAttributes } from 'svelte/elements';
  import { cn } from '$lib/utils.js';

  let { ref = $bindable(null), class: className, children, ...restProps }: WithElementRef<HTMLThAttributes> = $props();
</script>

<!-- CH37 type-weight scale: table headers sit in the "emphasis + card headers + table headers"
     tier (600, matching Card.Title) rather than the shadcn-default "labels + nav" tier (500). -->
<th
  bind:this={ref}
  data-slot="table-head"
  class={cn(
    'text-muted-foreground h-9 px-2 text-left align-middle font-semibold whitespace-nowrap [&:has([role=checkbox])]:pr-0',
    className
  )}
  {...restProps}
>
  {@render children?.()}
</th>
