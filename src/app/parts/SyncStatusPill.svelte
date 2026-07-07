<script lang="ts">
  // A279: the shared cloud-sync PARITY pill — one source of truth for the ACTIVE workspace's sync
  // state, rendered in both the WorkspaceSwitcher row and the Account cloud-sync card. It reads the
  // reactive cloudSync rune via syncPillState() (off / needs-unlock / offline / syncing / pending /
  // synced / error), so it re-settles automatically; no props beyond an optional icon-only mode for
  // the collapsed sidebar rail. Tier gating ('cloud tier required' / subscribe) is decided by the
  // caller BEFORE the pill is shown.
  import { Cloud, CloudOff, RefreshCw, LockKeyhole, CloudUpload, TriangleAlert } from '@lucide/svelte';
  import { cloudSync, syncPillState } from '../lib/cloudsync.svelte.ts';

  let { iconOnly = false }: { iconOnly?: boolean } = $props();

  const state = $derived(syncPillState());

  const fmtAgo = (ms: number) => {
    if (!ms) return '';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
  };

  const label = $derived.by(() => {
    switch (state) {
      case 'syncing':
        return 'Syncing…';
      case 'pending':
        return 'Pending upload';
      case 'needs-unlock':
        return 'Needs unlock';
      case 'offline':
        return 'Offline — will sync later';
      case 'error':
        return cloudSync.error || 'Sync error';
      case 'synced':
        return cloudSync.lastPull ? `In sync · ${fmtAgo(cloudSync.lastPull)}` : 'In sync';
      default:
        return 'Not synced';
    }
  });

  const tone = $derived.by(() => {
    switch (state) {
      case 'synced':
        return 'text-chart-2';
      case 'pending':
      case 'needs-unlock':
        return 'text-chart-4';
      case 'error':
        return 'text-destructive';
      default:
        return 'text-muted-foreground';
    }
  });
</script>

<span
  class={['inline-flex min-w-0 items-center gap-1.5 text-xs font-medium', tone]}
  data-testid="sync-state"
  data-status={state}
  title={label}
>
  {#if state === 'syncing'}
    <RefreshCw class="size-3.5 shrink-0 animate-spin" />
  {:else if state === 'synced'}
    <Cloud class="size-3.5 shrink-0" />
  {:else if state === 'pending'}
    <CloudUpload class="size-3.5 shrink-0" />
  {:else if state === 'needs-unlock'}
    <LockKeyhole class="size-3.5 shrink-0" />
  {:else if state === 'error'}
    <TriangleAlert class="size-3.5 shrink-0" />
  {:else}
    <CloudOff class="size-3.5 shrink-0" />
  {/if}
  {#if !iconOnly}<span class="min-w-0 truncate">{label}</span>{/if}
</span>
