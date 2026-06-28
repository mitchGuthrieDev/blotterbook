/* Blotterbook · client feature-flag defaults.

   The vanilla view layer that used to live in this file (CSV import, demo data, filters, day-notes
   journal, session restore, setup) was removed in the A33 Svelte cutover — those concerns now live
   in the Svelte app (app/staging-svelte/) over the pure-logic core. What remains is the client
   APP_FLAGS contract: these defaults MUST mirror functions/api/config.ts DEFAULTS.flags (guarded by
   scripts/test-flags.mjs — A14) so behaviour is unchanged when /api/config can't be fetched. */
export const APP_FLAGS = { showBetaAdapters: true, maintenanceBanner: false, betaRibbon: false };
export const flag = (k: keyof typeof APP_FLAGS) => !!APP_FLAGS[k];
