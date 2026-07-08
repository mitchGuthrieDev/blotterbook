<script lang="ts">
  // Cloud-sync SETUP flow (F61b — docs/synced-workspaces.md "Key management"). Prod + staging (not
  // demo); mounted from the Account screen for any logged-in user. Generates the account IK + the ONE escrow recovery
  // key (F61a crypto core, lazily imported by vault.svelte.ts), renders the recovery key ONCE for the
  // user to DOWNLOAD/copy with an unmissable warning, and REQUIRES an explicit "I've saved my recovery
  // key" confirmation before finishing. Optionally sets a passphrase (Argon2id KEK). The recovery key
  // bytes live only in the vault's transient memory and are dropped the moment setup finishes — no key
  // is ever persisted (see the vault module's SECURITY INVARIANT).
  import { ShieldCheck, TriangleAlert, Download, Copy, Check, KeyRound } from '@lucide/svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { beginSetup, finishSetup, cancelSetup, vault, passphraseStrong, MIN_PASSPHRASE } from '../lib/vault.svelte.ts';
  import { downloadBlob } from '../lib/files.ts';

  interface Props {
    open: boolean;
    /** fired after setup completes (IK now in memory) so the parent can refresh its view. */
    ondone?: () => void;
  }
  let { open = $bindable(), ondone }: Props = $props();

  let step = $state<'intro' | 'reveal'>('intro');
  let recoveryKey = $state(''); // base64 — shown ONCE, never persisted
  let saved = $state(false); // "I've saved my recovery key" confirmation
  let usePassphrase = $state(false);
  let passphrase = $state('');
  let copied = $state(false);

  function reset() {
    step = 'intro';
    recoveryKey = '';
    saved = false;
    usePassphrase = false;
    passphrase = '';
    copied = false;
  }

  // Closing the dialog at any point abandons a pending setup (zeroes the transient recovery bytes).
  $effect(() => {
    if (!open) {
      cancelSetup();
      reset();
    }
  });

  async function onGenerate() {
    const key = await beginSetup();
    if (key) {
      recoveryKey = key;
      step = 'reveal';
    }
  }

  function recoveryFileText(): string {
    return [
      'Blotterbook — cloud-sync recovery key',
      `Generated ${new Date().toISOString()}`,
      '',
      'KEEP THIS SAFE AND PRIVATE. It is the guaranteed way to recover your',
      'cloud-synced data. If you lose every passkey AND your passphrase AND this',
      'key, your cloud data cannot be recovered — Blotterbook never sees this key',
      'and cannot recover it for you. (Your local copy in this browser always remains.)',
      '',
      recoveryKey,
      '',
    ].join('\n');
  }

  function onDownload() {
    downloadBlob('blotterbook-recovery-key.txt', new Blob([recoveryFileText()], { type: 'text/plain' }));
  }

  async function onCopy() {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch (_) {
      /* clipboard blocked — the download path still works */
    }
  }

  async function onFinish() {
    if (!saved || vault.busy) return;
    const ok = await finishSetup({ passphrase: usePassphrase ? passphrase : undefined });
    if (ok) {
      open = false;
      ondone?.();
    }
  }

  const canFinish = $derived(saved && !vault.busy && (!usePassphrase || passphraseStrong(passphrase)));
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2"><ShieldCheck class="size-4" /> Set up cloud sync</Dialog.Title>
      <Dialog.Description>
        End-to-end encrypted. Your trades are encrypted in this browser with a key we never see — the server only ever stores ciphertext it
        cannot read.
      </Dialog.Description>
    </Dialog.Header>

    {#if step === 'intro'}
      <div class="flex flex-col gap-4">
        <p class="text-sm text-muted-foreground">
          We'll generate a one-time <strong class="text-foreground">recovery key</strong> for your account. It's the guaranteed way back into
          your encrypted data, so you'll download and keep it before we finish.
        </p>
        <Button data-testid="cloud-generate" disabled={vault.busy} onclick={onGenerate}>
          <KeyRound class="size-4" />
          Generate my recovery key
        </Button>
      </div>
    {:else}
      <div class="flex flex-col gap-4">
        <div class="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive" role="alert">
          <TriangleAlert class="mt-0.5 size-4 shrink-0" />
          <p class="text-xs leading-relaxed">
            Save this now — it is shown <strong>only once</strong>. If you lose every passkey <strong>and</strong> your passphrase
            <strong>and</strong> this key, your cloud data is <strong>unrecoverable</strong>. Blotterbook can never recover it for you.
            (Your local copy in this browser always survives.)
          </p>
        </div>

        <div class="flex flex-col gap-2">
          <Label>Your recovery key</Label>
          <code
            data-testid="recovery-key"
            class="block break-all rounded-md border border-border bg-secondary px-3 py-2 font-mono text-sm text-foreground select-all"
            >{recoveryKey}</code
          >
          <div class="flex gap-2">
            <Button variant="secondary" size="sm" onclick={onDownload}>
              <Download class="size-4" />
              Download .txt
            </Button>
            <Button variant="outline" size="sm" onclick={onCopy}>
              {#if copied}<Check class="size-4" />{:else}<Copy class="size-4" />{/if}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>

        <!-- Optional passphrase (Argon2id KEK) — a second key method for no-PRF browsers / convenience -->
        <div class="flex flex-col gap-2 rounded-md border border-border p-3">
          <label class="flex items-center gap-2 text-sm text-foreground">
            <Checkbox bind:checked={usePassphrase} />
            Also set a passphrase (optional)
          </label>
          {#if usePassphrase}
            <Input
              type="password"
              autocomplete="new-password"
              placeholder="At least {MIN_PASSPHRASE} characters"
              bind:value={passphrase}
              aria-label="Cloud-sync passphrase"
              aria-invalid={passphrase.length > 0 && !passphraseStrong(passphrase)}
            />
            <p class="text-xs text-muted-foreground">
              Use at least {MIN_PASSPHRASE} characters mixing letters, numbers, or symbols. A passphrase lets you use sync on browsers without
              passkey PRF support — it's convenience only; the downloaded recovery key stays the strong root of trust.
            </p>
          {/if}
        </div>

        <label class="flex items-center gap-2 text-sm text-foreground">
          <Checkbox bind:checked={saved} data-testid="recovery-saved" />
          I've saved my recovery key somewhere safe.
        </label>

        {#if vault.error}
          <p class="text-xs text-destructive" role="alert">{vault.error}</p>
        {/if}

        <Dialog.Footer class="flex-row justify-end gap-2">
          <Button variant="ghost" size="sm" onclick={() => (open = false)}>Cancel</Button>
          <Button size="sm" data-testid="cloud-finish" disabled={!canFinish} onclick={onFinish}>Finish setup</Button>
        </Dialog.Footer>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
