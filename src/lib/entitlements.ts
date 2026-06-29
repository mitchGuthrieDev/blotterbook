'use strict';
/* ============================================================
   Entitlements — which storage tier the current user gets.

   This is a SCAFFOLD and is INTENTIONALLY UNLOADED — no module imports it
   (the Svelte app never mounts it). It's kept as the seam for the planned
   A4/A16 CloudStore tier; it must stay lint/typecheck-clean so it doesn't
   bit-rot before it's wired (CH35). Today every user is on the "local" tier:
   data lives in IndexedDB via Store (src/lib/store.ts). Accounts and payments
   are NOT implemented in the app yet.

   The planned tiers (see functions/README.md):
     - "local"  : one-time payment -> IndexedDB only            (today)
     - "cloud"  : subscription     -> IndexedDB + server storage (future)

   When accounts land, `current()` will call /api/me (a Pages
   Function backed by Stripe) and return the real tier, and the app
   will pick a Store implementation from `storeFor(tier)`. Until
   then it always resolves to "local" and the local Store, so the
   rest of the app can already be written against this interface.
   ============================================================ */
import { Store } from './store.ts';

export const Entitlements = {
  async current() {
    // FUTURE: const r = await fetch('/api/me'); return (await r.json()).tier;
    return { tier: 'local', cloudSync: false };
  },

  // Returns the Store implementation backing a given tier.
  // Both tiers use local Store today; "cloud" will gain a CloudStore later.
  storeFor(/* tier */) {
    return Store;
  },
};
