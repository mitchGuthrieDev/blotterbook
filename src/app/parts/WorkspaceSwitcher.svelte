<script lang="ts">
  // Workspace switcher (A132, rescoped) — the user-facing UI over F59's named local workspaces.
  // STAGING ONLY (App.svelte gates it via isStaging before ever passing this into AppShell's
  // sidebarHeader slot); prod and demo are unaffected and keep the single Default/Demo workspace with
  // no switcher. Drives dash's F59 passthroughs exclusively (activeWorkspace/listWorkspaces/
  // createWorkspace/renameWorkspace/switchWorkspace/removeWorkspace) — never touches Store.local or
  // indexedDB directly (A4 seam).
  //
  // The registry + active pointer live in Store.local (sync localStorage, F59) but aren't themselves
  // reactive Svelte state, so this component keeps a local $state snapshot and re-reads it after every
  // mount + mutation (refresh()) rather than deriving from a rune the store doesn't expose.
  //
  // The "Local only · Sync coming soon" row is an INERT placeholder for the future cloud tier
  // (F60–F63, see docs/synced-workspaces.md) — no network, no real status; just a stubbed affordance
  // so the switcher's shape doesn't change again once sync lands.
  import { Layers, ChevronsUpDown, Check, Plus, Pencil, Trash2, CloudOff } from '@lucide/svelte';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import IconTip from '$lib/components/IconTip.svelte';
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
  }
  refresh();

  async function pick(id: string) {
    if (active && id === active.id) return;
    await dash.switchWorkspace(id);
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

<DropdownMenu.Root>
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
    <DropdownMenu.Separator />
    <DropdownMenu.Item onSelect={openCreate}><Plus class="size-4" /> New workspace…</DropdownMenu.Item>
    <DropdownMenu.Item onSelect={openRename}><Pencil class="size-4" /> Rename…</DropdownMenu.Item>
    <DropdownMenu.Item disabled={workspaces.length <= 1} class="text-destructive" onSelect={openDelete}>
      <Trash2 class="size-4" /> Delete…
    </DropdownMenu.Item>
    <DropdownMenu.Separator />
    <!-- F63 will replace this stub with real synced / last-pull / offline state per workspace. -->
    <div class="flex items-center gap-1.5 px-2 py-1.5 text-xs text-muted-foreground">
      <CloudOff class="size-3.5 shrink-0" />
      Local only · Sync coming soon
    </div>
  </DropdownMenu.Content>
</DropdownMenu.Root>

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
