/* THE ARCHIVE FREEZE (2026-07-08 — docs/archive-freeze.md).
   Blotterbook is archived as a frozen, local-only app: the owner is re-platforming the SaaS idea on
   a conventional client→server architecture, so NEW accounts, subscriptions, and cloud sync are
   paused here — but nothing is deleted. Every account/subscription/sync touchpoint in the UI (and
   the three creation endpoints server-side, via functions/_lib/archive.ts) branches on this ONE
   constant so the whole product can be thawed later.

   TO REVERT: flip ARCHIVED to false here AND in functions/_lib/archive.ts, then restore the e2e
   expectations — or simply `git revert` the archive commit. The full touchpoint inventory lives in
   docs/archive-freeze.md. Existing accounts keep working (login / cancel / data access); only
   CREATION paths are frozen. */

/** Master freeze switch — gates every account/subscription/sync affordance in the app AND site. */
export const ARCHIVED = true;

/** The one user-facing explanation, shown as a note/tooltip wherever a control is frozen. */
export const ARCHIVE_NOTE =
  'Blotterbook is archived — new accounts, subscriptions, and cloud sync are paused. Everything local keeps working, free, right here in your browser.';
