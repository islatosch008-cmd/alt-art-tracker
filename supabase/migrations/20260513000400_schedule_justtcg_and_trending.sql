-- ============================================================================
-- Alt Art Tracker 2.0 — Phase 2 (JustTCG integration + Trending rebuild)
-- ============================================================================
-- Schedule the two new Phase 2 Edge Functions, replacing the unscheduled
-- v1 compute-popularity-scores cron (see 20260513000300).
--
-- Uses the public.invoke_function(fname, body) cron helper — the same
-- pattern as 20260509080100_schedule_scrape_ebay_active_tiered.sql.
-- pg_cron's cron.schedule() upserts by job name, so re-running this
-- migration replaces the schedules rather than duplicating them.
--
-- Cron format: m h dom mon dow (5-field). pg_cron runs in UTC.
--
-- ── fetch-justtcg ───────────────────────────────────────────────────────
-- JustTCG free tier: 1,000 req/month, 100/day, 10/min. fetch-justtcg
-- considers CARDS_PER_RUN=200 cards/run, batched at JUSTTCG_BATCH_SIZE=20
-- => at most 10 POST /cards requests per run. The function ALSO enforces
-- a DAILY_REQUEST_CEILING=90 budget guard in code (counts today's
-- requests in api_request_log), so even a misconfigured schedule cannot
-- breach the daily limit.
--
-- Schedule: 3×/day, every 8 hours at :20.
--   Worst-case usage: 3 runs × 10 requests = 30 req/day   (< 90 ceiling)
--   Worst-case month: 30 × 30 = 900 req/month             (< 1,000 tier)
--   This respects BOTH the 100/day and 1,000/month free-tier limits even
--   in the worst case. In practice most runs use far fewer than 10 full
--   batches (the catalog is partially resolved and unresolvable cards are
--   skipped), so real usage sits well below 900/month. The in-code
--   DAILY_REQUEST_CEILING=90 guard is the hard backstop. The :20 offset
--   avoids the :00/:15/:30/:40 slots already used by other crons.
--   NOTE FOR OVERSEER: bump to every 4h once real usage is observed and
--   confirmed to leave monthly headroom.
--
-- ── compute-trending ────────────────────────────────────────────────────
-- Pure DB compute (no external API), cheap. A few times daily is enough
-- for the Trending tab. Scheduled 4×/day at :50, offset from fetch-
-- justtcg's :20 so trending scores are recomputed AFTER fresh snapshots
-- land.
-- ============================================================================

-- fetch-justtcg — every 8 hours at :20 (00:20, 08:20, 16:20 UTC).
select cron.schedule(
  'fetch-justtcg',
  '20 0,8,16 * * *',
  $$ select public.invoke_function('fetch-justtcg'); $$
);

-- compute-trending — 4×/day at :50 (02:50, 08:50, 14:50, 20:50 UTC),
-- each ~30 min after a fetch-justtcg run so it scores fresh snapshots.
select cron.schedule(
  'compute-trending',
  '50 2,8,14,20 * * *',
  $$ select public.invoke_function('compute-trending'); $$
);
