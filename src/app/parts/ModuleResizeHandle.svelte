<script lang="ts">
  // A319/A317: the shared corner drag-resize handle (staging-gated by the host screen). Pointer drag
  // snaps to the nearest supported span; role=slider + arrow keys are the keyboard path (the ⋯ menu
  // Size radio is the other). Hidden below lg (mobile stacks; size is ignored there).
  import { Maximize2 } from '@lucide/svelte';
  import { SIZE_LABEL, type SizeController } from '../lib/modsize.svelte.ts';

  let { ctl, modKey, label }: { ctl: SizeController; modKey: string; label: string } = $props();
</script>

<button
  type="button"
  class="absolute right-1 bottom-1 z-10 hidden size-5 cursor-nwse-resize touch-none place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring lg:grid"
  role="slider"
  aria-label="Resize {label} module"
  aria-valuemin={0}
  aria-valuemax={ctl.supportedSizes(modKey).length - 1}
  aria-valuenow={ctl.sizeIndex(modKey)}
  aria-valuetext={SIZE_LABEL[ctl.sizeOf(modKey)]}
  onpointerdown={e => ctl.startResize(e, modKey)}
  onkeydown={e => ctl.onResizeKey(e, modKey)}
>
  <Maximize2 class="size-3" />
</button>
