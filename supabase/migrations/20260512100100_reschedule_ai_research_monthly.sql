-- ============================================================================
-- Alt Art Tracker 2.0 — Phase 3 (Release calendar / TCG coverage)
-- ============================================================================
-- Re-schedule the ai_research agent from weekly to monthly.
--
-- It was scheduled weekly (Sundays 09:00 UTC) in
-- 20260506222745_schedule_ai_research.sql. For the 2.0 TCG release calendar a
-- monthly cadence is sufficient. pg_cron's cron.schedule() upserts by job
-- name, so re-scheduling 'ai_research' here replaces the existing schedule
-- rather than creating a duplicate job.
--
-- Cron format: m h dom mon dow. '0 9 1 * *' = 09:00 UTC on the 1st of every
-- month. The invoke body is copied verbatim from the original migration.
-- The original migration file is intentionally left untouched.
-- ============================================================================

select cron.schedule(
  'ai_research',
  '0 9 1 * *',
  $$ select public.invoke_function('ai-research-releases'); $$
);
