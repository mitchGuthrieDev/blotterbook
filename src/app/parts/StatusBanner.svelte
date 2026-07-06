<script lang="ts">
  // Status banners (CH16 redesign chrome). Renders up to two individually-dismissible banners at the
  // top of a surface:
  //   • maintenance   — admin-toggled "Scheduled maintenance…" info notice (from loadFlags in App).
  //   • importWarning — the "$1/point P&L estimate" data-quality warning (from the CSV import path).
  // Parity with the legacy .maintbanner / .warnbanner in App.svelte. Each is dismissible via a local
  // $state flag + an × button; Tailwind utilities only (CSP — no inline style).
  import { cn } from '$lib/utils';
  import { Button } from '$lib/components/ui/button';
  import { X, AlertTriangle, Wrench } from '@lucide/svelte';

  let { maintenance = false, importWarning = '' }: { maintenance?: boolean; importWarning?: string } = $props();

  let maintDismissed = $state(false);
  let warnDismissed = $state(false);

  const showMaint = $derived(maintenance && !maintDismissed);
  const showWarn = $derived(!!importWarning && !warnDismissed);
</script>

{#if showMaint}
  <!-- Admin-toggled maintenance notice. Compute stays local, so this is informational only. -->
  <div
    class="mb-3 flex items-start gap-2.5 rounded-md border border-border bg-secondary px-3 py-2 text-[13px] text-secondary-foreground"
    role="status"
  >
    <Wrench class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    <span class="flex-1 leading-[1.5]">Scheduled maintenance is in progress — your local data is unaffected.</span>
    <Button
      variant="ghost"
      size="icon"
      class="relative size-6 shrink-0 text-muted-foreground hover:text-foreground pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']"
      aria-label="Dismiss maintenance notice"
      onclick={() => (maintDismissed = true)}
    >
      <X class="size-4" />
    </Button>
  </div>
{/if}

{#if showWarn}
  <!-- P&L estimated at $1/point for an unknown contract — warn the user, don't drop their data. -->
  <div
    class={cn('mb-3 flex items-start gap-2.5 rounded-md border border-chart-4 bg-card px-3 py-2 text-[13px] text-foreground')}
    role="alert"
  >
    <AlertTriangle class="mt-0.5 size-4 shrink-0 text-chart-4" />
    <span class="flex-1 leading-[1.5]">{importWarning}</span>
    <Button
      variant="ghost"
      size="icon"
      class="relative size-6 shrink-0 text-muted-foreground hover:text-foreground pointer-coarse:before:absolute pointer-coarse:before:-inset-2 pointer-coarse:before:content-['']"
      aria-label="Dismiss warning"
      onclick={() => (warnDismissed = true)}
    >
      <X class="size-4" />
    </Button>
  </div>
{/if}
