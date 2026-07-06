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
export function recoverEmailBody(link: string): string {
  return `<div style="font-family:sans-serif;max-width:480px">
  <h2>Recover your Blotterbook account</h2>
  <p>Use this link to add a new passkey and sign back in. It expires in 15 minutes and can be used once.</p>
  <p><a href="${link}">Add a passkey &amp; sign in</a></p>
  <p style="color:#888;font-size:12px">If you didn't request this, you can safely ignore it — nothing changes until the link is used.</p>
</div>`;
}
