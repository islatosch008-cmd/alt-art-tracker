// Drain notification_queue. Respects quiet hours, marks rows sent/skipped/
// failed.
//
// Run every minute via pg_cron. Each invocation handles up to BATCH_SIZE
// pending rows.
//
// 2.0 sends every queued reminder by EMAIL (Gmail SMTP, live when GMAIL_* env
// is present, dev-log otherwise). Twilio is stuck on trial; email is free so
// there's no monthly cap. Any row with a non-'email' channel is treated as
// malformed and marked 'failed'.

import { adminClient } from '../_shared/auth.ts';
import { logApiRequest } from '../_shared/api-log.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { withSentry } from '../_shared/sentry.ts';
import { sendEmail } from '../_shared/email.ts';

const BATCH_SIZE = 50;

type Channel = 'email';
type AlertType =
  | 'release_t30'
  | 'release_t7'
  | 'release_t1'
  | 'release_t0'
  | 'drop_d30'
  | 'drop_d7'
  | 'drop_d1'
  | 'drop_d0'
  | 'drop_open'
  | 'heating_up'
  | 'trending';

type Payload = Record<string, unknown> & {
  set_name?: string;
  set_brand?: string;
  card_name?: string;
  current_price?: number;
  days_until?: number;
};

// Plain-text body for the email (also reused as the fallback text part).
function bodyFor(type: AlertType, payload: Payload): string {
  switch (type) {
    case 'release_t30':
      return `${payload.set_name ?? 'Set'} drops in 30 days.`;
    case 'release_t7':
      return `${payload.set_name ?? 'Set'} drops in 7 days. Pre-orders soon.`;
    case 'release_t1':
      return `${payload.set_name ?? 'Set'} drops TOMORROW. Pre-orders likely sold out fast.`;
    case 'release_t0':
      return `${payload.set_name ?? 'Set'} drops today.`;
    case 'drop_d30':
      return `${payload.set_name ?? 'Pre-orders'} open in 30 days. Set a reminder.`;
    case 'drop_d7':
      return `${payload.set_name ?? 'Pre-orders'} open in 7 days. Be ready.`;
    case 'drop_d1':
      return `${payload.set_name ?? 'Pre-orders'} open TOMORROW. Pre-orders sell out fast.`;
    case 'drop_d0':
      return `${payload.set_name ?? 'Pre-orders'} open TODAY.`;
    case 'drop_open':
      return `${payload.set_name ?? 'Pre-orders'} OPEN now.`;
    case 'heating_up':
      return `Heating up: ${payload.card_name ?? 'card'} ${payload.current_price ? `at $${payload.current_price}` : ''}.`;
    default:
      return `Alt Art Tracker alert.`;
  }
}

// Email subject line per alert type.
function subjectFor(type: AlertType, payload: Payload): string {
  const set = payload.set_name ?? 'Set';
  switch (type) {
    case 'release_t30':
      return `${set} drops in 30 days`;
    case 'release_t7':
      return `${set} drops in 7 days`;
    case 'release_t1':
      return `${set} drops tomorrow`;
    case 'release_t0':
      return `${set} drops today`;
    case 'drop_d30':
      return `${payload.set_name ?? 'Pre-orders'} open in 30 days`;
    case 'drop_d7':
      return `${payload.set_name ?? 'Pre-orders'} open in 7 days`;
    case 'drop_d1':
      return `${payload.set_name ?? 'Pre-orders'} open tomorrow`;
    case 'drop_d0':
      return `${payload.set_name ?? 'Pre-orders'} open today`;
    case 'drop_open':
      return `${payload.set_name ?? 'Pre-orders'} are open now`;
    case 'heating_up':
      return `Heating up: ${payload.card_name ?? 'a card'}`;
    default:
      return 'Alt Art Tracker alert';
  }
}

// "Why am I getting this?" footer line, by alert family.
function reasonFor(type: AlertType): string {
  if (type.startsWith('drop_')) {
    return "You're getting this because you enabled drop reminders.";
  }
  if (type.startsWith('release_')) {
    return "You're getting this because you enabled release reminders.";
  }
  return "You're getting this because you enabled Alt Art Tracker alerts.";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Simple branded HTML wrapper: dark header, the message, the reason footer.
function htmlFor(type: AlertType, text: string): string {
  const message = escapeHtml(text);
  const reason = escapeHtml(reasonFor(type));
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#0e0f13;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0e0f13;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#16181d;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#0a0b0e;padding:20px 24px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:0.3px;">Alt Art Tracker</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 24px;">
                <p style="margin:0;color:#f4f5f7;font-size:18px;line-height:1.5;font-weight:600;">${message}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 24px 28px;">
                <p style="margin:0;color:#8a8f99;font-size:13px;line-height:1.5;">${reason}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// Convert "now" into the user's local time-of-day, as minutes-since-midnight.
function localMinutes(timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const h = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10);
  return h * 60 + m;
}

function timeStringToMinutes(t: string): number {
  // input like "22:00:00"
  const [h, m] = t.split(':').map((x) => parseInt(x, 10));
  return h * 60 + m;
}

function inQuietHours(start: string | null, end: string | null, tz: string): boolean {
  if (!start || !end) return false;
  const now = localMinutes(tz);
  const s = timeStringToMinutes(start);
  const e = timeStringToMinutes(end);
  // Window may cross midnight (e.g. 22:00 → 07:00). Two cases:
  return s <= e ? now >= s && now < e : now >= s || now < e;
}

function shouldDefer(
  type: AlertType,
  prefs: { quiet_hours_start: string | null; quiet_hours_end: string | null; timezone: string | null },
): boolean {
  if (type === 'drop_open') return false; // critical, override
  return inQuietHours(
    prefs.quiet_hours_start,
    prefs.quiet_hours_end,
    prefs.timezone ?? 'America/Chicago',
  );
}

Deno.serve(withSentry('process-notifications', async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const admin = adminClient();

  // Pull a batch of due-or-overdue pending notifications.
  const { data: queue, error: qErr } = await admin
    .from('notification_queue')
    .select('id, user_id, type, payload, channel')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(BATCH_SIZE);
  if (qErr) return jsonResponse({ ok: false, error: qErr.message }, 500);

  let sent = 0;
  let deferred = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of queue ?? []) {
    const channel = row.channel as Channel;
    const type = row.type as AlertType;
    const payload = (row.payload ?? {}) as Payload;

    // 2.0 is email-only. Anything else is a malformed row — fail it so it
    // leaves the pending pool and is visible in failure counts.
    if (channel !== 'email') {
      await admin
        .from('notification_queue')
        .update({ status: 'failed' })
        .eq('id', row.id);
      failed++;
      continue;
    }

    // Recipient email lives on the auth user, not profiles.
    const [userRes, prefsRes] = await Promise.all([
      admin.auth.admin.getUserById(row.user_id),
      admin
        .from('user_preferences')
        .select('quiet_hours_start, quiet_hours_end, timezone, email_enabled')
        .eq('user_id', row.user_id)
        .single(),
    ]);
    const email = userRes.data?.user?.email ?? null;
    const prefs = prefsRes.data;

    if (!email) {
      await admin.from('notification_queue').update({ status: 'skipped' }).eq('id', row.id);
      skipped++;
      continue;
    }
    // Master email toggle. The per-type gate already ran at enqueue time.
    if (!prefs?.email_enabled) {
      await admin.from('notification_queue').update({ status: 'skipped' }).eq('id', row.id);
      skipped++;
      continue;
    }

    if (
      prefs &&
      shouldDefer(type, prefs)
    ) {
      // Push to ~1h later. Drains will re-pick once we exit quiet hours.
      const next = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await admin
        .from('notification_queue')
        .update({ scheduled_for: next })
        .eq('id', row.id);
      deferred++;
      continue;
    }

    const text = bodyFor(type, payload);
    const subject = subjectFor(type, payload);
    const html = htmlFor(type, text);
    const result = await sendEmail(email, subject, html, text);
    if (result.ok) {
      await admin
        .from('notification_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', row.id);
      sent++;
    } else {
      console.warn(`email failed for queue ${row.id}: ${result.error}`);
      await admin
        .from('notification_queue')
        .update({ status: 'failed' })
        .eq('id', row.id);
      failed++;
    }
  }

  await logApiRequest(admin, {
    source: 'notifications',
    endpoint: 'drain',
    statusCode: 200,
    costUnits: sent,
  });

  return jsonResponse({
    ok: true,
    pulled: queue?.length ?? 0,
    sent,
    deferred,
    skipped,
    failed,
  });
}));
