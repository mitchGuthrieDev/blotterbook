<script lang="ts">
  import { Dialog as DialogPrimitive, type WithoutChild } from "bits-ui";
  import { cn } from "$lib/utils.js";

  let {
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithoutChild<DialogPrimitive.TitleProps> = $props();
</script>

<DialogPrimitive.Title
  bind:ref
  data-slot="dialog-title"
  class={cn("text-lg leading-none font-semibold", className)}
  {...restProps}
/>
