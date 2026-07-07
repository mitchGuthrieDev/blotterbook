<script lang="ts">
  // Workspace switcher (A132, rescoped) — the user-facing UI over F59's named local workspaces.
  // PROD + STAGING (NOT demo): App.svelte passes this into AppShell's sidebarHeader slot for every
  // non-demo surface; demo can't do multiple workspaces (in-memory DemoStore), so it keeps the single
  // Demo workspace with no switcher. Drives dash's F59 passthroughs exclusively (activeWorkspace/listWorkspaces/
  // createWorkspace/renameWorkspace/switchWorkspace/removeWorkspace) — never touches Store.local or
  // indexedDB directly (A4 seam).
  //
  // The registry + active pointer live in Store.local (sync localStorage, F59) but aren't themselves
  // reactive Svelte state, so this component keeps a local $state snapshot and re-reads it after every
  // mount + mutation (refresh()) rather than deriving from a rune the store doesn't expose.
  //
  // The per-workspace SYNC STATUS row (F63) replaces the old "Sync coming soon" stub: it shows the
  // active workspace's real state — not-synced / synced (last pull) / syncing / offline / locked /
  // error — plus an "Enable sync" action (cloud tier + unlocked only; local tier shows an inert
  // "cloud tier required" hint). PROD + STAGING (not demo), like the rest of the switcher.
  import { Layers, ChevronsUpDown, Check, Plus, Pencil, Trash2, CloudOff, Cloud, LockKeyhole, TriangleAlert } from '@lucide/svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import IconTip from '$lib/components/IconTip.svelte';
  import UnlockModal from './UnlockModal.svelte';
  import SyncStatusPill from './SyncStatusPill.svelte';
  import {
    cloudSync,
    enableCloudSync,
    syncActiveWorkspace,
    onSyncUnlocked,
    refreshSyncStatus,
    listCloudWorkspaces,
    adoptCloudWorkspace,
    type CloudWorkspace,
  } from '../lib/cloudsync.svelte.ts';
  import { refreshVault } from '../lib/vault.svelte.ts';
  import { subscribe } from '../lib/account.svelte.ts';
  import type { Dashboard } from '../lib/dashboard.svelte.ts';
  import type { Workspace } from '../../lib/core/types.ts';

  let {
    dash,
    /** Icon-only compact form, for the desktop icon rail — matches SidebarNav's own `collapsed`. */
    collapsed = false,
  }: { dash: Dashboard; collapsed?: boolean } = $props();

  let workspaces = $state<Workspace[]>([]);
  let active = $state<Workspace | null>(null);
  function refresh() {
    workspaces = dash.listWorkspaces();
    active = dash.activeWorkspace();
    refreshSyncStatus(); // F63: re-settle the active workspace's cloud-sync status
  }
  refresh();

  async function pick(id: string) {
    if (active && id === active.id) return;
    await dash.switchWorkspace(id);
    refresh();
  }

  // ---- F63 cloud sync (active workspace) ----
  let unlockOpen = $state(false);
  async function openUnlock() {
    await refreshVault(); // populate the enrolled unlock methods before the modal renders its tabs
    unlockOpen = true;
  }
  async function doEnable() {
    const ok = await enableCloudSync();
    if (!ok && cloudSync.status === 'locked') await openUnlock();
    refresh();
  }

  // ---- create ----
  let createOpen = $state(false);
  let createName = $state('');
  function openCreate() {
    createName = '';
    createOpen = true;
  }
  async function doCreate() {
    const name = createName.trim();
    if (!name) return;
    const ws = dash.createWorkspace(name);
    await dash.switchWorkspace(ws.id);
    refresh();
    createOpen = false;
  }

  // ---- rename (the active workspace) ----
  let renameOpen = $state(false);
  let renameName = $state('');
  function openRename() {
    renameName = active?.name ?? '';
    renameOpen = true;
  }
  function doRename() {
    const name = renameName.trim();
    if (!name || !active) return;
    dash.renameWorkspace(active.id, name);
    refresh();
    renameOpen = false;
  }

  // ---- A298: adopt a workspace that's synced in the cloud but not on THIS device ----
  let cloudOnly = $state<CloudWorkspace[]>([]);
  let adopting = $state('');
  async function refreshCloud() {
    // Only meaningful for a cloud-tier, unlocked account; otherwise there's nothing to adopt.
    cloudOnly = cloudSync.tier === 'cloud' && cloudSync.unlocked ? await listCloudWorkspaces() : [];
  }
  async function adopt(w: CloudWorkspace) {
    if (adopting) return;
    adopting = w.id;
    try {
      if (!adoptCloudWorkspace(w)) return;
      await dash.switchWorkspace(w.id); // A251 barrier + reload onto the adopted dataset
      refresh();
      await refreshCloud();
    } finally {
      adopting = '';
    }
  }

  // ---- delete (the active workspace); the store refuses the last remaining one ----
  let deleteOpen = $state(false);
  let deleteError = $state('');
  function openDelete() {
    deleteError = '';
    deleteOpen = true;
  }
  async function doDelete() {
    if (!active) return;
    try {
      await dash.removeWorkspace(active.id);
      refresh();
      deleteOpen = false;
    } catch (e) {
      // Belt-and-suspenders: the menu already disables Delete at one workspace, but surface the
      // store's own refusal gracefully if it's ever reached some other way.
      deleteError = e instanceof Error ? e.message : 'Could not delete this workspace.';
    }
  }
</script>

<DropdownMenu.Root onOpenChange={o => o && void refreshCloud()}>
  {#if collapsed}
    <!-- Icon-only trigger (desktop icon rail) — ambiguous without a label, so wrap it in a tooltip
         naming the active workspace (IconTip convention for icon-only controls). -->
    <IconTip label={active?.name ?? 'Workspace'} side="right">
      {#snippet button(tip)}
        <DropdownMenu.Trigger {...tip}>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class="grid size-9 w-full place-items-center rounded-md text-foreground hover:bg-accent"
              aria-label="Switch workspace: {active?.name ?? ''}"
            >
              <Layers class="size-4" />
            </button>
          {/snippet}
        </DropdownMenu.Trigger>
      {/snippet}
    </IconTip>
  {:else}
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          class="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
          aria-label="Switch workspace: {active?.name ?? ''}"
        >
          <Layers class="size-4 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate text-left">{active?.name ?? 'Workspace'}</span>
          <ChevronsUpDown class="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      {/snippet}
    </DropdownMenu.Trigger>
  {/if}
  <DropdownMenu.Content align="start" class="w-64">
    <!-- bits-ui v2: a Label (GroupHeading) MUST be inside a Group, or the Content subtree throws
         "Context Menu.Group not found" at render and no items mount. -->
    <DropdownMenu.Group>
      <DropdownMenu.Label>Workspaces</DropdownMenu.Label>
      {#each workspaces as w (w.id)}
        <DropdownMenu.Item onSelect={() => pick(w.id)}>
          <Check class={['size-4', w.id === active?.id ? 'opacity-100' : 'opacity-0']} />
          <span class="min-w-0 flex-1 truncate">{w.name}</span>
        </DropdownMenu.Item>
      {/each}
    </DropdownMenu.Group>
    {#if cloudOnly.length}
      <!-- A298: workspaces synced in your cloud but not yet on THIS device. Adopt one → it's created
           locally with the SERVER's id + DEK, so it reconciles the same dataset (not a divergent copy). -->
      <DropdownMenu.Separator />
      <DropdownMenu.Group>
        <DropdownMenu.Label>Available in your cloud</DropdownMenu.Label>
        {#each cloudOnly as w (w.id)}
          <div class="flex items-center gap-2 px-2 py-1.5 text-sm" data-testid="cloud-adopt-row">
            <Cloud class="size-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate">{w.name}</span>
            <button
              type="button"
              class="shrink-0 text-xs font-medium text-foreground hover:underline disabled:opacity-50"
              data-testid="cloud-adopt"
              disabled={!!adopting}
              onclick={() => void adopt(w)}
            >
              {adopting === w.id ? 'Adding…' : 'Add to this device'}
            </button>
          </div>
        {/each}
      </DropdownMenu.Group>
    {/if}
    <DropdownMenu.Separator />
    <DropdownMenu.Item onSelect={openCreate}><Plus class="size-4" /> New workspace…</DropdownMenu.Item>
    <DropdownMenu.Item onSelect={openRename}><Pencil class="size-4" /> Rename…</DropdownMenu.Item>
    <DropdownMenu.Item disabled={workspaces.length <= 1} class="text-destructive" onSelect={openDelete}>
      <Trash2 class="size-4" /> Delete…
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <!-- A279: cloud-sync PARITY row (prod + staging, not demo) — a status pill + a clear "Sync now"
         instead of the old lock/unlock framing. Direction controls (Pull/Push/Pause) + the
         passkey-vs-passphrase explainer live on the Account screen's cloud-sync card. -->
    <div class="flex flex-col gap-1.5 px-2 py-1.5" data-testid="sync-status">
      {#if !cloudSync.enabled}
        {#if cloudSync.tier === ''}
          <!-- A306: neutral while /api/me is still probing — don't mislabel a paying user "cloud tier required". -->
          <div class="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="sync-checking">
            <Cloud class="size-3.5 shrink-0" /> Checking subscription…
          </div>
        {:else if cloudSync.tier !== 'cloud'}
          <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CloudOff class="size-3.5 shrink-0" /> Local only · cloud tier required
          </div>
        {:else if cloudSync.serverGone}
          <!-- A309(b): the server copy was removed elsewhere — explain + offer re-enable. -->
          <div class="flex items-start gap-1.5 text-xs text-chart-4" data-testid="sync-server-gone">
            <TriangleAlert class="mt-0.5 size-3.5 shrink-0" /><span class="min-w-0">{cloudSync.error || 'Cloud copy removed.'}</span>
          </div>
          <button
            type="button"
            data-testid="sync-reenable"
            class="self-start text-xs font-medium text-foreground hover:underline"
            disabled={cloudSync.busy}
            onclick={doEnable}>Re-enable sync</button
          >
        {:else if !cloudSync.unlocked}
          <button
            type="button"
            data-testid="sync-unlock"
            class="flex items-center gap-1.5 text-xs font-medium text-foreground hover:underline"
            onclick={openUnlock}
          >
            <LockKeyhole class="size-3.5 shrink-0" /> Unlock to {cloudSync.paused ? 'resume' : 'enable'} sync
          </button>
        {:else}
          <!-- A306: paused ≠ never-synced — offer Resume. -->
          <button
            type="button"
            data-testid={cloudSync.paused ? 'sync-resume' : 'sync-enable'}
            class="flex items-center gap-1.5 text-xs font-medium text-foreground hover:underline"
            disabled={cloudSync.busy}
            onclick={doEnable}
          >
            <Cloud class="size-3.5 shrink-0" />
            {cloudSync.busy ? (cloudSync.paused ? 'Resuming…' : 'Enabling…') : cloudSync.paused ? 'Resume sync' : 'Enable sync'}
          </button>
        {/if}
      {:else}
        <SyncStatusPill />
        {#if cloudSync.needsSub}
          <!-- A306: lapsed subscription on an enabled workspace — RENEW, not the first-time Subscribe CTA. -->
          <button
            type="button"
            data-testid="sync-renew"
            class="self-start text-xs font-medium text-chart-4 hover:underline"
            onclick={() => void subscribe()}>Renew subscription</button
          >
        {:else if !cloudSync.unlocked}
          <button
            type="button"
            data-testid="sync-unlock"
            class="self-start text-xs font-medium text-chart-4 hover:underline"
            onclick={openUnlock}>Unlock to sync</button
          >
        {:else if cloudSync.status !== 'syncing'}
          <button
            type="button"
            data-testid="sync-now"
            class="self-start text-xs font-medium text-foreground hover:underline"
            onclick={() => void syncActiveWorkspace({ full: true })}>Sync now</button
          >
        {/if}
      {/if}
    </div>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<UnlockModal
  bind:open={unlockOpen}
  onunlocked={() => {
    onSyncUnlocked();
    refresh();
  }}
/>

<Dialog.Root bind:open={createOpen}>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header>
      <Dialog.Title>New workspace</Dialog.Title>
      <Dialog.Description>A separate local dataset with its own trades, journal, and setup.</Dialog.Description>
    </Dialog.Header>
    <Input bind:value={createName} placeholder="Workspace name" onkeydown={e => e.key === 'Enter' && doCreate()} />
    <Dialog.Footer>
      <Button variant="ghost" size="sm" onclick={() => (createOpen = false)}>Cancel</Button>
      <Button size="sm" disabled={!createName.trim()} onclick={doCreate}>Create</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={renameOpen}>
  <Dialog.Content class="sm:max-w-sm">
    <Dialog.Header>
      <Dialog.Title>Rename workspace</Dialog.Title>
      <Dialog.Description>Renames "{active?.name}" — the data itself is unaffected.</Dialog.Description>
    </Dialog.Header>
    <Input bind:value={renameName} placeholder="Workspace name" onkeydown={e => e.key === 'Enter' && doRename()} />
    <Dialog.Footer>
      <Button variant="ghost" size="sm" onclick={() => (renameOpen = false)}>Cancel</Button>
      <Button size="sm" disabled={!renameName.trim()} onclick={doRename}>Save</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={deleteOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete "{active?.name}"?</AlertDialog.Title>
      <AlertDialog.Description>
        This permanently removes this workspace's local database — every trade, journal entry, and setting in it. This can't be undone.
        {#if deleteError}
          <span class="mt-2 block font-medium text-destructive">{deleteError}</span>
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action class="bg-destructive text-white hover:bg-destructive/90" onclick={doDelete}>Delete</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
