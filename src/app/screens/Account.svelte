<script lang="ts">
  // Account screen (Accounts Phase 1 — F53; docs/accounts-architecture.md). Self-contained over
  // the account.svelte.ts state module — no routing props. Logged out: passkey login + create-
  // account (email → register ceremony). Logged in: account info, donation badge placeholder
  // (F54 wires the real status), the passkey list with add-another, sign-out, and a disabled
  // Workspaces stub (Phase 4). Demo surface: every control disabled + a note (demo never mutates);
  // the session probe is skipped so demo issues no account traffic at all.
  import { onMount } from 'svelte';
  import { HeartHandshake, KeyRound, LogOut, Plus, UserRound, Boxes } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';
  import { Separator } from '$lib/components/ui/separator';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import { account, refreshSession, register, addPasskey, login, logout } from '../lib/account.svelte.ts';

  interface Props {
    /** demo surface — disables every control (demo never mutates) and skips the session probe. */
    isDemo?: boolean;
  }
  let { isDemo = false }: Props = $props();

  let email = $state('');
  const disabled = $derived(isDemo || account.busy || !account.available);
  const emailValid = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));

  const fmtDate = (ms: number | null) =>
    ms == null ? '—' : new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  async function onCreateAccount(e: SubmitEvent) {
    e.preventDefault();
    if (disabled || !emailValid) return;
    if (await register(email.trim().toLowerCase())) email = '';
  }

  onMount(() => {
    if (!isDemo) void refreshSession();
  });
</script>

<div class="mx-auto flex w-full max-w-2xl flex-col gap-4">
  {#if isDemo}
    <div class="rounded-md border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground" role="status">
      Demo mode — accounts are disabled here. Nothing on this surface is ever saved or sent.
    </div>
  {/if}
  {#if !account.available}
    <div class="rounded-md border border-chart-4/40 bg-chart-4/10 px-3 py-2 text-xs text-chart-4" role="status">
      Accounts aren't enabled on this deployment yet (the server reported the accounts database as unconfigured).
    </div>
  {/if}
  {#if account.error}
    <p class="text-xs text-destructive" role="alert">{account.error}</p>
  {/if}

  {#if !isDemo && !account.loaded}
    <!-- session probe in flight — card-shaped placeholder, no layout shift -->
    <div class="rounded-md border border-border bg-card p-4" role="status" aria-label="Loading account">
      <Skeleton class="mb-3 h-5 w-32" />
      <Skeleton class="mb-2 h-4 w-full" />
      <Skeleton class="h-9 w-48" />
    </div>
  {:else if !account.user}
    <!-- ── logged out ─────────────────────────────────────────────────────────────────────── -->
    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2"><KeyRound class="size-4" /> Sign in</Card.Title>
      </Card.Header>
      <Card.Content class="flex flex-col gap-4">
        <p class="text-sm text-muted-foreground">
          Blotterbook accounts are passkey-only — no passwords. Your account holds identity and (later) supporter status; your trade data
          never leaves this browser.
        </p>
        <Button {disabled} onclick={() => void login()}>
          <KeyRound class="size-4" />
          Log in with a passkey
        </Button>
        <div class="flex items-center gap-3" aria-hidden="true">
          <Separator class="flex-1" />
          <span class="text-xs text-muted-foreground">or create an account</span>
          <Separator class="flex-1" />
        </div>
        <form class="flex flex-col gap-2" onsubmit={onCreateAccount}>
          <Label for="account-email">Email</Label>
          <Input id="account-email" type="email" placeholder="you@example.com" autocomplete="email" bind:value={email} {disabled} />
          <p class="text-xs text-muted-foreground">Used for account recovery and to link donations — never for marketing.</p>
          <Button type="submit" variant="secondary" disabled={disabled || !emailValid}>
            <Plus class="size-4" />
            Create account with a passkey
          </Button>
        </form>
      </Card.Content>
    </Card.Root>
  {:else}
    <!-- ── logged in ──────────────────────────────────────────────────────────────────────── -->
    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2"><UserRound class="size-4" /> Account</Card.Title>
      </Card.Header>
      <Card.Content class="flex flex-col gap-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="min-w-0">
            <p class="truncate font-mono text-sm text-foreground">{account.user.email}</p>
            <p class="text-xs text-muted-foreground">Member since {fmtDate(account.user.createdAt)}</p>
          </div>
          <Button variant="outline" size="sm" {disabled} onclick={() => void logout()}>
            <LogOut class="size-4" />
            Sign out
          </Button>
        </div>
        <Separator />
        <div class="flex items-center gap-2">
          <HeartHandshake class="size-4 text-muted-foreground" />
          {#if account.user.donated}
            <Badge variant="outline" class="border-chart-2/40 text-chart-2">Supporter since {fmtDate(account.user.donatedAt)}</Badge>
          {:else}
            <!-- placeholder — F54 (donation → account) wires the real status -->
            <Badge variant="outline" class="text-muted-foreground">No donations yet</Badge>
          {/if}
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2"><KeyRound class="size-4" /> Passkeys</Card.Title>
      </Card.Header>
      <Card.Content class="flex flex-col gap-3">
        <ul class="flex flex-col gap-2">
          {#each account.passkeys as pk (pk.id)}
            <li class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <div class="min-w-0">
                <p class="truncate text-sm text-foreground">{pk.nickname || 'Passkey'}</p>
                <p class="text-xs text-muted-foreground">
                  Added {fmtDate(pk.createdAt)}{pk.lastUsedAt != null ? ` · last used ${fmtDate(pk.lastUsedAt)}` : ''}
                </p>
              </div>
              {#if pk.backedUp}<Badge variant="secondary">Synced</Badge>{/if}
            </li>
          {:else}
            <li class="text-sm text-muted-foreground">No passkeys on record.</li>
          {/each}
        </ul>
        {#if account.passkeys.length < 2}
          <p class="text-xs text-muted-foreground">
            Tip: add a second passkey on another device (your phone, via the QR prompt) so losing one doesn't lock you out.
          </p>
        {/if}
        <Button variant="secondary" size="sm" class="self-start" {disabled} onclick={() => void addPasskey()}>
          <Plus class="size-4" />
          Add another passkey
        </Button>
      </Card.Content>
    </Card.Root>

    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2 text-muted-foreground"><Boxes class="size-4" /> Workspaces</Card.Title>
      </Card.Header>
      <Card.Content class="flex flex-col gap-2">
        <p class="text-sm text-muted-foreground">Synced workspaces — coming later.</p>
        <p class="text-xs text-muted-foreground">
          Named workspaces with cloud-synced settings will live here. Trade data itself stays in this browser unless a future opt-in sync
          tier says otherwise.
        </p>
        <Button variant="outline" size="sm" class="self-start" disabled>Coming soon</Button>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
