<script lang="ts">
  // A293 — the standalone Account Dashboard page (site surface → /account.html; noindex + robots-
  // blocked). The marketing-site header's "Account" link lands here: logged OUT it renders passkey
  // login / create-account / recover (+ the A316 reclaim affordance); logged IN it renders the
  // dashboard — identity, plan & billing, cloud-sync status, security (passkeys), and account
  // deletion. Identity + entitlements ONLY (S25): no trade field ever renders here; trade data and
  // the sync-key vault live in the app (/app/), which this page links into for those tasks.
  //
  // The static frame prerenders (A69 SSG); the session is client-only, so account state hydrates
  // from /api/me on mount (the prerendered HTML shows the skeleton). Reuses the F53 client auth
  // module from the shared src/lib/account/ home (A328 — consumed by the app AND this site page).
  import { onMount } from 'svelte';
  import SiteShell from '../lib/SiteShell.svelte';
  import SubscribeForm from '$lib/account/SubscribeForm.svelte';
  import {
    account,
    refreshSession,
    login,
    register,
    logout,
    addPasskey,
    deletePasskey,
    deleteAccount,
    emailVerifySend,
    recoverSend,
    reclaimSend,
    setCancelAtPeriodEnd,
    EMAIL_RE,
    fmtDate,
  } from '$lib/account/account.svelte.ts';

  // A333: whether the caller has a REAL subscription to manage (null for admin-comped cloud).
  const manageableSub = $derived(
    account.subscription != null && ['active', 'trialing', 'past_due'].includes(account.subscription.status ?? '')
  );
  async function onCancelSub() {
    const ends = fmtDate(account.subscription?.currentPeriodEnd ?? null);
    if (
      !confirm(
        `Cancel your cloud subscription? Sync keeps working until ${ends}, then stops. ` +
          'Your local data and encryption keys are untouched, and you can resume any time before then.'
      )
    )
      return;
    await setCancelAtPeriodEnd(true);
  }

  let email = $state('');
  const emailValid = $derived(EMAIL_RE.test(email.trim()));
  const disabled = $derived(account.busy || !account.available);

  let recoverOpen = $state(false);
  let recoverEmail = $state('');
  let recoverSent = $state(false);
  const recoverValid = $derived(EMAIL_RE.test(recoverEmail.trim()));
  let reclaimSent = $state(false);
  let verifySent = $state(false);

  // Passkey removal — the server refuses to drop the LAST passkey, so the control only renders
  // when more than one is enrolled (mirrors the app's Account screen, A302).
  let pkBusy = $state('');
  async function onRemovePasskey(id: string, name: string) {
    if (!confirm(`Remove the passkey "${name}"? You'll no longer be able to sign in with it.`)) return;
    pkBusy = id;
    await deletePasskey(id);
    pkBusy = '';
  }

  // A305: two-phase resumable deletion — the POST-until-done loop lives in the shared account
  // module (A329); failures surface through the page-level `account.error` alert like every other
  // account action.
  let deleting = $state(false);
  let deleted = $state(false);
  async function onDeleteAccount() {
    if (
      !confirm(
        'Permanently delete your Blotterbook account, its passkeys, subscription linkage, and ALL synced (encrypted) data? ' +
          'This cannot be undone. Local data stored in your browsers is not touched.'
      )
    )
      return;
    deleting = true;
    if (await deleteAccount()) deleted = true;
    deleting = false;
  }

  async function onCreate(e: SubmitEvent) {
    e.preventDefault();
    if (disabled || !emailValid) return;
    reclaimSent = false;
    if (await register(email.trim().toLowerCase())) email = '';
  }
  async function onRecover(e: SubmitEvent) {
    e.preventDefault();
    if (disabled || !recoverValid) return;
    await recoverSend(recoverEmail);
    recoverSent = true; // always generic — never reveals whether the account exists
  }
  // A316: email a single-use reclaim link for the address the register attempt collided on.
  async function onReclaim() {
    if (disabled || !emailValid) return;
    await reclaimSend(email);
    reclaimSent = true;
  }
  async function onVerify() {
    if (await emailVerifySend()) verifySent = true;
  }

  // A278: the in-app subscription form + the subscribe-intent carry. A `?subscribe=1` landing
  // (homepage "Get cloud sync" CTA) latches the intent through the login/signup step, so a fresh
  // user ends up ON the subscribe form — not hunting for it — the moment their session exists.
  let subscribeOpen = $state(false);
  let subscribeIntent = $state(false);

  onMount(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('subscribe') === '1') {
      subscribeIntent = true;
      history.replaceState(null, '', location.pathname + location.hash); // scrub — a reload shouldn't re-trigger
    }
    void refreshSession();
  });

  $effect(() => {
    if (subscribeIntent && account.loaded && account.user) {
      subscribeIntent = false;
      if (account.tier !== 'cloud') subscribeOpen = true;
    }
  });
</script>

<SiteShell active="account">
  <p class="eyebrow">Your Account</p>
  <h1>Account</h1>

  {#if !account.available}
    <div class="note warn">Accounts aren't enabled on this deployment yet (the server reported the accounts database as unconfigured).</div>
  {/if}
  {#if account.error}
    <p class="text-[13px] text-destructive" role="alert">{account.error}</p>
  {/if}
  {#if deleted}
    <div class="note">
      Your account and all synced data were deleted. Local data in this browser is untouched. Thanks for trying Blotterbook.
    </div>
  {/if}

  {#if !account.loaded}
    <!-- session probe in flight — frame-shaped placeholder (this is also the prerendered state) -->
    <div class="rounded-md border border-border bg-card p-5" role="status" aria-label="Loading account">
      <div class="mb-3 h-5 w-36 animate-pulse rounded bg-secondary"></div>
      <div class="mb-2 h-4 w-full animate-pulse rounded bg-secondary"></div>
      <div class="h-9 w-48 animate-pulse rounded bg-secondary"></div>
    </div>
  {:else if !account.user}
    <!-- ── logged out: passkey login / create account / recover ─────────────────────────────── -->
    <p class="blurb">
      Blotterbook accounts are passkey-only — no passwords. An account holds your identity, plan, and (if you subscribe)
      end-to-end-encrypted cloud sync. <b>Your trade data never leaves your browser unencrypted.</b>
    </p>
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="rounded-md border border-border bg-card p-5">
        <h2 class="mt-0">Sign in</h2>
        <button
          type="button"
          class="w-full rounded-[9px] bg-primary px-4 py-2.5 text-[14px] font-semibold text-primary-foreground hover:brightness-[1.08] disabled:opacity-50"
          {disabled}
          onclick={() => void login()}>Log in with a passkey</button
        >
        {#if !recoverOpen}
          <button
            type="button"
            class="mt-3 bg-transparent p-0 text-[12.5px] text-muted-foreground underline hover:no-underline disabled:opacity-50"
            {disabled}
            onclick={() => (recoverOpen = true)}>Lost your passkey?</button
          >
        {:else if recoverSent}
          <p class="mt-3 text-[12.5px] text-muted-foreground" role="status">
            If an account with that email exists, we've sent a recovery link. Open it on this device to add a new passkey.
          </p>
        {:else}
          <form class="mt-3 flex flex-col gap-2" onsubmit={onRecover}>
            <label class="text-[12.5px] text-muted-foreground" for="acct-recover-email">Recover with your verified email</label>
            <input
              id="acct-recover-email"
              type="email"
              placeholder="you@example.com"
              autocomplete="email"
              class="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
              bind:value={recoverEmail}
              {disabled}
            />
            <button
              type="submit"
              class="self-start rounded-md border border-border bg-card px-3 py-1.5 text-[13px] text-foreground hover:bg-accent disabled:opacity-50"
              disabled={disabled || !recoverValid}>Send recovery link</button
            >
          </form>
        {/if}
      </div>
      <div class="rounded-md border border-border bg-card p-5">
        <h2 class="mt-0">Create an account</h2>
        <form class="flex flex-col gap-2" onsubmit={onCreate}>
          <label class="text-[12.5px] text-muted-foreground" for="acct-email">Email — used for recovery, never for marketing</label>
          <input
            id="acct-email"
            type="email"
            placeholder="you@example.com"
            autocomplete="email"
            class="rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground"
            bind:value={email}
            {disabled}
          />
          <button
            type="submit"
            class="rounded-[9px] bg-primary px-4 py-2.5 text-[14px] font-semibold text-primary-foreground hover:brightness-[1.08] disabled:opacity-50"
            disabled={disabled || !emailValid}>Create account with a passkey</button
          >
        </form>
        <!-- A316: the address is held by a never-verified account — offer proven-ownership reclaim -->
        {#if reclaimSent}
          <p class="mt-3 text-[12.5px] text-muted-foreground" role="status">
            If that address is held by an unverified account, we've emailed a reclaim link. Open it on this device to create your account.
          </p>
        {:else if account.reclaimable}
          <div class="mt-3 rounded-md border border-border bg-secondary/40 p-3" role="status">
            <p class="m-0 text-[12.5px] text-muted-foreground">
              Is that address yours? Prove it by email and the unverified account holding it will be released so you can sign up.
            </p>
            <button
              type="button"
              class="mt-2 rounded-md border border-border bg-card px-3 py-1.5 text-[13px] text-foreground hover:bg-accent disabled:opacity-50"
              disabled={disabled || !emailValid}
              onclick={() => void onReclaim()}>Email me a reclaim link</button
            >
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <!-- ── logged in: the dashboard ──────────────────────────────────────────────────────────── -->
    <div class="flex flex-col gap-4">
      <!-- Identity -->
      <div class="rounded-md border border-border bg-card p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="m-0 truncate font-mono text-[15px] text-foreground">{account.user.email}</p>
            <p class="m-0 text-[12.5px] text-muted-foreground">Member since {fmtDate(account.user.createdAt)}</p>
          </div>
          <div class="flex items-center gap-2">
            {#if account.user.emailVerified}
              <span class="rounded-[4px] border border-chart-2/40 bg-chart-2/10 px-2 py-0.5 text-[11px] text-chart-2">Email verified</span>
            {:else if verifySent}
              <span class="text-[12.5px] text-muted-foreground" role="status">Verification link sent — check your inbox.</span>
            {:else}
              <button
                type="button"
                class="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] text-foreground hover:bg-accent disabled:opacity-50"
                {disabled}
                onclick={() => void onVerify()}>Verify email</button
              >
            {/if}
            <button
              type="button"
              class="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] text-foreground hover:bg-accent disabled:opacity-50"
              {disabled}
              onclick={() => void logout()}>Sign out</button
            >
          </div>
        </div>
        {#if !account.user.emailVerified}
          <p class="mb-0 mt-3 text-[12.5px] text-muted-foreground">
            Verify your email so your account is recoverable if you lose your passkeys.
          </p>
        {/if}
      </div>

      <!-- Plan & billing -->
      <div class="rounded-md border border-border bg-card p-5">
        <h2 class="mt-0">Plan &amp; billing</h2>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="m-0 text-sm text-foreground">
              {#if account.tier === 'cloud'}
                <b>Cloud plan</b> — end-to-end-encrypted sync across your devices is included.
              {:else}
                <b>Local plan</b> (free) — everything computes and stays in your browser.
              {/if}
            </p>
            {#if account.user.donated}
              <p class="m-0 mt-1 text-[12.5px] text-muted-foreground">Supporter — thank you for donating.</p>
            {/if}
          </div>
          {#if account.tier !== 'cloud'}
            <button
              type="button"
              class="rounded-[9px] bg-primary px-4 py-2 text-[13.5px] font-semibold text-primary-foreground hover:brightness-[1.08] disabled:opacity-50"
              {disabled}
              onclick={() => (subscribeOpen = !subscribeOpen)}>Get cloud sync</button
            >
          {/if}
        </div>
        {#if subscribeOpen && account.tier !== 'cloud'}
          <!-- A278: the shared Payment Element form (owner-approved on this surface too). -->
          <div class="mt-4 border-t border-border pt-4">
            <SubscribeForm onsubscribed={() => (subscribeOpen = false)} />
          </div>
        {/if}
        <!-- A333: self-serve cancel/resume — only for a real subscriber (never for admin comps). -->
        {#if manageableSub && account.subscription}
          <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
            {#if account.subscription.cancelAtPeriodEnd}
              <p class="m-0 text-[12.5px] text-muted-foreground" data-testid="sub-cancel-scheduled">
                Subscription ends {fmtDate(account.subscription.currentPeriodEnd)} — sync stops then; your local data is untouched.
              </p>
              <button
                type="button"
                class="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] text-foreground hover:bg-accent disabled:opacity-50"
                data-testid="sub-resume"
                disabled={account.busy}
                onclick={() => void setCancelAtPeriodEnd(false)}>Resume subscription</button
              >
            {:else}
              <p class="m-0 text-[12.5px] text-muted-foreground">
                Renews {fmtDate(account.subscription.currentPeriodEnd)} · $5/month.
              </p>
              <button
                type="button"
                class="rounded-md border border-border bg-card px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                data-testid="sub-cancel"
                disabled={account.busy}
                onclick={() => void onCancelSub()}>Cancel subscription</button
              >
            {/if}
          </div>
        {/if}
      </div>

      <!-- Cloud sync (status only — keys + per-workspace management live in the app, S25) -->
      <div class="rounded-md border border-border bg-card p-5">
        <h2 class="mt-0">Cloud sync</h2>
        {#if account.tier === 'cloud'}
          <p class="m-0 text-sm text-muted-foreground">
            Included in your plan. Sync is opt-in per workspace and end-to-end encrypted — keys never leave your devices, so set-up and
            workspace management happen <a href="/app/app.html#account">in the app's Account screen</a>.
          </p>
        {:else}
          <p class="m-0 text-sm text-muted-foreground">
            Requires the cloud plan. When enabled, your journal syncs across devices as ciphertext the server cannot read — the
            zero-knowledge design is described in <a href="/legal.html">the privacy summary</a>.
          </p>
        {/if}
      </div>

      <!-- Security: passkeys -->
      <div class="rounded-md border border-border bg-card p-5">
        <h2 class="mt-0">Security</h2>
        <ul class="m-0 list-none p-0">
          {#each account.passkeys as pk (pk.id)}
            <li class="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 last:border-b-0">
              <div class="min-w-0">
                <p class="m-0 text-sm text-foreground">{pk.nickname || 'Passkey'}{pk.backedUp ? ' · synced' : ''}</p>
                <p class="m-0 text-[12px] text-muted-foreground">Added {fmtDate(pk.createdAt)} · last used {fmtDate(pk.lastUsedAt)}</p>
              </div>
              {#if account.passkeys.length > 1}
                <button
                  type="button"
                  class="rounded-md border border-border bg-card px-2.5 py-1 text-[12.5px] text-destructive hover:bg-accent disabled:opacity-50"
                  disabled={disabled || pkBusy === pk.id}
                  onclick={() => void onRemovePasskey(pk.id, pk.nickname || 'Passkey')}>Remove</button
                >
              {/if}
            </li>
          {/each}
        </ul>
        <button
          type="button"
          class="mt-3 rounded-md border border-border bg-card px-3 py-1.5 text-[13px] text-foreground hover:bg-accent disabled:opacity-50"
          {disabled}
          onclick={() => void addPasskey()}>Add another passkey</button
        >
        {#if account.passkeys.length === 1}
          <p class="mb-0 mt-2 text-[12.5px] text-muted-foreground">
            One passkey on record — add a second (e.g. on another device) so a lost device doesn't lock you out.
          </p>
        {/if}
      </div>

      <!-- Danger zone -->
      <div class="rounded-md border border-destructive/40 bg-card p-5">
        <h2 class="mt-0">Delete account</h2>
        <p class="mt-0 text-[13px] text-muted-foreground">
          Permanently removes your account, passkeys, subscription linkage, and all synced (encrypted) data from our servers. Data stored
          locally in your browsers is not touched. This cannot be undone.
        </p>
        <button
          type="button"
          class="rounded-md border border-destructive/50 bg-card px-3 py-1.5 text-[13px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
          disabled={disabled || deleting}
          onclick={() => void onDeleteAccount()}>{deleting ? 'Deleting…' : 'Delete my account'}</button
        >
      </div>
    </div>
  {/if}
</SiteShell>
