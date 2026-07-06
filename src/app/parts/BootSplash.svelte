<script lang="ts">
  // F45 — a quick branded splash over the boot sequence (staging-gated by the caller). It is PURELY
  // visual: it mounts alongside boot (never awaits or delays it) and removes itself the instant the
  // shell is ready. The Blotterbook wordmark (mono type — the app's primary typeface) sits over a
  // full-viewport bg-background overlay with a pulsing block cursor; on `ready` it fades out (~200ms)
  // and unmounts via `ondismiss`. A 3s safety timeout forces removal even if boot hangs, so the
  // splash can never trap the user. Reduced motion collapses the fade (dur() → 0, A146) and the
  // cursor pulse (motion-reduce:animate-none).
  import { fade } from 'svelte/transition';
  import { dur } from '../lib/motion.ts';

  let { ready = false, ondismiss }: { ready?: boolean; ondismiss: () => void } = $props();

  let visible = $state(true);
  const done = () => {
    visible = false;
  };

  // Remove once the shell is ready…
  $effect(() => {
    if (ready) done();
  });
  // …and no matter what, on a 3s safety timeout (boot hang) — never block the user behind the splash.
  $effect(() => {
    const t = setTimeout(done, 3000);
    return () => clearTimeout(t);
  });
</script>

{#if visible}
  <div
    data-testid="boot-splash"
    class="fixed inset-0 z-[60] grid place-items-center bg-background"
    role="status"
    aria-label="Loading Blotterbook"
    out:fade={{ duration: dur(200) }}
    onoutroend={ondismiss}
  >
    <div class="flex items-center gap-1.5 font-mono text-2xl font-semibold tracking-tight text-foreground">
      <span>Blotterbook</span>
      <!-- pulsing block cursor — the subtle motion accent (flat under reduced motion) -->
      <span class="inline-block h-6 w-[0.55rem] animate-pulse bg-primary motion-reduce:animate-none" aria-hidden="true"></span>
    </div>
  </div>
{/if}
