/* Cloudflare Pages Function — GET /api/geo
   Returns the visitor's coarse location from Cloudflare's edge metadata
   (request.cf) so the app can pre-select the US state for the tax estimate.
   No IP, no third-party service, nothing stored — just the country/region
   Cloudflare already resolved at the edge. Privacy-preserving and convenience
   only; the user can always change the selection. */

import { json } from '../_lib/http.ts';
import type { Ctx } from '../_lib/types.ts';

export async function onRequest(context: Ctx) {
  // A88: read only the coarse edge fields we need, typed instead of `any`.
  const cf = ((context.request && context.request.cf) || {}) as { country?: string; region?: string; regionCode?: string };
  // CH27: the response is the visitor's OWN coarse region (varies per visitor), so cache it PRIVATE —
  // the browser reuses it on reloads/navigations (cutting repeat Function invocations) but no shared
  // cache may hand one visitor's region to another. The state prefill is convenience-only, so a
  // 30-minute stale read is fine.
  return json(
    {
      country: cf.country || null, // "US"
      region: cf.region || null, // "Texas"
      regionCode: cf.regionCode || null, // "TX"
    },
    200,
    { 'Cache-Control': 'private, max-age=1800' }
  );
}
