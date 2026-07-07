/**
 * POST /api/notify-changelog — broadcast the latest changelog release to confirmed subscribers (F44).
 *
 * Called ONLY by the send-trigger workflow (.github/workflows/changelog-email.yml), which fires on a
 * push to main touching static/data/changelog.json. Auth is a shared secret (CHANGELOG_NOTIFY_SECRET,
 * GH secret ↔ Pages env var) compared in constant time — a real control (S22), not the fail-open
 * limiter. An optional `?version=<v>` query param is a deploy-freshness gate: if the live changelog's
 * top release isn't yet `<v>`, the Function returns 425 (the new commit hasn't finished deploying) so
 * the caller can retry — never sending a stale version. The Function reads /data/changelog.json, takes
 * the top prod release, and:
 *   - dedupes against the `changelog_sends` ledger (a re-run / second push never double-sends);
 *   - fans out to CONFIRMED subscribers only, each with a per-recipient one-click unsubscribe link +
 *     List-Unsubscribe(-Post) headers, batched under the A15 50-subrequest cap (sendEmailBatch).
 *
 * Fail closed: 503 when CHANGELOG_NOTIFY_SECRET is unbound (endpoint disabled); 401 on a bad secret;
 * 503 (ACCOUNTS_DB shape) when the DB is unbound; 503 { error:'email unavailable' } when RESEND is
 * unbound. Content is changelog text only — never trade data (A141).
 *
 * A315: the send trigger invokes this endpoint at the bare `<project>.pages.dev` origin, not
 * `blotterbook.com` — that hostname is Cloudflare's own zone, so the custom domain's Bot Fight Mode /
 * Managed Challenge never sees the request. The internal changelog.json read below stays on the
 * REQUEST origin (it's the same deployment either way). User-facing links must NOT follow — they use
 * `env.PUBLIC_ORIGIN` when set (falls back to the request origin otherwise) so a subscriber's inbox
 * always shows blotterbook.com, never the pages.dev host. `releaseEmail()`'s "full changelog" link is
 * already hardcoded to https://blotterbook.com/changelog.html; only the unsubscribe URL is derived
 * here, so it's the only link this env var affects.
 */
import { json } from '../_lib/http.ts';
import type { Ctx } from '../_lib/types.ts';
import { dbUnavailable, getDb } from '../_lib/accounts.ts';
import { confirmedSubscribers, constantTimeEqual, purgePending, recordSend, rotateUnsubToken, sendLedgerFor } from '../_lib/subscribers.ts';
import { emailUnavailable, releaseEmail, sendEmailBatch, type BatchMessage } from '../_lib/email.ts';

interface ReleaseJson {
  version: string;
  date?: string;
  title: string;
  summary?: string;
  beta?: boolean;
  highlights?: string[];
}

export async function onRequestPost(ctx: Ctx) {
  const { request, env } = ctx;

  // --- auth: shared secret, constant-time (S22 — a real control, not the fail-open limiter) ---
  if (!env.CHANGELOG_NOTIFY_SECRET) return json({ error: 'Changelog notifications are not configured on this deployment.' }, 503);
  const presented = request.headers.get('x-changelog-secret') || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!presented || !(await constantTimeEqual(presented, env.CHANGELOG_NOTIFY_SECRET))) return json({ error: 'Unauthorized.' }, 401);

  const db = getDb(env);
  if (!db) return dbUnavailable();
  if (!env.RESEND_API_KEY) return emailUnavailable();

  // --- load the changelog + take the top prod release ---
  const origin = new URL(request.url).origin; // internal fetch — same deployment regardless of host
  const publicOrigin = env.PUBLIC_ORIGIN || origin; // user-facing links — always the branded origin
  let release: ReleaseJson | null;
  try {
    const res = await fetch(`${origin}/data/changelog.json`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return json({ error: 'Could not read the changelog.' }, 502);
    const data = (await res.json()) as { releases?: ReleaseJson[] };
    release = Array.isArray(data.releases) && data.releases.length ? data.releases[0] : null;
  } catch (_) {
    return json({ error: 'Could not read the changelog.' }, 502);
  }
  if (!release || !release.version || !release.title) return json({ error: 'No release to send.' }, 400);

  // --- deploy-freshness gate: the trigger workflow passes ?version=<the version it just committed>.
  // Until Cloudflare Pages has rolled out that commit, this Function (and the changelog.json it reads)
  // still serve the PREVIOUS release — so answer 425 "Too Early" and let the caller retry, rather than
  // broadcasting the wrong (stale) version. This replaces the workflow's old, challenge-prone client
  // poll of the static /data/changelog.json with a single authenticated path. Omitted → no gate. ---
  const expected = new URL(request.url).searchParams.get('version');
  if (expected && release.version !== expected) {
    return json({ error: 'deploy-not-live', expected, live: release.version }, 425);
  }

  // --- idempotency: never re-send a version already broadcast ---
  if (await sendLedgerFor(db, release.version)) return json({ ok: true, deduped: true, version: release.version });

  await purgePending(db); // housekeeping while we're here

  const recipients = await confirmedSubscribers(db);
  const messages: BatchMessage[] = [];
  for (const sub of recipients) {
    const unsubToken = await rotateUnsubToken(db, sub); // fresh working one-click secret for this send
    const unsubUrl = `${publicOrigin}/api/unsubscribe?token=${encodeURIComponent(unsubToken)}`;
    const { subject, html, text } = releaseEmail(release, unsubUrl);
    messages.push({
      to: sub.email,
      subject,
      html,
      text,
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
  }

  let result = { ok: true, sent: 0, failed: 0, unavailable: false as boolean | undefined };
  if (messages.length) {
    const r = await sendEmailBatch(env, messages);
    if (r.unavailable) return emailUnavailable();
    result = { ok: r.ok, sent: r.sent, failed: r.failed, unavailable: r.unavailable };
  }

  // Record the send so it is never repeated — even a 0-recipient send is ledgered (idempotent).
  await recordSend(db, release.version, result.sent);
  return json({ ok: result.ok, version: release.version, recipients: recipients.length, sent: result.sent, failed: result.failed });
}
