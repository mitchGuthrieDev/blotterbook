/* Blotterbook · client feature-flag defaults.

   The vanilla view layer that used to live in this file (CSV import, demo data, filters, day-notes
   journal, session restore, setup) was removed in the A33 Svelte cutover — those concerns now live
   in the Svelte app (src/app/) over the pure-logic core. What remains is the client feature-flag
   contract: APP_FLAGS are the offline defaults, which MUST mirror functions/api/config.ts
   DEFAULTS.flags (guarded by scripts/test-flags.mjs — A14) so behaviour is unchanged when
   /api/config can't be fetched.

   A89: loadFlags() re-wires the client consumer the A33 cutover dropped — App.svelte fetches the
   admin-managed flags at boot and applies them (showBetaAdapters gates the import picker's beta
   adapters, maintenanceBanner shows a banner, betaRibbon shows a header badge). */
export const APP_FLAGS = { showBetaAdapters: true, maintenanceBanner: false, betaRibbon: false };
export type AppFlags = typeof APP_FLAGS;

/** Fetch the admin-managed flags from /api/config, applying only known keys over the APP_FLAGS
 *  defaults. Always resolves (never throws): a 404 (static/local serving), an unbound Worker, or
 *  an offline browser all fall back to the defaults, matching the test-flags.mjs mirror contract. */
export async function loadFlags(): Promise<AppFlags> {
  const out: AppFlags = { ...APP_FLAGS };
  try {
    const r = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    if (!r.ok) return out;
    const d = (await r.json()) as { flags?: Partial<Record<keyof AppFlags, unknown>> };
    const f = d.flags || {};
    for (const k of Object.keys(APP_FLAGS) as (keyof AppFlags)[]) {
      if (k in f) out[k] = !!f[k];
    }
  } catch (_) {
    /* keep defaults */
  }
  return out;
}
