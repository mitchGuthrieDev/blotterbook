<script lang="ts">
  // First-run onboarding for a fresh /app user (real Store, no seed, zero trades) — parity with the
  // legacy A32 Landing: set the cost model up (broker/feed/state/platform) and import a CSV to begin.
  // Renders inside the AppShell content column; once the import lands, the normal dashboard takes over.
  import { Upload } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import { checkCsvFile } from '../../lib/core/intake.ts';
  import type { AppSetup } from '../../lib/core/types.ts';
  import CostSetup from './CostSetup.svelte';

  let {
    setup,
    onsetupsave,
    onimport,
  }: {
    setup: AppSetup;
    onsetupsave: (s: AppSetup) => void;
    /** Parse + import a CSV; resolves to an error string ('' on success). */
    onimport: (file: File) => Promise<string>;
  } = $props();

  let busy = $state(false);
  let err = $state('');
  let dragging = $state(false);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function handle(file: File | undefined) {
    if (!file || busy) return;
    // A177: pre-read gate (extension/MIME allowlist + size cap) before the file is read at all;
    // the post-read binary/row checks run inside Adapters.parse.
    const veto = checkCsvFile(file);
    if (veto) {
      err = veto;
      return;
    }
    busy = true;
    err = '';
    err = await onimport(file);
    busy = false;
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    void handle(e.dataTransfer?.files?.[0]);
  }
  // A147: open the picker programmatically. The CTA used to be a <Button> nested inside the
  // <label> wrapping the input — per the HTML spec a label does NOT forward activation to its
  // control when the click targets an interactive descendant, so the primary import CTA was dead.
  const pickFile = () => fileInput?.click();
</script>

<div class="mx-auto max-w-2xl py-8">
  <h2 class="text-lg font-semibold text-foreground">Welcome to Blotterbook</h2>
  <p class="mt-1 text-sm text-muted-foreground">
    Your trades are parsed and stored entirely in this browser — nothing is uploaded. Set up your cost model, then import a balance-history
    CSV to get started.
  </p>

  <div class="mt-6">
    <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">1 · Cost model</h3>
    <CostSetup {setup} onsave={onsetupsave} />
  </div>

  <div class="mt-6">
    <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">2 · Import a CSV</h3>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      role="button"
      tabindex="0"
      aria-label="Import a CSV file"
      class={[
        'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-center transition-colors',
        dragging ? 'border-primary bg-accent' : 'border-border',
      ]}
      ondragover={e => {
        e.preventDefault();
        dragging = true;
      }}
      ondragleave={() => (dragging = false)}
      ondrop={onDrop}
      onkeydown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          pickFile();
        }
      }}
    >
      <Upload class="size-6 text-muted-foreground" />
      <p class="text-sm text-muted-foreground">Drag a CSV here, or</p>
      <input
        bind:this={fileInput}
        type="file"
        accept=".csv,.txt,.tsv,text/csv,text/plain"
        class="sr-only"
        onchange={e => handle((e.currentTarget as HTMLInputElement).files?.[0])}
      />
      <Button variant="secondary" size="sm" disabled={busy} onclick={pickFile}>{busy ? 'Importing…' : 'Choose a CSV file'}</Button>
      {#if err}<p class="text-xs text-destructive" role="alert">{err}</p>{/if}
    </div>
    <p class="mt-2 text-[11px] text-muted-foreground">
      Supports TradingView and other platform exports. Not sure how to export? See the How-To guide.
    </p>
  </div>
</div>
