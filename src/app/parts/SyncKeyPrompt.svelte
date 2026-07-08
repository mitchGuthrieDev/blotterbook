<script lang="ts">
  // The inline sync-key prompt (A336 — ex UnlockModal, F61b; docs/synced-workspaces.md "Key
  // management"). Never a standalone destination: a sync action that needs the E2E key opens this
  // as a STEP of that action ("Enter your sync passphrase to turn on sync"), and success continues
  // the action via `onready`. It fetches the enrolled wrapped-IK methods (F62), lets the user
  // continue with whichever they have (passphrase / passkey PRF tap / recovery key), rebuilds the
  // matching KEK (F61a) and unwraps the account IK into the vault's IN-MEMORY session — nothing is
  // persisted, and no lock/unlock vocabulary reaches the user (the vault is an implementation
  // detail; users think in terms of sync being on or off).
  import { KeyRound, Fingerprint, LifeBuoy } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as Tabs from '$lib/components/ui/tabs';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { vault, unlockWithPassphrase, unlockWithRecoveryKey, unlockWithPasskey } from '../lib/vault.svelte.ts';

  interface Props {
    open: boolean;
    /** What the user is trying to do — rendered as "Enter your sync passphrase to {reason}." */
    reason?: string;
    /** Fired once the key is available in memory — the caller continues its action here. */
    onready?: () => void;
  }
  let { open = $bindable(), reason = '', onready }: Props = $props();

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
      onready?.();
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-md">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2"><KeyRound class="size-4" /> Enter your sync passphrase</Dialog.Title>
      <Dialog.Description>
        {reason ? `Enter your sync passphrase to ${reason}.` : 'Enter your sync passphrase to continue.'} It's separate from the passkey that
        signs you in, is held in memory only, and clears when you sign out or reload.
      </Dialog.Description>
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
            <Label for="sync-key-passphrase" class="flex items-center gap-2"><KeyRound class="size-4" /> Passphrase</Label>
            <Input
              id="sync-key-passphrase"
              type="password"
              autocomplete="current-password"
              placeholder="Your cloud-sync passphrase"
              bind:value={passphrase}
            />
          </div>
          <Button
            size="sm"
            class="self-start"
            data-testid="sync-key-passphrase-submit"
            disabled={vault.busy || !passphrase}
            onclick={async () => done(await unlockWithPassphrase(passphrase))}>Continue</Button
          >
        </Tabs.Content>
      {/if}

      {#if hasPasskey}
        <Tabs.Content value="passkey" class="flex flex-col gap-3">
          <p class="flex items-center gap-2 text-sm text-muted-foreground">
            <Fingerprint class="size-4" /> Tap your PRF-capable passkey to continue.
          </p>
          <Button
            size="sm"
            class="self-start"
            data-testid="sync-key-passkey-submit"
            disabled={vault.busy}
            onclick={async () => done(await unlockWithPasskey())}
          >
            <Fingerprint class="size-4" /> Use passkey
          </Button>
        </Tabs.Content>
      {/if}

      <Tabs.Content value="recovery" class="flex flex-col gap-3">
        <div class="flex flex-col gap-2">
          <Label for="sync-key-recovery" class="flex items-center gap-2"><LifeBuoy class="size-4" /> Recovery key</Label>
          <Input id="sync-key-recovery" placeholder="Paste your recovery key" bind:value={recoveryKey} class="font-mono" />
        </div>
        <Button
          size="sm"
          class="self-start"
          data-testid="sync-key-recovery-submit"
          disabled={vault.busy || !recoveryKey.trim()}
          onclick={async () => done(await unlockWithRecoveryKey(recoveryKey))}>Continue</Button
        >
      </Tabs.Content>
    </Tabs.Root>

    {#if vault.error}
      <p class="text-xs text-destructive" role="alert">{vault.error}</p>
    {/if}
  </Dialog.Content>
</Dialog.Root>
