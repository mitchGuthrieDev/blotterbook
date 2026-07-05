<script lang="ts">
  // A200: one-at-a-time card stack for narrow viewports — swipe (pointer), arrow buttons, or
  // ←/→ keys move between slides, with a dot indicator. Generic: the parent supplies the slide
  // snippet, so any screen can reuse it. The fly-in collapses under reduced motion (A146 dur()).
  import type { Snippet } from 'svelte';
  import { fly } from 'svelte/transition';
  import { ChevronLeft, ChevronRight } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import { dur } from '../lib/motion.ts';

  let { count, label, slide }: { count: number; label: string; slide: Snippet<[number]> } = $props();

  let idx = $state(0);
  let dir = $state(1); // travel direction, so the incoming card flies from the right side
  // The slide set can shrink under it (filters change the cards) — clamp rather than blank.
  $effect(() => {
    if (idx > count - 1) idx = Math.max(0, count - 1);
  });
  function go(d: number) {
    if (count < 2) return;
    dir = d;
    idx = (idx + d + count) % count;
  }
  let startX: number | null = null;
  const down = (e: PointerEvent) => (startX = e.clientX);
  function up(e: PointerEvent) {
    if (startX == null) return;
    const dx = e.clientX - startX;
    startX = null;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
  }
</script>

<!-- The wrapper takes focus so ←/→ work without tabbing to the arrows; it's a composite widget
     (carousel), hence the noninteractive-tabindex ignores — the arrows/dots stay real buttons. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="touch-pan-y rounded-md outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
  role="group"
  aria-roledescription="carousel"
  aria-label={label}
  tabindex="0"
  onpointerdown={down}
  onpointerup={up}
  onkeydown={e => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    }
  }}
>
  {#if count > 0}
    {#key idx}
      <div in:fly={{ x: dir * 48, duration: dur(160) }} aria-label="Card {idx + 1} of {count}">
        {@render slide(idx)}
      </div>
    {/key}
  {/if}
  {#if count > 1}
    <div class="mt-2 flex items-center justify-between">
      <button
        type="button"
        class="grid size-7 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Previous card"
        onclick={() => go(-1)}><ChevronLeft class="size-4" /></button
      >
      <div class="flex items-center gap-2">
        {#each Array(count) as _, i (i)}
          <button
            type="button"
            class={cn('size-2 rounded-full', i === idx ? 'bg-foreground' : 'bg-muted-foreground/40 hover:bg-muted-foreground')}
            aria-label="Go to card {i + 1} of {count}"
            aria-current={i === idx}
            onclick={() => {
              dir = i > idx ? 1 : -1;
              idx = i;
            }}
          ></button>
        {/each}
      </div>
      <button
        type="button"
        class="grid size-7 place-items-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Next card"
        onclick={() => go(1)}><ChevronRight class="size-4" /></button
      >
    </div>
  {/if}
</div>
