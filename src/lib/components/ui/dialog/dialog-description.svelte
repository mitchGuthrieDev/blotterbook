<script lang="ts">
  import { Dialog as DialogPrimitive, type WithoutChild } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<DialogPrimitive.DescriptionProps> = $props();
</script>

<DialogPrimitive.Description
  bind:ref
  data-slot="dialog-description"
  class={cn("text-muted-foreground text-sm", className)}
  {...restProps}
/>
