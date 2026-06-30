<script lang="ts">
  // Select option (A128). bits-ui provides role="option", keyboard nav, type-ahead, and the
  // `selected`/`highlighted` snippet state; we render the label + a check on the selected row.
  import { Select as SelectPrimitive } from 'bits-ui';
  import { cn } from '$ui/utils';

  let { class: className, ref = $bindable(null), value, label, ...rest }: SelectPrimitive.ItemProps = $props();
</script>

<SelectPrimitive.Item
  bind:ref
  {value}
  {label}
  class={cn(
    'flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-[13px] text-txt outline-none data-highlighted:bg-panel2 data-disabled:cursor-not-allowed data-disabled:opacity-40',
    className
  )}
  {...rest}
>
  {#snippet children({ selected })}
    <span class="truncate">{label ?? value}</span>
    {#if selected}<span aria-hidden="true" class="ml-auto pl-2 text-primary">✓</span>{/if}
  {/snippet}
</SelectPrimitive.Item>
