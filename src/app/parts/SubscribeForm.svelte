<script lang="ts">
  // A278 — the in-app subscription form (Stripe Payment Element). Used by BOTH the app's Account
  // screen and the standalone /account.html page (owner decision), so it's deliberately
  // self-contained and styled with plain Tailwind utilities (no shadcn imports — the site page
  // doesn't carry that layer's conventions).
  //
  // Flow: createSubscription() → an INCOMPLETE Stripe subscription + the first invoice's
  // PaymentIntent client secret → lazy-load Stripe.js (js.stripe.com — CSP-allowed on the app +
  // account surfaces only) → mount the Payment Element (all card fields live in Stripe's iframe;
  // PCI SAQ A — card data never touches our DOM) → confirmPayment with redirect:'if_required'
  // (3DS renders in Stripe's own frame) → poll /api/me until the signature-verified webhook flips
  // the tier (the webhook is the ONLY tier writer). Link is left disabled so no fourth Stripe
  // origin is needed in connect-src.
  //
  // Degradation: when Stripe.js can't load (script/iframe blockers) or the endpoint reports 501
  // (publishable key unset), the hosted-Checkout redirect (/api/checkout) is offered instead.
  import { onMount } from 'svelte';
  import { account, awaitCloudTier, createSubscription, stripeJs, subscribe } from '../lib/account.svelte.ts';
  import type { Stripe, StripeElements } from '@stripe/stripe-js';

  interface Props {
    /** Called once /api/me reports the cloud tier (the success terminal state). */
    onsubscribed?: () => void;
  }
  let { onsubscribed }: Props = $props();

  type Phase = 'loading' | 'ready' | 'confirming' | 'finalizing' | 'done' | 'already' | 'fallback' | 'error';
  let phase = $state<Phase>('loading');
  let error = $state('');
  let mountEl = $state<HTMLDivElement>();
  let stripe: Stripe | null = null;
  let elements: StripeElements | null = null;

  onMount(() => {
    void boot();
    return () => elements?.getElement('payment')?.destroy();
  });

  async function boot() {
    phase = 'loading';
    error = '';
    try {
      const res = await createSubscription();
      if ('alreadySubscribed' in res) {
        phase = 'already';
        return;
      }
      stripe = await stripeJs(res.publishableKey);
      if (!stripe || !mountEl) {
        phase = 'fallback'; // blocked script/origin — offer hosted Checkout
        return;
      }
      elements = stripe.elements({ clientSecret: res.clientSecret });
      const payment = elements.create('payment', { wallets: { link: 'never' } as never });
      payment.mount(mountEl);
      payment.on('ready', () => (phase = 'ready'));
    } catch (e) {
      // 501 not-configured → hosted Checkout still works; anything else shows + allows retry.
      const msg = e instanceof Error ? e.message : 'Could not start the subscription.';
      if (/not configured/i.test(msg)) phase = 'fallback';
      else {
        error = msg;
        phase = 'error';
      }
    }
  }

  async function onConfirm(e: SubmitEvent) {
    e.preventDefault();
    if (!stripe || !elements || phase !== 'ready') return;
    phase = 'confirming';
    error = '';
    const result = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    if (result.error) {
      error = result.error.message ?? 'Payment failed — try again.';
      phase = 'ready'; // the Element stays mounted; the user can retry
      return;
    }
    // Payment confirmed — the webhook flips the tier; poll /api/me until it lands.
    phase = 'finalizing';
    if (await awaitCloudTier()) {
      phase = 'done';
      onsubscribed?.();
    } else {
      // Webhook lag — the charge went through; keep it honest and offer a manual re-check.
      error = 'Payment received — activation is taking a moment. Use Refresh to check again.';
      phase = 'error';
    }
  }

  async function onRecheck() {
    error = '';
    phase = 'finalizing';
    if (await awaitCloudTier(2, 1000)) {
      phase = 'done';
      onsubscribed?.();
    } else {
      error = 'Not active yet — give it a few seconds and refresh again.';
      phase = 'error';
    }
  }
</script>

<div class="flex flex-col gap-3" data-testid="subscribe-form">
  {#if phase === 'already' || phase === 'done'}
    <div class="rounded-md border border-chart-2/40 bg-chart-2/10 px-3 py-2.5 text-sm text-chart-2" role="status">
      {phase === 'done' ? 'Subscription active — cloud sync is unlocked.' : 'Your subscription is already active.'}
    </div>
  {:else}
    <p class="m-0 text-sm text-muted-foreground">
      Cloud sync — <span class="font-medium text-foreground">$5/month</span>. Card details are handled by Stripe and never touch
      Blotterbook.
    </p>
    {#if phase === 'loading'}
      <div class="h-24 animate-pulse rounded-md border border-border bg-secondary/40" role="status" aria-label="Loading payment form"></div>
    {/if}
    <form class={['flex flex-col gap-3', phase === 'loading' || phase === 'fallback' ? 'hidden' : '']} onsubmit={onConfirm}>
      <div bind:this={mountEl}></div>
      <button
        type="submit"
        class="self-start rounded-[9px] bg-primary px-4 py-2 text-[13.5px] font-semibold text-primary-foreground hover:brightness-[1.08] disabled:opacity-50"
        disabled={phase !== 'ready'}
        data-testid="subscribe-confirm"
      >
        {phase === 'confirming' ? 'Processing…' : phase === 'finalizing' ? 'Activating…' : 'Subscribe — $5/month'}
      </button>
    </form>
    {#if error}
      <p class="m-0 text-[13px] text-destructive" role="alert">{error}</p>
      {#if phase === 'error'}
        <button
          type="button"
          class="self-start rounded-md border border-border bg-card px-3 py-1.5 text-[13px] text-foreground hover:bg-accent"
          onclick={() => void onRecheck()}>Refresh status</button
        >
      {/if}
    {/if}
    {#if phase === 'fallback'}
      <div class="flex flex-col gap-2 rounded-md border border-border bg-secondary/40 p-3" role="status">
        <p class="m-0 text-[13px] text-muted-foreground">The embedded payment form couldn't load here.</p>
        <button
          type="button"
          class="self-start rounded-md border border-border bg-card px-3 py-1.5 text-[13px] text-foreground hover:bg-accent disabled:opacity-50"
          disabled={account.busy}
          onclick={() => void subscribe()}>Use secure checkout →</button
        >
      </div>
    {/if}
  {/if}
</div>
