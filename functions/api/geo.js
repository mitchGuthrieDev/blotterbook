/* Cloudflare Pages Function — GET /api/geo
   Returns the visitor's coarse location from Cloudflare's edge metadata
   (request.cf) so the app can pre-select the US state for the tax estimate.
   No IP, no third-party service, nothing stored — just the country/region
   Cloudflare already resolved at the edge. Privacy-preserving and convenience
   only; the user can always change the selection. */

import { json } from '../_lib/http.js';

export async function onRequest(context) {
  const cf = (context.request && context.request.cf) || {};
  return json({
    country: cf.country || null, // "US"
    region: cf.region || null, // "Texas"
    regionCode: cf.regionCode || null, // "TX"
  });
}
