<script lang="ts">
  // Account screen (Accounts Phase 1 — F53; docs/accounts-architecture.md). Self-contained over
  // the account.svelte.ts state module — no routing props. Logged out: passkey login + create-
  // account (email → register ceremony). Logged in: account info, donation badge placeholder
  // (F54 wires the real status), the passkey list with add-another, sign-out, and the (prod + staging, not demo)
  // cloud-sync key card (F61b — set up / unlock / add-a-method). Demo surface: every control disabled
  // + a note (demo never mutates); the session probe is skipped so demo issues no account traffic.
  import { onMount } from 'svelte';
  import {
    HeartHandshake,
    KeyRound,
    LogOut,
    Plus,
    UserRound,
    MailCheck,
    ShieldAlert,
    LifeBuoy,
    X,
    Cloud,
    ShieldCheck,
    LockKeyhole,
    LockKeyholeOpen,
    Download,
    RefreshCw,
    Fingerprint,
    Trash2,
  } from '@lucide/svelte';
  import * as Card from '$lib/components/ui/card';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';
  import { Separator } from '$lib/components/ui/separator';
  import { Skeleton } from '$lib/components/ui/skeleton';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import { usdCents } from '../../lib/core/core.ts';
  import {
    account,
    refreshSession,
    register,
    addPasskey,
    deletePasskey,
    login,
    logout,
    emailVerifySend,
    recoverSend,
    completeRecovery,
    registerPrfPasskey,
    subscribe,
  } from '../lib/account.svelte.ts';
  import {
    vault,
    refreshVault,
    lock,
    prfSupported,
    setPassphrase,
    regenerateRecoveryKey,
    addPasskeyMethod,
    passphraseStrong,
    MIN_PASSPHRASE,
  } from '../lib/vault.svelte.ts';
  import {
    cloudSync,
    onSyncUnlocked,
    syncActiveWorkspace,
    pullFromCloud,
    pushToCloud,
    pauseCloudSync,
    enableCloudSync,
  } from '../lib/cloudsync.svelte.ts';
  import { downloadBlob } from '../lib/files.ts';
  import CloudSyncSetup from '../parts/CloudSyncSetup.svelte';
  import UnlockModal from '../parts/UnlockModal.svelte';
  import SyncStatusPill from '../parts/SyncStatusPill.svelte';

  interface Props {
    /** demo surface — disables every control (demo never mutates) and skips the session probe. */
    isDemo?: boolean;
  }
  let { isDemo = false }: Props = $props();

  // ── F61b/CH16: cloud-sync key setup / unlock — shown for any logged-in non-demo user (prod +
  // staging). It stays inert until they're cloud-tier (the enable/status affordance shows
  // "cloud tier required" on local tier); demo never renders it (in-memory DemoStore never syncs). ──
  const cloudSyncOn = $derived(!isDemo && !!account.user);
  let setupOpen = $state(false);
  let unlockOpen = $state(false);
  let prfOk = $state(false);
  let addPassphrase = $state('');
  let regenKey = $state(''); // a freshly regenerated recovery key, shown once
  let regenCopied = $state(false);

  // Lock the in-memory key session whenever the account session ends (logout / expiry). No key is
  // ever persisted, so this just clears the in-memory IK; a reload has the same effect for free.
  $effect(() => {
    if (!account.user) lock();
  });

  async function onSignOut() {
    lock();
    await logout();
  }

  async function onSetPassphrase() {
    if (await setPassphrase(addPassphrase)) addPassphrase = '';
  }

  async function onRegenerate() {
    const key = await regenerateRecoveryKey();
    if (key) regenKey = key;
  }

  function downloadRegen() {
    const text = [
      'Blotterbook — cloud-sync recovery key (regenerated)',
      `Generated ${new Date().toISOString()}`,
      '',
      'KEEP THIS SAFE AND PRIVATE. Your previous recovery key no longer works.',
      '',
      regenKey,
      '',
    ].join('\n');
    downloadBlob('blotterbook-recovery-key.txt', new Blob([text], { type: 'text/plain' }));
  }

  async function copyRegen() {
    try {
      await navigator.clipboard.writeText(regenKey);
      regenCopied = true;
      setTimeout(() => (regenCopied = false), 1500);
    } catch (_) {
      /* clipboard blocked — the download path still works */
    }
  }

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

  // A302: passkey removal (stolen-device remediation) — confirm before removing. The server refuses
  // to delete the LAST passkey (a stranded account has no login), so the Remove control only renders
  // when more than one is enrolled; re-enroll a replacement first to remove the final one.
  let pkRemove = $state<{ id: string; name: string } | null>(null);
  async function onRemovePasskey() {
    const pk = pkRemove;
    pkRemove = null;
    if (pk) await deletePasskey(pk.id);
  }

  const fmtDate = (ms: number | null) =>
    ms == null ? '—' : new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

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

  // Probe cloud-sync key state + PRF support once a CLOUD-tier session resolves (prod + staging).
  // Local-tier users see the subscribe CTA instead, so we don't hit /api/sync for them.
  $effect(() => {
    if (cloudSyncOn && account.tier === 'cloud' && !vault.loaded && !vault.busy) {
      void refreshVault();
      void prfSupported().then(ok => (prfOk = ok));
    }
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
          <Button variant="outline" size="sm" {disabled} onclick={() => void onSignOut()}>
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
              <span class="text-xs text-muted-foreground">{usdCents(account.user.donationTotalCents)} contributed — thank you.</span>
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
              <div class="flex items-center gap-2">
                {#if pk.backedUp}<Badge variant="secondary">Synced</Badge>{/if}
                {#if account.passkeys.length > 1}
                  <Button
                    variant="ghost"
                    size="sm"
                    class="text-destructive hover:text-destructive"
                    {disabled}
                    onclick={() => (pkRemove = { id: pk.id, name: pk.nickname || 'Passkey' })}
                  >
                    <Trash2 class="size-4" />
                    <span class="sr-only">Remove passkey</span>
                  </Button>
                {/if}
              </div>
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

    <!-- A302: confirm passkey removal (stolen-device remediation) — the underlying endpoint is scoped
         to the caller + refuses to strand the account by deleting the last passkey. -->
    <AlertDialog.Root open={pkRemove !== null} onOpenChange={o => !o && (pkRemove = null)}>
      <AlertDialog.Content>
        <AlertDialog.Header>
          <AlertDialog.Title>Remove “{pkRemove?.name}”?</AlertDialog.Title>
          <AlertDialog.Description>
            This device will no longer be able to sign in with this passkey. If it was lost or stolen, removing it revokes its access. You
            can enroll a new passkey any time.
          </AlertDialog.Description>
        </AlertDialog.Header>
        <AlertDialog.Footer>
          <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
          <AlertDialog.Action class="bg-destructive text-white hover:bg-destructive/90" onclick={onRemovePasskey}
            >Remove passkey</AlertDialog.Action
          >
        </AlertDialog.Footer>
      </AlertDialog.Content>
    </AlertDialog.Root>

    <!-- ── F61b/CH16: cloud-sync keys (prod + staging, logged-in only; demo never renders this) ── -->
    {#if cloudSyncOn}
      <Card.Root data-testid="cloud-sync-card">
        <Card.Header>
          <Card.Title class="flex items-center gap-2"><Cloud class="size-4" /> Cloud sync</Card.Title>
        </Card.Header>
        <Card.Content class="flex flex-col gap-3">
          <p class="text-sm text-muted-foreground">
            End-to-end encrypted, multi-device sync. Your trades are encrypted in this browser with a key we never see — the server only
            stores ciphertext it can't read.
          </p>

          {#if !account.loaded}
            <!-- A306: neutral while /api/me is still probing — don't flash the Subscribe CTA at a paying user. -->
            <Skeleton class="h-9 w-48" data-testid="cloud-tier-checking" />
          {:else if account.tier !== 'cloud'}
            <!-- LOCAL tier — cloud sync is the $5/mo supporter subscription. Setup is tier-gated so a
                 free user never generates keys the server (A253 entitlement gate) would reject on write.
                 A306: a user who has ALREADY set up cloud sync (or whose enabled workspace just 402/403'd)
                 is a LAPSED subscriber, not a first-timer — show a RENEW path, not the first-time CTA. -->
            {#if cloudSync.needsSub || vault.setUp}
              <div class="rounded-md border border-chart-4/40 bg-chart-4/10 px-3 py-2.5 text-sm text-chart-4" data-testid="cloud-lapsed">
                Your supporter subscription is inactive, so this device has stopped syncing. Renew to resume — your local data and
                encryption keys are untouched.
              </div>
              <Button data-testid="cloud-renew" disabled={account.busy} onclick={() => void subscribe()} class="self-start">
                <Cloud class="size-4" />
                Renew — $5/month
              </Button>
            {:else}
              <div class="rounded-md border border-border bg-secondary/40 px-3 py-2.5 text-sm text-muted-foreground">
                Cloud sync is part of the <span class="font-medium text-foreground">$5/month</span> supporter tier — sync your journal across
                your devices, still end-to-end encrypted. Your local data is unaffected either way.
              </div>
              <Button data-testid="cloud-subscribe" disabled={account.busy} onclick={() => void subscribe()} class="self-start">
                <Cloud class="size-4" />
                Subscribe — $5/month
              </Button>
            {/if}
          {:else if !vault.loaded}
            <Skeleton class="h-9 w-48" />
          {:else if !vault.setUp}
            <!-- not set up yet -->
            <Button data-testid="cloud-setup-open" onclick={() => (setupOpen = true)} class="self-start">
              <ShieldCheck class="size-4" />
              Set up cloud sync
            </Button>
          {:else}
            <!-- A311(b): set up — the status pill + the sign-in/encryption explainer render whether
                 LOCKED or UNLOCKED; only the add-a-method flows (which need the in-memory IK) stay gated
                 on vault.unlocked below, so a locked user can still see their sync state + the guidance. -->
            {#if !vault.unlocked}
              <!-- set up, locked for this session — the E2E key isn't in memory yet -->
              <div class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-chart-4/40 bg-chart-4/10 px-3 py-2">
                <p class="flex items-center gap-2 text-xs text-chart-4">
                  <LockKeyhole class="size-4" /> Encryption locked — unlock once to sync this session.
                </p>
                <Button size="sm" data-testid="cloud-unlock-open" onclick={() => (unlockOpen = true)}>
                  <LockKeyholeOpen class="size-4" /> Unlock
                </Button>
              </div>
            {:else}
              <!-- unlocked in memory for this session -->
              <div class="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="outline" class="border-chart-2/40 text-chart-2" data-testid="cloud-unlocked">
                  <LockKeyholeOpen class="mr-1 size-3.5" /> Encryption unlocked this session
                </Badge>
                <Button variant="outline" size="sm" data-testid="cloud-lock" onclick={() => lock()}>
                  <LockKeyhole class="size-4" /> Lock
                </Button>
              </div>
            {/if}

            <!-- A279/A311(b): active-workspace sync parity — the pill shows for a LOCKED user too (as
                 'Needs unlock'); the direction controls need the unlocked IK, so they stay gated. -->
            {#if cloudSync.configured}
              <div class="flex flex-col gap-2 rounded-md border border-border p-3" data-testid="cloud-sync-panel">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <SyncStatusPill />
                  {#if vault.unlocked && cloudSync.enabled && cloudSync.status !== 'syncing'}
                    <Button size="sm" data-testid="cloud-sync-now" onclick={() => void syncActiveWorkspace({ full: true })}>
                      <RefreshCw class="size-4" /> Sync now
                    </Button>
                  {/if}
                </div>
                {#if !vault.unlocked}
                  <p class="text-xs text-muted-foreground">Unlock encryption above to sync this device.</p>
                {:else if cloudSync.enabled}
                  <div class="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="cloud-pull"
                      disabled={cloudSync.status === 'syncing'}
                      onclick={() => void pullFromCloud()}
                    >
                      Pull from cloud
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="cloud-push"
                      disabled={cloudSync.status === 'syncing'}
                      onclick={() => void pushToCloud()}
                    >
                      Push to cloud
                    </Button>
                    <Button variant="ghost" size="sm" data-testid="cloud-pause" onclick={() => pauseCloudSync()}>Pause sync</Button>
                  </div>
                  <p class="text-xs text-muted-foreground">
                    <strong class="font-medium text-foreground">Sync now</strong> reconciles both ways;
                    <strong class="font-medium text-foreground">Pull</strong>/<strong class="font-medium text-foreground">Push</strong> move one
                    direction. When two devices differ, the newest edit wins; trades are combined, never overwritten.
                  </p>
                {:else if cloudSync.paused}
                  <!-- A306: paused ≠ never-synced — a Resume control right here, not just in the switcher. -->
                  <div class="flex flex-wrap items-center gap-2">
                    <Button size="sm" data-testid="cloud-resume" disabled={cloudSync.busy} onclick={() => void enableCloudSync()}>
                      <RefreshCw class="size-4" /> Resume sync
                    </Button>
                    <span class="text-xs text-muted-foreground"
                      >Sync is paused for this workspace on this device. Your cloud copy is kept.</span
                    >
                  </div>
                {:else}
                  <p class="text-xs text-muted-foreground">
                    Turn on sync for a workspace from the workspace switcher (top of the sidebar) to start syncing this device.
                  </p>
                {/if}
              </div>
            {/if}

            <!-- A279: clarify the two secrets — signing in vs decrypting. -->
            <details class="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground">
              <summary class="cursor-pointer font-medium text-foreground">How sign-in and encryption relate</summary>
              <div class="mt-2 flex flex-col gap-1.5 leading-relaxed">
                <p>
                  Your <strong class="text-foreground">passkey</strong> signs you into your account — it proves who you are to the server.
                </p>
                <p>
                  Your <strong class="text-foreground">passphrase</strong> or <strong class="text-foreground">recovery key</strong> unlocks your
                  end-to-end encryption — it turns your synced data back into plaintext in this browser. The server never sees it, so it can never
                  read your trades.
                </p>
                <p>A passkey that supports PRF can do both: sign you in <em>and</em> unlock encryption in one tap.</p>
              </div>
            </details>

            {#if vault.unlocked}
              <Separator />
              <!-- add-a-method flows: each re-wraps the SAME in-memory IK (the encryption key) under a new KEK -->
              <div class="flex flex-col gap-3">
                <p class="text-xs font-medium text-muted-foreground">Encryption keys (unlock methods)</p>

                <div class="flex flex-col gap-2">
                  <Label for="add-passphrase" class="flex items-center gap-2"><KeyRound class="size-4" /> Set or change passphrase</Label>
                  <div class="flex gap-2">
                    <Input
                      id="add-passphrase"
                      type="password"
                      autocomplete="new-password"
                      placeholder="At least {MIN_PASSPHRASE} characters"
                      bind:value={addPassphrase}
                      disabled={vault.busy}
                      aria-invalid={addPassphrase.length > 0 && !passphraseStrong(addPassphrase)}
                    />
                    <Button size="sm" disabled={vault.busy || !passphraseStrong(addPassphrase)} onclick={onSetPassphrase}>Save</Button>
                  </div>
                </div>

                <div class="flex flex-wrap items-center justify-between gap-2">
                  <p class="flex items-center gap-2 text-sm text-foreground"><Fingerprint class="size-4" /> Add a passkey</p>
                  {#if prfOk}
                    <Button variant="secondary" size="sm" disabled={vault.busy} onclick={() => void addPasskeyMethod(registerPrfPasskey)}>
                      <Plus class="size-4" /> Add PRF passkey
                    </Button>
                  {:else}
                    <span class="text-xs text-muted-foreground">Passkey unlock needs a PRF-capable browser — use a passphrase here.</span>
                  {/if}
                </div>

                <div class="flex flex-wrap items-center justify-between gap-2">
                  <p class="flex items-center gap-2 text-sm text-foreground"><RefreshCw class="size-4" /> Recovery key</p>
                  <Button variant="outline" size="sm" disabled={vault.busy} onclick={onRegenerate}>Regenerate</Button>
                </div>

                {#if regenKey}
                  <div class="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
                    <p class="text-xs text-destructive">New recovery key — save it now. Your previous key no longer works.</p>
                    <code class="block break-all rounded bg-secondary px-2 py-1 font-mono text-sm text-foreground select-all"
                      >{regenKey}</code
                    >
                    <div class="flex gap-2">
                      <Button variant="secondary" size="sm" onclick={downloadRegen}><Download class="size-4" /> Download</Button>
                      <Button variant="outline" size="sm" onclick={copyRegen}>{regenCopied ? 'Copied' : 'Copy'}</Button>
                      <Button variant="ghost" size="sm" onclick={() => (regenKey = '')}>Done</Button>
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          {/if}

          {#if vault.error && !setupOpen && !unlockOpen}
            <p class="text-xs text-destructive" role="alert">{vault.error}</p>
          {/if}
        </Card.Content>
      </Card.Root>

      <CloudSyncSetup
        bind:open={setupOpen}
        ondone={() => {
          void refreshVault();
          onSyncUnlocked(); // first-time setup unlocks the IK too — refresh the shared sync status
        }}
      />
      <!-- A257: converge the controller's status when the vault is unlocked FROM this screen (matches
           WorkspaceSwitcher) — otherwise cloudSync.status stays stuck at 'locked'. -->
      <UnlockModal bind:open={unlockOpen} onunlocked={() => onSyncUnlocked()} />
    {/if}
  {/if}
</div>
