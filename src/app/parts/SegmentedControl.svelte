<script lang="ts">
  // Shared segmented toggle (the Dashboard scope + Calendar view pill groups) — ONE definition of
  // the bordered segment row, so the two screens can't drift (A157; was a duplicated `seg` snippet).
  let {
    segments,
    value,
    onselect,
  }: {
    segments: { key: string; label: string }[];
    value: string;
    onselect: (key: string) => void;
  } = $props();
</script>

<div class="flex items-center gap-0.5 rounded-md border border-border p-0.5">
  {#each segments as s (s.key)}
    <button
      type="button"
      onclick={() => onselect(s.key)}
      class={[
        'rounded px-2.5 py-1 text-xs transition-colors',
        value === s.key ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
      ]}
    >
      {s.label}
    </button>
  {/each}
</div>
