// Hourly cron — find sets whose release_date is exactly today+30/7/1/0 days
// out, and for each subscriber whose preferences match, enqueue one email
// release_tN notification. Idempotent via release_alerts_sent.
//
// 2.0 sends by email: exactly one channel:'email' row per subscriber per alert.
//
// Subscriber match rules (per spec):
// * user_preferences.release_alerts_enabled = true
// * user_preferences.brands contains the set's brand_id
// * user_preferences.release_alert_days contains the offset (30/7/1/0)
// * not already in release_alerts_sent for (user_id, set_id, alert_type)

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { recordOutcome, type ScrapeOutcome } from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'check-release-alerts';

const OFFSETS = [30, 7, 1, 0] as const;

function dateStrPlusDays(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

Deno.serve(withSentry('check-release-alerts', async (req) => {
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
    if (setsErr) {
      await recordOutcome(admin, SOURCE, {
        kind: 'failure',
        statusCode: 500,
        error: `sets fetch (offset ${offset}): ${setsErr.message}`,
      });
      return jsonResponse({ ok: false, error: setsErr.message }, 500);
    }

    for (const set of sets ?? []) {
      setsScanned++;

      // Find subscribers who want this brand + this offset.
      const { data: subs, error: subErr } = await admin
        .from('user_preferences')
        .select('user_id, brands, release_alert_days')
        .eq('release_alerts_enabled', true)
        .contains('brands', [set.brand_id])
        .contains('release_alert_days', [offset]);
      if (subErr) {
        await recordOutcome(admin, SOURCE, {
          kind: 'failure',
          statusCode: 500,
          error: `user_preferences fetch: ${subErr.message}`,
        });
        return jsonResponse({ ok: false, error: subErr.message }, 500);
      }

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

        // 2.0 sends by email — enqueue exactly one email row per subscriber.
        const payload = {
          set_id: set.id,
          set_name: set.name,
          set_brand: set.brand_id,
          days_until: offset,
        };
        const { error: enqErr } = await admin.from('notification_queue').insert({
          user_id: sub.user_id,
          type: `release_${alertType}`,
          payload,
          channel: 'email',
        });
        if (enqErr) {
          console.warn(`enqueue failed for ${sub.user_id}/${set.id}: ${enqErr.message}`);
          continue;
        }

        await admin.from('release_alerts_sent').insert({
          user_id: sub.user_id,
          set_id: set.id,
          alert_type: alertType,
        });
        enqueued += 1;
      }
    }
  }

  // Always success when we complete the loop without DB errors. "0 alerts
  // today" is normal — a release-alert window only fires when a set's
  // release_date falls exactly on today+30/7/1/0 days. cost_units captures
  // notification rows enqueued so dashboards can correlate cron runs to
  // outbound message volume.
  await recordOutcome(admin, SOURCE, {
    kind: 'success',
    statusCode: 200,
    scraped: enqueued,
  } as ScrapeOutcome);

  return jsonResponse({
    ok: true,
    sets_scanned: setsScanned,
    rows_enqueued: enqueued,
    skipped_already_sent: skippedAlreadySent,
  });
}));
