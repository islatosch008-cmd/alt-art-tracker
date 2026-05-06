// Once-a-day backend chores:
//   1. maintain_monthly_partitions  → creates next-month partitions for
//      price_history + volume_history before they're needed.
//   2. recompute_30d_baselines      → updates cards.baseline_30d_price
//      + cards.baseline_30d_volume from price_history / volume_history.
//
// Both are pure SQL and live as Postgres functions (see
// 20260506162806_daily_maintenance_functions.sql). This Edge Function
// is the cron-callable entry point. Run it once a day via pg_cron once
// that's enabled.

import { adminClient } from '../_shared/auth.ts';
import { logApiRequest } from '../_shared/api-log.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const admin = adminClient();

  const { data: partitionsAdded, error: partErr } = await admin.rpc(
    'maintain_monthly_partitions',
  );
  if (partErr) return jsonResponse({ ok: false, step: 'partitions', error: partErr.message }, 500);

  const { data: baselinesUpdated, error: baseErr } = await admin.rpc(
    'recompute_30d_baselines',
  );
  if (baseErr) return jsonResponse({ ok: false, step: 'baselines', error: baseErr.message }, 500);

  await logApiRequest(admin, {
    source: 'daily-maintenance',
    endpoint: 'rpc',
    statusCode: 200,
    costUnits: 1,
  });

  return jsonResponse({
    ok: true,
    partitions_added: partitionsAdded ?? [],
    baselines_updated: baselinesUpdated ?? 0,
  });
});
