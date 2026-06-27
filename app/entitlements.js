"use strict";
/* ============================================================
   Entitlements — which storage tier the current user gets.

   This is a SCAFFOLD. Today every user is on the "local" tier:
   data lives in IndexedDB via Store (app/store.js). Accounts and
   payments are NOT implemented in the app yet.

   The planned tiers (see functions/README.md):
     - "local"  : one-time payment -> IndexedDB only            (today)
     - "cloud"  : subscription     -> IndexedDB + server storage (future)

   When accounts land, `current()` will call /api/me (a Pages
   Function backed by Stripe) and return the real tier, and the app
   will pick a Store implementation from `storeFor(tier)`. Until
   then it always resolves to "local" and the local Store, so the
   rest of the app can already be written against this interface.
   ============================================================ */
import { Store } from './store.js';

export const Entitlements = {
  async current() {
    // FUTURE: const r = await fetch('/api/me'); return (await r.json()).tier;
    return { tier: 'local', cloudSync: false };
  },

  // Returns the Store implementation backing a given tier.
  // Both tiers use local Store today; "cloud" will gain a CloudStore later.
  storeFor(/* tier */) {
    return Store;
  }
};
