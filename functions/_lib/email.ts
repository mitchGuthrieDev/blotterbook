/* Transactional email helper (Accounts Phase 3 — F55). ONE sender the account endpoints call to
   deliver the verify + recovery magic links. Uses the Resend REST API via fetch() — NO SDK (the
   Workers runtime + our CSP/dependency posture keep third-party SDKs out).

   Fail-closed: when env.RESEND_API_KEY is unbound, sendEmail() returns { ok:false, unavailable:true }
   WITHOUT making a network call, and endpoints translate that to a clean 503 { error: 'email
   unavailable' } (never a crash). A network/API failure returns { ok:false } (no `unavailable`).

   GUARDRAIL (S25): only account identity flows through here (an email address + a link) — never any
   trade data. Exports helpers only (no onRequest), so this file is never served as a route. */
import type { Env } from './types.ts';
import { json } from './http.ts';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}
export interface SendEmailResult {
  ok: boolean;
  /** true ⇒ email is not configured on this deployment (RESEND_API_KEY unbound) → caller 503s. */
  unavailable?: boolean;
  status?: number;
}

const DEFAULT_FROM = 'Blotterbook <no-reply@blotterbook.com>';

export async function sendEmail(env: Env, msg: SendEmailArgs): Promise<SendEmailResult> {
  if (!env.RESEND_API_KEY) return { ok: false, unavailable: true }; // fail closed — no key, no send
  const from = env.EMAIL_FROM || DEFAULT_FROM;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, html: msg.html, ...(msg.text ? { text: msg.text } : {}) }),
    });
    return { ok: res.ok, status: res.status };
  } catch (_) {
    return { ok: false }; // transient/network — not a config problem, so no `unavailable`
  }
}

/* ---- batch send (F44 changelog broadcast) ------------------------------------------------------
   The changelog send fans out to many recipients, each with a PER-RECIPIENT unsubscribe link +
   List-Unsubscribe(-Post) headers — so it can't be one shared message. Resend's batch endpoint takes
   up to 100 distinct messages per call, so a 1k-recipient send is ~10 subrequests, well inside the
   A15 50-subrequest free-tier cap. Same fail-closed posture as sendEmail (unbound key ⇒ unavailable).
   Each message may carry per-recipient `headers` (List-Unsubscribe etc.). */
export interface BatchMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}
export interface SendBatchResult {
  ok: boolean;
  unavailable?: boolean;
  sent: number; // messages accepted into batch calls that returned ok
  failed: number;
}

const BATCH_CHUNK = 100; // Resend batch cap per call

export async function sendEmailBatch(env: Env, messages: BatchMessage[]): Promise<SendBatchResult> {
  if (!env.RESEND_API_KEY) return { ok: false, unavailable: true, sent: 0, failed: messages.length };
  const from = env.EMAIL_FROM || DEFAULT_FROM;
  let sent = 0;
  let failed = 0;
  let ok = true;
  for (let i = 0; i < messages.length; i += BATCH_CHUNK) {
    const chunk = messages.slice(i, i + BATCH_CHUNK).map(m => ({
      from,
      to: [m.to],
      subject: m.subject,
      html: m.html,
      ...(m.text ? { text: m.text } : {}),
      ...(m.headers ? { headers: m.headers } : {}),
    }));
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      });
      if (res.ok) sent += chunk.length;
      else {
        failed += chunk.length;
        ok = false;
      }
    } catch (_) {
      failed += chunk.length;
      ok = false;
    }
  }
  return { ok, sent, failed };
}

/** The clean 503 an endpoint returns when RESEND_API_KEY is unbound (email not configured). */
export function emailUnavailable() {
  return json({ error: 'email unavailable' }, 503);
}

/* ---- minimal HTML bodies (inline styles are fine in EMAIL — not the app's CSP surface) ---- */
export function verifyEmailBody(link: string): string {
  return `<div style="font-family:sans-serif;max-width:480px">
  <h2>Verify your Blotterbook email</h2>
  <p>Confirm this address so you can recover your account and link supporter status. This link expires in 15 minutes and can be used once.</p>
  <p><a href="${link}">Verify my email</a></p>
  <p style="color:#888;font-size:12px">If you didn't create a Blotterbook account, ignore this email.</p>
</div>`;
}
/** A316: proven-ownership reclaim of an email squatted by a never-verified account. */
export function reclaimEmailBody(link: string): string {
  return `<div style="font-family:sans-serif;max-width:480px">
  <h2>Reclaim your email for Blotterbook</h2>
  <p>Someone registered a Blotterbook account with this address but never verified it. If that wasn't you, use this link to reclaim the address and finish creating your own account. It expires in 15 minutes and can be used once.</p>
  <p><a href="${link}">Reclaim this email &amp; create my account</a></p>
  <p style="color:#888;font-size:12px">If you didn't try to sign up for Blotterbook, you can safely ignore this — nothing changes until the link is used.</p>
</div>`;
}
export function recoverEmailBody(link: string): string {
  return `<div style="font-family:sans-serif;max-width:480px">
  <h2>Recover your Blotterbook account</h2>
  <p>Use this link to add a new passkey and sign back in. It expires in 15 minutes and can be used once.</p>
  <p><a href="${link}">Add a passkey &amp; sign in</a></p>
  <p style="color:#888;font-size:12px">If you didn't request this, you can safely ignore it — nothing changes until the link is used.</p>
</div>`;
}

/* ---- F44 changelog-email bodies ----------------------------------------------------------------
   Minimal HTML (inline styles are fine in EMAIL — not the app's CSP surface). Content is changelog
   text only (title/summary/highlights) — never trade data (A141). escHtml() keeps interpolated
   changelog strings from breaking the markup. */
function escHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function confirmSubscriptionBody(link: string): string {
  return `<div style="font-family:sans-serif;max-width:480px">
  <h2>Confirm your Blotterbook updates</h2>
  <p>Confirm this address to get an email whenever a new version of Blotterbook ships — release notes only, nothing else. This link expires in 7 days.</p>
  <p><a href="${link}">Confirm my subscription</a></p>
  <p style="color:#888;font-size:12px">If you didn't ask for this, ignore this email — you won't be subscribed and the address is auto-removed in 7 days.</p>
</div>`;
}

export interface ReleaseEmail {
  version: string;
  date?: string;
  title: string;
  summary?: string;
  highlights?: string[];
}

/** Render one release into { subject, html, text } for a broadcast. `unsubUrl` is per-recipient. */
export function releaseEmail(rel: ReleaseEmail, unsubUrl: string): { subject: string; html: string; text: string } {
  const subject = `Blotterbook ${rel.version} — ${rel.title}`;
  const highlights = (rel.highlights ?? []).filter(h => typeof h === 'string' && h.trim());
  const htmlHighlights = highlights.length ? `<ul>${highlights.map(h => `<li>${escHtml(h)}</li>`).join('')}</ul>` : '';
  const html = `<div style="font-family:sans-serif;max-width:560px">
  <p style="color:#888;font-size:12px;margin:0 0 4px">Blotterbook release notes</p>
  <h2 style="margin:0 0 8px">${escHtml(rel.title)}</h2>
  <p style="color:#888;font-size:13px;margin:0 0 12px">Version ${escHtml(rel.version)}${rel.date ? ` · ${escHtml(rel.date)}` : ''}</p>
  ${rel.summary ? `<p>${escHtml(rel.summary)}</p>` : ''}
  ${htmlHighlights}
  <p style="margin-top:20px"><a href="https://blotterbook.com/changelog.html">See the full changelog</a></p>
  <hr style="border:none;border-top:1px solid #ddd;margin:24px 0 12px">
  <p style="color:#888;font-size:12px">You're getting this because you subscribed to Blotterbook release notes. <a href="${unsubUrl}">Unsubscribe</a> — one click, no login.</p>
</div>`;
  const textHighlights = highlights.length ? '\n' + highlights.map(h => `  - ${h}`).join('\n') : '';
  const text = `Blotterbook ${rel.version} — ${rel.title}
${rel.date ? rel.date + '\n' : ''}${rel.summary ? '\n' + rel.summary + '\n' : ''}${textHighlights}

Full changelog: https://blotterbook.com/changelog.html

Unsubscribe (one click, no login): ${unsubUrl}`;
  return { subject, html, text };
}
