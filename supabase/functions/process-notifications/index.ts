// Drain notification_queue. Routes by channel, respects quiet hours, enforces
// the per-user 100/month SMS cap, marks rows sent/skipped/failed.
//
// Run every minute via pg_cron (commit #5). Each invocation handles up to
// BATCH_SIZE pending rows.
//
// Coverage so far:
// * sms via Twilio (live when TWILIO_* env is present, dev-log otherwise)
// * email + push are stubbed and marked 'skipped' until Resend / Expo Push
//   token storage are wired (Resend in Week 4, push token storage TBD).

import { adminClient } from '../_shared/auth.ts';
import { logApiRequest } from '../_shared/api-log.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { withSentry } from '../_shared/sentry.ts';
import { sendSms } from '../_shared/twilio-sms.ts';

const BATCH_SIZE = 50;
const SMS_MONTHLY_CAP = 100;

type Channel = 'sms' | 'push' | 'email';
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

function bodyFor(type: AlertType, payload: Payload): string {
  const stop = ' Reply STOP to unsubscribe.';
  switch (type) {
    case 'release_t30':
      return `${payload.set_name ?? 'Set'} drops in 30 days.${stop}`;
    case 'release_t7':
      return `${payload.set_name ?? 'Set'} drops in 7 days. Pre-orders soon.${stop}`;
    case 'release_t1':
      return `${payload.set_name ?? 'Set'} drops TOMORROW. Pre-orders likely sold out fast.${stop}`;
    case 'release_t0':
      return `${payload.set_name ?? 'Set'} drops today.${stop}`;
    case 'drop_d30':
      return `${payload.set_name ?? 'Pre-orders'} open in 30 days. Set a reminder.${stop}`;
    case 'drop_d7':
      return `${payload.set_name ?? 'Pre-orders'} open in 7 days. Be ready.${stop}`;
    case 'drop_d1':
      return `${payload.set_name ?? 'Pre-orders'} open TOMORROW. Pre-orders sell out fast.${stop}`;
    case 'drop_d0':
      return `${payload.set_name ?? 'Pre-orders'} open TODAY.${stop}`;
    case 'drop_open':
      return `${payload.set_name ?? 'Pre-orders'} OPEN now.${stop}`;
    case 'heating_up':
      return `Heating up: ${payload.card_name ?? 'card'} ${payload.current_price ? `at $${payload.current_price}` : ''}.${stop}`;
    default:
      return `Alt Art Tracker alert.${stop}`;
  }
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

function shouldDeferSms(
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

    if (channel === 'email' || channel === 'push') {
      // Not wired yet — skip cleanly so the row leaves the pending pool.
      await admin
        .from('notification_queue')
        .update({ status: 'skipped', sent_at: new Date().toISOString() })
        .eq('id', row.id);
      skipped++;
      continue;
    }

    if (channel !== 'sms') {
      await admin
        .from('notification_queue')
        .update({ status: 'failed' })
        .eq('id', row.id);
      failed++;
      continue;
    }

    // SMS path.
    const [profileRes, prefsRes] = await Promise.all([
      admin.from('profiles').select('phone_number, phone_verified_at').eq('id', row.user_id).single(),
      admin
        .from('user_preferences')
        .select('quiet_hours_start, quiet_hours_end, timezone, sms_enabled')
        .eq('user_id', row.user_id)
        .single(),
    ]);
    const profile = profileRes.data;
    const prefs = prefsRes.data;

    if (!profile?.phone_number || !profile.phone_verified_at) {
      await admin.from('notification_queue').update({ status: 'skipped' }).eq('id', row.id);
      skipped++;
      continue;
    }
    if (!prefs?.sms_enabled) {
      await admin.from('notification_queue').update({ status: 'skipped' }).eq('id', row.id);
      skipped++;
      continue;
    }

    if (shouldDeferSms(type, prefs)) {
      // Push to ~1h later. Drains will re-pick once we exit quiet hours.
      const next = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      await admin
        .from('notification_queue')
        .update({ scheduled_for: next })
        .eq('id', row.id);
      deferred++;
      continue;
    }

    // Monthly SMS cap.
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const { count: smsThisMonth } = await admin
      .from('notification_queue')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', row.user_id)
      .eq('channel', 'sms')
      .eq('status', 'sent')
      .gte('sent_at', monthStart.toISOString());

    if ((smsThisMonth ?? 0) >= SMS_MONTHLY_CAP) {
      await admin
        .from('notification_queue')
        .update({ status: 'skipped' })
        .eq('id', row.id);
      skipped++;
      continue;
    }

    const result = await sendSms(profile.phone_number, bodyFor(type, payload));
    if (result.ok) {
      await admin
        .from('notification_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', row.id);
      sent++;
    } else {
      console.warn(`sms failed for queue ${row.id}: ${result.error}`);
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
