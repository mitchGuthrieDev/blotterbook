<script lang="ts">
  // Select trigger (A128, shadcn-svelte pattern on bits-ui). The button that opens the listbox and
  // shows the current value (via Select.Value). Token-utility styled; bits-ui positions the popup
  // with Floating UI (CSSOM — CSP-safe).
  import { Select as SelectPrimitive } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$ui/utils';

  let {
    class: className,
    ref = $bindable(null),
    children,
    ...rest
  }: SelectPrimitive.TriggerProps & { children?: Snippet } = $props();
</script>

<SelectPrimitive.Trigger
  bind:ref
  class={cn(
    'inline-flex cursor-pointer items-center justify-between gap-2 rounded-md border border-line bg-panel2 px-2 py-[7px] text-[13px] text-txt focus:outline-2 focus:outline-offset-2 focus:outline-primary disabled:cursor-not-allowed disabled:opacity-50 data-placeholder:text-faint',
    className
  )}
  {...rest}
>
  {@render children?.()}
  <span aria-hidden="true" class="text-faint">▾</span>
</SelectPrimitive.Trigger>
