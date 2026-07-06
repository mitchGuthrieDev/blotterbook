<script lang="ts">
  // F56 — the login-gated launch module (staging-only; armed by APP_FLAGS.ACCOUNT_GATE / a bb:flags
  // override — the caller in App.svelte owns the isStaging + `!account.user` gate). Self-contained over
  // the shared account.svelte.ts state module (same pattern as the Account screen): a passkey login
  // button + a Create-account form that expands beside it (email → register ceremony). The
  // @simplewebauthn/browser chunk stays LAZY — it loads only when a ceremony runs, never at boot.
  //
  // The session probe (GET /api/me) is owned by App.svelte (it calls refreshSession once the gate is
  // armed); while it's in flight (`!account.loaded`) this renders a card-shaped skeleton, so the user
  // never sees a flash of the real app before the gate decides. On a successful login/register
  // `account.user` flips and App unmounts the gate — the normal app (onboarding or dashboard) proceeds.
  import { KeyRound, Plus } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { account, login, register } from '../lib/account.svelte.ts';

  let creating = $state(false);
  let email = $state('');
  const disabled = $derived(account.busy || !account.available);
  const emailValid = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));

  async function onCreate(e: SubmitEvent) {
    e.preventDefault();
    if (disabled || !emailValid) return;
    // On success account.user flips → App unmounts the gate; no local navigation needed.
    if (await register(email.trim().toLowerCase())) email = '';
  }
</script>

<div class="grid min-h-[70vh] place-items-center" data-testid="launch-gate">
  <div class="w-full max-w-sm">
    {#if !account.loaded}
      <!-- session probe in flight — card-shaped placeholder (no flash of the app underneath) -->
      <div class="rounded-md border border-border bg-card p-6" role="status" aria-label="Checking your session">
        <Skeleton class="mx-auto mb-4 h-7 w-40" />
        <Skeleton class="mb-2 h-4 w-full" />
        <Skeleton class="mb-6 h-4 w-3/4" />
        <Skeleton class="h-9 w-full" />
      </div>
    {:else}
      <div class="mb-6 text-center">
        <div class="font-mono text-2xl font-semibold tracking-tight text-foreground">Blotterbook</div>
        <p class="mt-1 text-sm text-muted-foreground">Sign in to launch Blotterbook</p>
      </div>

      <Card.Root>
        <Card.Content class="flex flex-col gap-4 pt-6">
          {#if !account.available}
            <div class="rounded-md border border-chart-4/40 bg-chart-4/10 px-3 py-2 text-xs text-chart-4" role="status">
              Accounts aren't enabled on this deployment yet (the server reported the accounts database as unconfigured).
            </div>
          {/if}
          {#if account.error}
            <p class="text-xs text-destructive" role="alert">{account.error}</p>
          {/if}

          {#if !creating}
            <div class="flex flex-col gap-2 sm:flex-row">
              <Button class="flex-1" {disabled} onclick={() => void login()}>
                <KeyRound class="size-4" />
                Log in
              </Button>
              <Button class="flex-1" variant="secondary" {disabled} onclick={() => (creating = true)}>
                <Plus class="size-4" />
                Create account
              </Button>
            </div>
            <p class="text-center text-xs text-muted-foreground">Passkey-only — no passwords. Your trade data never leaves this browser.</p>
          {:else}
            <form class="flex flex-col gap-2" onsubmit={onCreate}>
              <Label for="gate-email">Email</Label>
              <Input id="gate-email" type="email" placeholder="you@example.com" autocomplete="email" bind:value={email} {disabled} />
              <p class="text-xs text-muted-foreground">Used for account recovery and to link donations — never for marketing.</p>
              <div class="mt-1 flex flex-col gap-2 sm:flex-row">
                <Button type="submit" class="flex-1" disabled={disabled || !emailValid}>
                  <Plus class="size-4" />
                  Create account with a passkey
                </Button>
                <Button type="button" variant="ghost" {disabled} onclick={() => (creating = false)}>Back</Button>
              </div>
            </form>
          {/if}
        </Card.Content>
      </Card.Root>
    {/if}
  </div>
</div>
