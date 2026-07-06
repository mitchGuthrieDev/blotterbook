/* Blotterbook · client feature-flag defaults.

   The vanilla view layer that used to live in this file (CSV import, demo data, filters, day-notes
   journal, session restore, setup) was removed in the A33 Svelte cutover — those concerns now live
   in the Svelte app (src/app/) over the pure-logic core. What remains is the client feature-flag
   contract: APP_FLAGS are the offline defaults, which MUST mirror functions/api/config.ts
   DEFAULTS.flags (guarded by scripts/test-flags.mjs — A14) so behaviour is unchanged when
   /api/config can't be fetched.

   A89: loadFlags() re-wires the client consumer the A33 cutover dropped — App.svelte fetches the
   admin-managed flags at boot and applies them (maintenanceBanner shows a banner).

   A245: showBetaAdapters and betaRibbon were retired — no app code ever read either (beta adapters
   always participated in auto-detection regardless of the flag; betaRibbon was superseded by the
   version-based Beta pill in the header). Removed from here, the Admin panel, and the Worker
   DEFAULTS.flags mirror in functions/api/config.ts. */
/* F56 — login-gate switch (staging-only; the owner flips this one constant per R24, and CH16 promotes
   the account gate later). It is deliberately NOT a Worker-mirrored flag: it never appears in
   functions/api/config.ts DEFAULTS.flags and the A14 mirror (scripts/test-flags.mjs) ignores the
   shorthand key below (no `key: value` colon → skipped), so adding it here can't fail the drift gate.
   Exposed on APP_FLAGS for ergonomics (`APP_FLAGS.ACCOUNT_GATE`) AND as this standalone constant — flip
   THIS to arm the gate. accountGateEnabled() also honors a `bb:flags` localStorage override (staging
   testing / manual QA) so the gate can be forced on without a rebuild; the caller still gates on
   isStaging, so prod/demo are never affected. */
export const ACCOUNT_GATE = false;

export const APP_FLAGS = { maintenanceBanner: false, ACCOUNT_GATE };
export type AppFlags = typeof APP_FLAGS;

/** F56: is the login gate armed? True when the ACCOUNT_GATE constant is on, OR a `bb:flags`
 *  localStorage override sets `{ "ACCOUNT_GATE": true }` (e2e/manual, no rebuild). Never throws; the
 *  caller is responsible for the isStaging guard (prod/demo are never gated). */
export function accountGateEnabled(): boolean {
  if (ACCOUNT_GATE) return true;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('bb:flags') : null;
    if (!raw) return false;
    const o = JSON.parse(raw) as Record<string, unknown>;
    return !!o.ACCOUNT_GATE;
  } catch {
    return false;
  }
}

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
