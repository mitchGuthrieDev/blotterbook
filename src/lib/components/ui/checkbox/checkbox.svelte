<script lang="ts">
  import { Checkbox as CheckboxPrimitive, type WithoutChildrenOrChild } from 'bits-ui';
  import { Check, Minus } from '@lucide/svelte';
  import { cn } from '$lib/utils.js';

  let {
    ref = $bindable(null),
    checked = $bindable(false),
    indeterminate = $bindable(false),
    class: className,
    ...restProps
  }: WithoutChildrenOrChild<CheckboxPrimitive.RootProps> = $props();
</script>

<CheckboxPrimitive.Root
  bind:ref
  data-slot="checkbox"
  class={cn(
    // A222: coarse-pointer hit-slop — the 16px visual box stays the canonical shadcn size; touch
    // devices get an invisible enlarged tap area via a positioned ::before (no layout change, and
    // callers that stopPropagation() on the wrapping cell/row keep working unchanged).
    "border-input peer relative size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground pointer-coarse:before:absolute pointer-coarse:before:-inset-1.5 pointer-coarse:before:content-['']",
    className
  )}
  bind:checked
  bind:indeterminate
  {...restProps}
>
  {#snippet children({ checked, indeterminate })}
    <div data-slot="checkbox-indicator" class="flex size-full items-center justify-center text-current">
      {#if indeterminate}
        <Minus class="size-3.5" />
      {:else if checked}
        <Check class="size-3.5" />
      {/if}
    </div>
  {/snippet}
</CheckboxPrimitive.Root>
