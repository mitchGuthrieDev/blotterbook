/* THE ARCHIVE FREEZE — server half (2026-07-08; mirror of src/lib/archive.ts, see
   docs/archive-freeze.md). Only the CREATION endpoints check this: new-account registration
   (register-options with an email body + reclaim-send), checkout, and subscription/create answer
   410 `archived` so no one can open an account or start paying for a frozen product. Everything an
   EXISTING user needs stays live: login, /api/me, passkey add/remove, recovery, account delete,
   subscription CANCEL, and the sync transport (their data remains reachable).
   TO REVERT: flip ARCHIVED to false here AND in src/lib/archive.ts (or `git revert` the archive
   commit). */
import { json } from './http.ts';

export const ARCHIVED = true;

/** 410 Gone for a frozen creation path — A326 error shape (human sentence in `error`). */
export function archivedResponse() {
  return json({ error: 'Blotterbook is archived — new accounts and subscriptions are paused.', code: 'archived' }, 410);
}
