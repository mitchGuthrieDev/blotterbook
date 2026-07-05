<script lang="ts">
  // F47: the per-file detection-status list — one row per file in a batch ('Detecting data…' while
  // the batch runs), plus the capability relay (what the imported mix unlocks or limits). Rendered
  // by the Onboarding review step and the CSV Library screen.
  import type { BatchRow } from '../lib/batch.ts';

  let {
    rows = [],
    busy = false,
    capability = [],
    title = 'Detecting data…',
  }: {
    rows?: BatchRow[];
    busy?: boolean;
    /** Capability-relay lines (A176 model) — e.g. 'No fills-type export detected: …'. */
    capability?: string[];
    title?: string;
  } = $props();
</script>

{#if rows.length || busy}
  <div class="rounded-md border border-border bg-background p-3" role="status" aria-live="polite">
    <p class="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {busy ? title : 'Detected data'}
    </p>
    <ul class="space-y-1">
      {#each rows as r, i (i)}
        <li
          class={[
            'flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs',
            r.state === 'ok' && 'border-chart-2/30 bg-chart-2/10',
            r.state === 'nontrade' && 'border-border bg-secondary/40',
            r.state === 'refused' && 'border-destructive/30 bg-destructive/10',
          ]}
        >
          <span
            class={r.state === 'ok' ? 'text-chart-2' : r.state === 'nontrade' ? 'text-muted-foreground' : 'text-destructive'}
            aria-hidden="true">{r.state === 'ok' ? '✓' : r.state === 'nontrade' ? '·' : '✗'}</span
          >
          <span class="min-w-0 truncate font-medium text-foreground">{r.name}</span>
          <span class="ml-auto whitespace-nowrap text-muted-foreground">
            {#if r.label && r.detail}{r.label} · {r.detail}{:else}{r.label || r.detail}{/if}
          </span>
        </li>
      {/each}
      {#if busy}
        <li class="px-3 py-1.5 text-xs text-muted-foreground">Working…</li>
      {/if}
    </ul>
    {#if capability.length && !busy}
      <div class="mt-2 space-y-1 border-t border-border pt-2">
        {#each capability as line, i (i)}
          <p class="text-[11px] text-muted-foreground">{line}</p>
        {/each}
      </div>
    {/if}
  </div>
{/if}
