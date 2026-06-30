<script lang="ts">
  // Dialog backdrop (A128, shadcn-svelte pattern on bits-ui). The dimming layer behind a modal;
  // bits-ui owns the show/hide presence. Styling is Tailwind utilities (CSP-safe — a linked sheet).
  import { Dialog as DialogPrimitive } from 'bits-ui';
  import { cn } from '$ui/utils';

  let { class: className, ref = $bindable(null), ...rest }: DialogPrimitive.OverlayProps = $props();
</script>

<DialogPrimitive.Overlay bind:ref class={cn('fixed inset-0 z-[60] bg-black/60', className)} {...rest} />
