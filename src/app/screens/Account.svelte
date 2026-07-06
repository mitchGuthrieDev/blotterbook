<script lang="ts">
  // Account screen (Accounts Phase 1 — F53; docs/accounts-architecture.md). Self-contained over
  // the account.svelte.ts state module — no routing props. Logged out: passkey login + create-
  // account (email → register ceremony). Logged in: account info, donation badge placeholder
  // (F54 wires the real status), the passkey list with add-another, sign-out, and a disabled
  // Workspaces stub (Phase 4). Demo surface: every control disabled + a note (demo never mutates);
  // the session probe is skipped so demo issues no account traffic at all.
  import { onMount } from 'svelte';
  import { HeartHandshake, KeyRound, LogOut, Plus, UserRound, Boxes, MailCheck, ShieldAlert, LifeBuoy, X } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';
  import { Separator } from '$lib/components/ui/separator';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import {
    account,
    refreshSession,
    register,
    addPasskey,
    login,
    logout,
    emailVerifySend,
    recoverSend,
    completeRecovery,
  } from '../lib/account.svelte.ts';

  interface Props {
    /** demo surface — disables every control (demo never mutates) and skips the session probe. */
    isDemo?: boolean;
  }
  let { isDemo = false }: Props = $props();

  let email = $state('');
  const disabled = $derived(isDemo || account.busy || !account.available);
  const emailValid = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));

  // F55 UI state
  let nudgeDismissed = $state(false);
  let verifySent = $state(false);
  let verifiedBanner = $state(false);
  let donatedBanner = $state(false);
  let recoverOpen = $state(false);
  let recoverEmail = $state('');
  let recoverSent = $state(false);
  const recoverValid = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoverEmail.trim()));
  // one passkey on record → nudge to add a second (until dismissed)
  const showSecondPasskeyNudge = $derived(!!account.user && account.passkeys.length === 1 && !nudgeDismissed);

  const fmtDate = (ms: number | null) =>
    ms == null ? '—' : new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const fmtMoney = (cents: number) =>
    (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 });

  async function onCreateAccount(e: SubmitEvent) {
    e.preventDefault();
    if (disabled || !emailValid) return;
    if (await register(email.trim().toLowerCase())) email = '';
  }

  async function onVerifyEmail() {
    if (disabled) return;
    if (await emailVerifySend()) verifySent = true;
  }

  async function onRecoverSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (disabled || !recoverValid) return;
    await recoverSend(recoverEmail);
    recoverSent = true; // always generic — never reveals whether the account exists
  }

  onMount(() => {
    if (isDemo) return; // demo issues no account traffic at all
    // Complete an email-link flow if the app was opened from one (query param, not the #hash the
    // router owns): `?recover=<token>` runs the passkey re-enrollment ceremony; `?verified=1` /
    // `?donated=1` just show a confirmation. Scrub the query so a reload can't re-trigger it.
    const params = new URLSearchParams(location.search);
    const recoverToken = params.get('recover');
    verifiedBanner = params.get('verified') === '1';
    donatedBanner = params.get('donated') === '1';
    if (recoverToken || verifiedBanner || donatedBanner || params.get('verify')) {
      history.replaceState(null, '', location.pathname + location.hash);
    }
    if (recoverToken) void completeRecovery(recoverToken);
    else void refreshSession();
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
  {#if verifiedBanner}
    <div class="rounded-md border border-chart-2/40 bg-chart-2/10 px-3 py-2 text-xs text-chart-2" role="status">
      Email verified — thanks. Your account is now recoverable by email.
    </div>
  {/if}
  {#if donatedBanner}
    <div class="rounded-md border border-chart-2/40 bg-chart-2/10 px-3 py-2 text-xs text-chart-2" role="status">
      Thank you for supporting Blotterbook. Your supporter status will appear here once the payment is confirmed.
    </div>
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
        <!-- F55: passkey recovery (lost device) — enumeration-safe, always a generic result -->
        {#if !recoverOpen}
          <button
            type="button"
            class="self-start text-xs text-muted-foreground underline hover:no-underline disabled:opacity-50"
            {disabled}
            onclick={() => (recoverOpen = true)}>Lost your passkey?</button
          >
        {:else if recoverSent}
          <p class="flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <LifeBuoy class="size-4" />
            If an account with that email exists, we've sent a recovery link. Open it on this device to add a new passkey.
          </p>
        {:else}
          <form class="flex flex-col gap-2 rounded-md border border-border bg-secondary/40 p-3" onsubmit={onRecoverSubmit}>
            <Label for="recover-email" class="flex items-center gap-2"><LifeBuoy class="size-4" /> Recover with your email</Label>
            <Input
              id="recover-email"
              type="email"
              placeholder="you@example.com"
              autocomplete="email"
              bind:value={recoverEmail}
              {disabled}
            />
            <p class="text-xs text-muted-foreground">We'll email a single-use link to enroll a new passkey. Only verified emails work.</p>
            <Button type="submit" variant="outline" size="sm" class="self-start" disabled={disabled || !recoverValid}
              >Send recovery link</Button
            >
          </form>
        {/if}
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
        <!-- F54: real donation status from /api/me -->
        <div class="flex flex-wrap items-center gap-2">
          <HeartHandshake class="size-4 text-muted-foreground" />
          {#if account.user.donated}
            <Badge variant="outline" class="border-chart-2/40 text-chart-2">Supporter since {fmtDate(account.user.donatedAt)}</Badge>
            {#if account.user.donationTotalCents > 0}
              <span class="text-xs text-muted-foreground">{fmtMoney(account.user.donationTotalCents)} contributed — thank you.</span>
            {/if}
          {:else}
            <Badge variant="outline" class="text-muted-foreground">No donations yet</Badge>
          {/if}
        </div>
        <!-- F55: verify-email nudge (unlocks email recovery + donation claiming) -->
        {#if !account.user.emailVerified}
          <div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-chart-4/40 bg-chart-4/10 px-3 py-2">
            <p class="flex items-center gap-2 text-xs text-chart-4">
              <ShieldAlert class="size-4" />
              {#if verifySent}
                Check your inbox for a verification link (expires in 15 minutes).
              {:else}
                Verify your email so a lost passkey can't lock you out.
              {/if}
            </p>
            {#if !verifySent}
              <Button variant="outline" size="sm" {disabled} onclick={onVerifyEmail}>
                <MailCheck class="size-4" />
                Verify your email
              </Button>
            {/if}
          </div>
        {/if}
      </Card.Content>
    </Card.Root>

    <!-- F55: second-passkey nudge — dismissible, shown only with exactly one passkey on record -->
    {#if showSecondPasskeyNudge}
      <div
        class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-secondary/50 px-3 py-2"
        role="status"
      >
        <p class="flex items-center gap-2 text-xs text-muted-foreground">
          <KeyRound class="size-4" />
          Add a second passkey so a lost device can't lock you out.
        </p>
        <div class="flex items-center gap-1">
          <Button variant="secondary" size="sm" {disabled} onclick={() => void addPasskey()}>
            <Plus class="size-4" />
            Add a passkey
          </Button>
          <Button variant="ghost" size="icon" aria-label="Dismiss" onclick={() => (nudgeDismissed = true)}>
            <X class="size-4" />
          </Button>
        </div>
      </div>
    {/if}

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
