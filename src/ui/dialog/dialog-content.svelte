<script lang="ts">
  // Dialog surface (A128, shadcn-svelte pattern on bits-ui). Renders the dimming Overlay plus the
  // centered modal card. bits-ui handles the accessibility mechanics that the old `use:modal` action
  // did by hand — Escape-to-close, focus trap + restore, ref-counted scroll lock, role="dialog" +
  // aria-modal, and outside-click dismissal — so consumers drop that boilerplate.
  //
  // Rendered in place (NO Portal) on purpose: the app's modals mount inside <main id="sv-app">, and
  // the e2e specs + a couple of styles target `#sv-app .modal`, so we keep the content in that tree.
  // CSP (style-src 'self') is unaffected — Floating UI isn't used here, and all styling is utilities.
  import { Dialog as DialogPrimitive, type WithoutChildrenOrChild } from 'bits-ui';
  import type { Snippet } from 'svelte';
  import { cn } from '$ui/utils';
  import DialogOverlay from './dialog-overlay.svelte';

  let {
    ref = $bindable(null),
    class: className,
    children,
    ...rest
  }: WithoutChildrenOrChild<DialogPrimitive.ContentProps> & { children?: Snippet } = $props();
</script>

<DialogOverlay />
<DialogPrimitive.Content
  bind:ref
  class={cn(
    'fixed left-1/2 top-[6vh] z-[61] max-h-[88vh] w-[calc(100%-32px)] max-w-[460px] -translate-x-1/2 overflow-auto rounded-xl border border-line bg-bg',
    className
  )}
  {...rest}
>
  {@render children?.()}
</DialogPrimitive.Content>
