/* ============================================================
   Entitlements — which storage tier the current user gets, and which Store
   implementation backs it.

   Wired in F60 (synced workspaces, Step 3). `current()` probes GET /api/me — a
   Pages Function that resolves the real tier from the signature-verified Stripe
   subscription row per the locked period-end + grace lapse policy — and returns
   the tier + cloudSync flag. `storeFor(tier)` selects the Store implementation.

   The tiers (see functions/README.md):
     - "local"  : one-time payment      -> IndexedDB only
     - "cloud"  : recurring subscription -> IndexedDB + server sync

   Today BOTH tiers resolve to the local `Store` (IndexedDB via src/lib/core/store.ts):
   `CloudStore` (the write-behind wrapper) lands in F63 and swaps in for "cloud"
   without touching any consumer — every caller depends only on the `StoreLike`
   interface. So wiring this now is behaviorally a no-op: it establishes the seam.

   S25 note: /api/me carries identity + entitlements ONLY; no trade data ever
   crosses it. `current()` never throws — any fetch/parse failure falls back to
   the local tier so the app boots offline-first regardless.
   ============================================================ */
import { Store } from './store.ts';
import type { StoreLike } from './types.ts';

export type Tier = 'local' | 'cloud';
export interface Entitlement {
  tier: Tier;
  cloudSync: boolean;
}

const LOCAL: Entitlement = { tier: 'local', cloudSync: false };

export const Entitlements = {
  /** Resolve the current entitlement from /api/me. Falls back to the local tier on any error —
   *  never throws (offline / accounts-not-configured / a D1 hiccup all read as `local`). */
  async current(): Promise<Entitlement> {
    try {
      const res = await fetch('/api/me', { headers: { Accept: 'application/json' }, credentials: 'include' });
      if (!res.ok) return LOCAL;
      const data = (await res.json()) as { tier?: unknown; cloudSync?: unknown };
      const tier: Tier = data.tier === 'cloud' ? 'cloud' : 'local';
      return { tier, cloudSync: tier === 'cloud' && data.cloudSync === true };
    } catch (_) {
      return LOCAL;
    }
  },

  /** The Store implementation backing a given tier. Both tiers use the local `Store` today; F63's
   *  `CloudStore` swaps in here for "cloud" (a `StoreLike`, so no consumer changes). */
  storeFor(tier: Tier): StoreLike {
    // F63: return the CloudStore for 'cloud'. Until then both tiers are the local Store — a no-op.
    void tier;
    return Store;
  },
};
