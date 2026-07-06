<script lang="ts">
  // Cloud-sync UNLOCK modal (F61b — docs/synced-workspaces.md "Key management"). A shared part: F63's
  // CloudStore re-prompts through this whenever a sync op needs a key and the session is locked. Once
  // per session it fetches the enrolled wrapped-IK methods (F62), lets the user pick one (passkey PRF
  // tap / passphrase / recovery key), rebuilds the matching KEK (F61a) and unwraps the account IK into
  // the vault's IN-MEMORY session — nothing is persisted. Staging-gated by its caller (Account screen).
  import { LockKeyhole, KeyRound, Fingerprint, LifeBuoy } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { vault, unlockWithPassphrase, unlockWithRecoveryKey, unlockWithPasskey } from '../lib/vault.svelte.ts';

  interface Props {
    open: boolean;
    /** fired once the IK is unlocked in memory. */
    onunlocked?: () => void;
  }
  let { open = $bindable(), onunlocked }: Props = $props();

  let passphrase = $state('');
  let recoveryKey = $state('');

  const hasPassphrase = $derived(vault.methods.some(m => m.method === 'passphrase'));
  const hasPasskey = $derived(vault.methods.some(m => m.method === 'prf'));
  const defaultTab = $derived(hasPassphrase ? 'passphrase' : hasPasskey ? 'passkey' : 'recovery');
  let tab = $state('passphrase');
  $effect(() => {
    if (open) tab = defaultTab;
  });

  async function done(ok: boolean) {
    if (ok) {
      passphrase = '';
      recoveryKey = '';
      open = false;
      onunlocked?.();
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2"><LockKeyhole class="size-4" /> Unlock cloud sync</Dialog.Title>
      <Dialog.Description
        >Unlock once per session to sync. Your key is held in memory only and cleared when you sign out or reload.</Dialog.Description
      >
    </Dialog.Header>

    <Tabs.Root bind:value={tab}>
      <Tabs.List>
        {#if hasPassphrase}<Tabs.Trigger value="passphrase">Passphrase</Tabs.Trigger>{/if}
        {#if hasPasskey}<Tabs.Trigger value="passkey">Passkey</Tabs.Trigger>{/if}
        <Tabs.Trigger value="recovery">Recovery key</Tabs.Trigger>
      </Tabs.List>

      {#if hasPassphrase}
        <Tabs.Content value="passphrase" class="flex flex-col gap-3">
          <div class="flex flex-col gap-2">
            <Label for="unlock-passphrase" class="flex items-center gap-2"><KeyRound class="size-4" /> Passphrase</Label>
            <Input
              id="unlock-passphrase"
              type="password"
              autocomplete="current-password"
              placeholder="Your cloud-sync passphrase"
              bind:value={passphrase}
            />
          </div>
          <Button
            size="sm"
            class="self-start"
            data-testid="unlock-passphrase-submit"
            disabled={vault.busy || !passphrase}
            onclick={async () => done(await unlockWithPassphrase(passphrase))}>Unlock</Button
          >
        </Tabs.Content>
      {/if}

      {#if hasPasskey}
        <Tabs.Content value="passkey" class="flex flex-col gap-3">
          <p class="flex items-center gap-2 text-sm text-muted-foreground">
            <Fingerprint class="size-4" /> Tap your PRF-capable passkey to unlock.
          </p>
          <Button size="sm" class="self-start" disabled={vault.busy} onclick={async () => done(await unlockWithPasskey())}>
            <Fingerprint class="size-4" /> Unlock with a passkey
          </Button>
        </Tabs.Content>
      {/if}

      <Tabs.Content value="recovery" class="flex flex-col gap-3">
        <div class="flex flex-col gap-2">
          <Label for="unlock-recovery" class="flex items-center gap-2"><LifeBuoy class="size-4" /> Recovery key</Label>
          <Input id="unlock-recovery" placeholder="Paste your recovery key" bind:value={recoveryKey} class="font-mono" />
        </div>
        <Button
          size="sm"
          class="self-start"
          data-testid="unlock-recovery-submit"
          disabled={vault.busy || !recoveryKey.trim()}
          onclick={async () => done(await unlockWithRecoveryKey(recoveryKey))}>Unlock</Button
        >
      </Tabs.Content>
    </Tabs.Root>

    {#if vault.error}
      <p class="text-xs text-destructive" role="alert">{vault.error}</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>
