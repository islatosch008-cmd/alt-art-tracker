// Daily cron — find sets whose pre_order_opens_at is exactly today+30/7/1/0
// days out, enqueue a drop_tN notification per matching subscriber's
// alert_channels, dedup via drop_alerts_sent.
//
// Mirrors check-release-alerts but on pre_order_opens_at + drop_alert_days
// + drop_alerts_sent. The two run side-by-side: a set with both fields
// populated will fire BOTH cadences — drop alert when pre-order opens,
// release alert when it ships.

import { adminClient } from '../_shared/auth.ts';
import { logApiRequest } from '../_shared/api-log.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { withSentry } from '../_shared/sentry.ts';

const OFFSETS = [30, 7, 1, 0] as const;

function dateStrPlusDays(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

Deno.serve(
  withSentry('check-drop-alerts', async (req) => {
    const pre = preflight(req);
    if (pre) return pre;

    const admin = adminClient();
    let enqueued = 0;
    let skippedAlreadySent = 0;
    let setsScanned = 0;

    for (const offset of OFFSETS) {
      const target = dateStrPlusDays(offset);
      const alertType = `d${offset}`;

      // pre_order_opens_at is timestamptz; we filter on the date portion.
      // Edge case: same calendar day, different timezones — accept the UTC
      // date since cron also runs in UTC.
      const { data: sets, error: setsErr } = await admin
        .from('sets')
        .select('id, name, brand_id, pre_order_opens_at')
        .gte('pre_order_opens_at', target)
        .lt('pre_order_opens_at', dateStrPlusDays(offset + 1));
      if (setsErr) return jsonResponse({ ok: false, error: setsErr.message }, 500);

      for (const set of sets ?? []) {
        setsScanned++;

        const { data: subs, error: subErr } = await admin
          .from('user_preferences')
          .select('user_id, alert_channels, brands, drop_alert_days')
          .eq('drop_alerts_enabled', true)
          .contains('brands', [set.brand_id])
          .contains('drop_alert_days', [offset]);
        if (subErr) return jsonResponse({ ok: false, error: subErr.message }, 500);

        for (const sub of subs ?? []) {
          const { data: existing } = await admin
            .from('drop_alerts_sent')
            .select('id')
            .eq('user_id', sub.user_id)
            .eq('set_id', set.id)
            .eq('alert_type', alertType)
            .maybeSingle();
          if (existing) {
            skippedAlreadySent++;
            continue;
          }

          const channels: string[] = (sub.alert_channels as string[] | null) ?? ['push'];
          const payload = {
            set_id: set.id,
            set_name: set.name,
            set_brand: set.brand_id,
            days_until: offset,
            pre_order_opens_at: set.pre_order_opens_at,
          };
          const rows = channels.map((channel) => ({
            user_id: sub.user_id,
            type: `drop_${alertType}`,
            payload,
            channel,
          }));
          const { error: enqErr } = await admin.from('notification_queue').insert(rows);
          if (enqErr) {
            console.warn(`drop enqueue failed for ${sub.user_id}/${set.id}: ${enqErr.message}`);
            continue;
          }

          await admin.from('drop_alerts_sent').insert({
            user_id: sub.user_id,
            set_id: set.id,
            alert_type: alertType,
          });
          enqueued += rows.length;
        }
      }
    }

    await logApiRequest(admin, {
      source: 'check-drop-alerts',
      endpoint: 'daily',
      statusCode: 200,
      costUnits: enqueued,
    });

    return jsonResponse({
      ok: true,
      sets_scanned: setsScanned,
      rows_enqueued: enqueued,
      skipped_already_sent: skippedAlreadySent,
    });
  }),
);
