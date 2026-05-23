-- ============================================================================
-- Alt Art Tracker 2.0 — ai_research cadence: monthly -> every 2 weeks
-- ============================================================================
-- Per Ian: run the TCG release-research agent every two weeks instead of
-- once a month. Cron can't express a true rolling 14-day interval, so we use
-- the 1st and 15th of each month (~2-week spacing), 09:00 UTC.
--
-- pg_cron's cron.schedule() upserts by job name, so re-scheduling 'ai_research'
-- here replaces the prior monthly schedule (20260512100100) rather than
-- creating a duplicate. Invoke body copied verbatim. Prior migration files are
-- intentionally left untouched.
--
-- Cron format: m h dom mon dow. '0 9 1,15 * *' = 09:00 UTC on the 1st and 15th.
-- Cost: ~2 runs/month at ~$1.50/run (the in-function $5/run guard still applies).
-- ============================================================================

select cron.schedule(
  'ai_research',
  '0 9 1,15 * *',
  $$ select public.invoke_function('ai-research-releases'); $$
);
