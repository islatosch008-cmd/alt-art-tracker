// Gmail SMTP sender (drop/release reminders moved off SMS in 2.0 — Twilio is
// stuck on trial, email is unblocked). Same dev-mode fallback pattern as
// _shared/twilio-sms.ts: when GMAIL_* env is missing we log instead of
// sending so the queue drain can still be exercised end-to-end.
//
// Uses denomailer (pinned) over SMTP+TLS on smtp.gmail.com:465. NOTE: opening
// a raw SMTP socket from a Supabase Edge Function is unproven here — if Deno's
// outbound socket is blocked or Gmail rejects the app password, swap this for
// an HTTP-based provider (e.g. Resend) behind the same sendEmail() signature.

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';

const GMAIL_USER = Deno.env.get('GMAIL_USER');
const GMAIL_APP_PASSWORD = Deno.env.get('GMAIL_APP_PASSWORD');

export const EMAIL_LIVE = Boolean(GMAIL_USER && GMAIL_APP_PASSWORD);

export type EmailResult =
  | { ok: true; mode: 'live' | 'dev' }
  | { ok: false; error: string };

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<EmailResult> {
  if (!EMAIL_LIVE) {
    console.log(`[email:dev] → ${to}: ${subject}`);
    return { ok: true, mode: 'dev' };
  }

  let client: SMTPClient | null = null;
  try {
    client = new SMTPClient({
      connection: {
        hostname: 'smtp.gmail.com',
        port: 465,
        tls: true,
        auth: {
          username: GMAIL_USER!,
          password: GMAIL_APP_PASSWORD!,
        },
      },
    });

    await client.send({
      from: GMAIL_USER!,
      to,
      subject,
      content: text ?? subject,
      html,
    });

    return { ok: true, mode: 'live' };
  } catch (e) {
    return { ok: false, error: (e as Error).message ?? String(e) };
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        /* swallow — connection already torn down */
      }
    }
  }
}
