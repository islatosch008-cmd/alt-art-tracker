-- ============================================================================
-- Alt Art Tracker 2.0 — Phase 2 (Trending rebuild)
-- ============================================================================
-- Unschedule the v1 compute-popularity-scores cron job.
--
-- The Edge Function supabase/functions/compute-popularity-scores/ is
-- deleted in Phase 2; its hourly cron (scheduled in
-- 20260506163400_schedule_cron_jobs.sql under the EXACT job name
-- 'compute-popularity-scores', '15 * * * *') would otherwise keep firing
-- net.http_post at a now-404 endpoint every hour.
--
-- cron.unschedule() raises if the job is absent — wrap in a DO block that
-- swallows the exception so this migration is safe to re-run and safe on
-- environments where the job was never scheduled.
--
-- The replacement schedules (fetch-justtcg, compute-trending) land in the
-- next migration, 20260513000400_schedule_justtcg_and_trending.sql.
-- ============================================================================

do $$
begin
  perform cron.unschedule('compute-popularity-scores');
exception
  when others then null;
end $$;
