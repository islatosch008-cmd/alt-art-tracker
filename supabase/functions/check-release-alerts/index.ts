// Hourly cron — find sets whose release_date is exactly today+30/7/1/0 days
// out, and for each subscriber whose preferences match, enqueue a release_tN
// notification per their alert_channels. Idempotent via release_alerts_sent.
//
// Subscriber match rules (per spec):
// * user_preferences.release_alerts_enabled = true
// * user_preferences.brands contains the set's brand_id
// * user_preferences.release_alert_days contains the offset (30/7/1/0)
// * not already in release_alerts_sent for (user_id, set_id, alert_type)

import { adminClient } from '../_shared/auth.ts';
import { logApiRequest } from '../_shared/api-log.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';

const OFFSETS = [30, 7, 1, 0] as const;

function dateStrPlusDays(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const admin = adminClient();
  let enqueued = 0;
  let skippedAlreadySent = 0;
  let setsScanned = 0;

  for (const offset of OFFSETS) {
    const target = dateStrPlusDays(offset);
    const alertType = `t${offset}`;

    const { data: sets, error: setsErr } = await admin
      .from('sets')
      .select('id, name, brand_id')
      .eq('release_date', target);
    if (setsErr) return jsonResponse({ ok: false, error: setsErr.message }, 500);

    for (const set of sets ?? []) {
      setsScanned++;

      // Find subscribers who want this brand + this offset.
      const { data: subs, error: subErr } = await admin
        .from('user_preferences')
        .select('user_id, alert_channels, brands, release_alert_days')
        .eq('release_alerts_enabled', true)
        .contains('brands', [set.brand_id])
        .contains('release_alert_days', [offset]);
      if (subErr) return jsonResponse({ ok: false, error: subErr.message }, 500);

      for (const sub of subs ?? []) {
        // Dedup against release_alerts_sent
        const { data: existing } = await admin
          .from('release_alerts_sent')
          .select('id')
          .eq('user_id', sub.user_id)
          .eq('set_id', set.id)
          .eq('alert_type', alertType)
          .maybeSingle();
        if (existing) {
          skippedAlreadySent++;
          continue;
        }

        // Enqueue one row per channel they want.
        const channels: string[] = (sub.alert_channels as string[] | null) ?? ['push'];
        const payload = {
          set_id: set.id,
          set_name: set.name,
          set_brand: set.brand_id,
          days_until: offset,
        };
        const rows = channels.map((channel) => ({
          user_id: sub.user_id,
          type: `release_${alertType}`,
          payload,
          channel,
        }));
        const { error: enqErr } = await admin.from('notification_queue').insert(rows);
        if (enqErr) {
          console.warn(`enqueue failed for ${sub.user_id}/${set.id}: ${enqErr.message}`);
          continue;
        }

        await admin.from('release_alerts_sent').insert({
          user_id: sub.user_id,
          set_id: set.id,
          alert_type: alertType,
        });
        enqueued += rows.length;
      }
    }
  }

  await logApiRequest(admin, {
    source: 'check-release-alerts',
    endpoint: 'hourly',
    statusCode: 200,
    costUnits: enqueued,
  });

  return jsonResponse({
    ok: true,
    sets_scanned: setsScanned,
    rows_enqueued: enqueued,
    skipped_already_sent: skippedAlreadySent,
  });
});
