<script lang="ts">
  // First-run onboarding for a fresh /app user (real Store, no seed, zero trades) — parity with the
  // legacy A32 Landing: set the cost model up (broker/feed/state/platform), import CSVs, review, and
  // launch. F47: intake is a BATCH — drop/pick multiple files at once; each lands a detection-status
  // row (imported ✓ / recognized-non-trade · / refused ✗) and the capability relay states what the
  // mix unlocks. F48: the app only launches via the explicit button once ≥1 file imported.
  import { Upload } from '@lucide/svelte';
  import { Button } from '$lib/components/ui/button';
  import type { AppSetup } from '../../lib/core/types.ts';
  import type { BatchRow } from '../lib/batch.ts';
  import CostSetup from './CostSetup.svelte';
  import DetectionStatus from './DetectionStatus.svelte';

  let {
    setup,
    onsetupsave,
    onbatch,
    capability = [],
    onlaunch,
  }: {
    setup: AppSetup;
    onsetupsave: (s: AppSetup) => void;
    /** F47: import a batch of files (gates + parse + import per file) → one status row each. */
    onbatch: (files: File[]) => Promise<BatchRow[]>;
    /** F47 capability relay — what the imported mix unlocks/limits (dataset-level, from the app). */
    capability?: string[];
    /** F48: enter the app (enabled once at least one file imported). */
    onlaunch?: () => void;
  } = $props();

  let busy = $state(false);
  let dragging = $state(false);
  let rows = $state<BatchRow[]>([]);
  let fileInput = $state<HTMLInputElement | null>(null);
  const anyImported = $derived(rows.some(r => r.state === 'ok'));

  async function handle(files: FileList | File[] | null | undefined) {
    const list = files ? [...files] : [];
    if (!list.length || busy) return;
    busy = true;
    rows = [...rows, ...(await onbatch(list))];
    busy = false;
  }
  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    void handle(e.dataTransfer?.files);
  }
  // A147: open the picker programmatically. The CTA used to be a <Button> nested inside the
  // <label> wrapping the input — per the HTML spec a label does NOT forward activation to its
  // control when the click targets an interactive descendant, so the primary import CTA was dead.
  const pickFile = () => fileInput?.click();
</script>

<div class="mx-auto max-w-2xl py-8">
  <h2 class="text-lg font-semibold text-foreground">Welcome to Blotterbook</h2>
  <p class="mt-1 text-sm text-muted-foreground">
    Your trades are parsed and stored entirely in this browser — nothing is uploaded. Set up your cost model, then import your platform
    exports to get started.
  </p>

  <div class="mt-6">
    <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">1 · Cost model</h3>
    <CostSetup {setup} onsave={onsetupsave} />
  </div>

  <div class="mt-6">
    <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">2 · Import your CSVs</h3>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      role="button"
      tabindex="0"
      aria-label="Import CSV files"
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
      <p class="text-sm text-muted-foreground">Drag exports here (several at once is fine — CSVs, or ATAS .xlsx), or</p>
      <input
        bind:this={fileInput}
        type="file"
        multiple
        accept=".csv,.txt,.tsv,.xlsx,text/csv,text/plain"
        class="sr-only"
        onchange={e => handle((e.currentTarget as HTMLInputElement).files)}
      />
      <Button variant="secondary" size="sm" disabled={busy} onclick={pickFile}>{busy ? 'Importing…' : 'Choose CSV files'}</Button>
    </div>
    <p class="mt-2 text-[11px] text-muted-foreground">
      Supports TradingView, Tradovate / NinjaTrader, Quantower and other platform exports — mix platforms and export types freely;
      overlapping trades merge. Not sure how to export? See the How-To guide.
    </p>
  </div>

  <!-- F47/F48: the review step — per-file detection status + the capability relay, then launch. -->
  <div class="mt-6">
    <h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">3 · Review &amp; launch</h3>
    {#if rows.length || busy}
      <div class="mb-3">
        <DetectionStatus {rows} {busy} capability={anyImported ? capability : []} />
      </div>
    {:else}
      <p class="mb-3 text-xs text-muted-foreground">Import at least one CSV above and the detected data will show up here.</p>
    {/if}
    <Button disabled={!anyImported || busy} onclick={() => onlaunch?.()}>Launch Blotterbook &rarr;</Button>
  </div>
</div>
