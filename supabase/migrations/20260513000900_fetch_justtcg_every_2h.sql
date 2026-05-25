-- ============================================================================
-- Alt Art Tracker 2.0 — bump fetch-justtcg to full free quota
-- ============================================================================
-- Reschedule the fetch-justtcg cron from 3×/day (every 8h) to every 2 hours.
--
-- WHY
-- ===
-- The card catalog is ~23K cards but JustTCG's free tier only allows ~2K
-- lookups/day. We now (a) prioritise pricing the cards that matter most —
-- newest / upcoming-set cards first (see fetch-justtcg/index.ts SELECT) —
-- and (b) run the fetch at full free quota so we actually spend the daily
-- allowance on those priority cards instead of leaving it on the table.
--
-- Every 2 hours = up to 12 runs/day. The in-code DAILY_REQUEST_CEILING=90
-- guard (counts today's POST /cards calls in api_request_log) is unchanged
-- and still the hard backstop: it caps total daily requests under JustTCG's
-- 100/day free-tier limit, so the extra runs simply no-op once the daily
-- budget is spent (the function returns skipped:'daily_budget_exhausted').
-- The :20 offset is preserved to avoid the :00/:15/:30/:40/:50 slots used
-- by other crons (incl. compute-trending at :50).
--
-- pg_cron's cron.schedule() upserts by job NAME, so re-using the exact
-- existing name 'fetch-justtcg' REPLACES the schedule in place — no
-- duplicate job is created. Job name + invoke body are copied verbatim
-- from 20260513000400_schedule_justtcg_and_trending.sql.
--
-- Cron format: m h dom mon dow (5-field). pg_cron runs in UTC.
-- This migration does NOT touch the compute-trending schedule.
-- ============================================================================

-- fetch-justtcg — every 2 hours at :20 (00:20, 02:20, 04:20, ... UTC).
select cron.schedule(
  'fetch-justtcg',
  '20 */2 * * *',
  $$ select public.invoke_function('fetch-justtcg'); $$
);
