-- Replace the single uniform scrape-ebay-active cron with two tier-
-- specific schedules. The old cron processed cards by oldest
-- last_price_check_at across the entire 22K-card catalog — biased
-- against the partner-relevant subset. Per the tier model in
-- 20260509080000, scrape cadence now matches signal value:
--
--   tier='pokemon_top'  every 6 hours  (~1,369 cards × 4 fires/day = full
--                                       sweep ~3-4 days at BATCH_SIZE=50)
--   tier='remaining'    weekly Sunday  (~21,101 cards × 1 fire/week with
--                                       BATCH_SIZE=200 = full sweep
--                                       roughly every 105 weeks. Acceptable
--                                       — these cards have low signal
--                                       value for the partner anyway.)
--   tier='sports'       not yet scheduled — 0 cards exist; will add a
--                       schedule once sport-card import lands (P9).
--
-- Quota math at 5,000 Browse calls/day:
--   pokemon_top: 50 × 4 = 200 calls/day
--   remaining:   200 × (1/7) ≈ 29 calls/day
--   total:       ~230 calls/day, comfortably under 5K cap

-- Drop the old uniform schedule. cron.unschedule() is idempotent on
-- 'job not found' — it errors. Wrap in DO block to swallow that.
do $$
begin
  perform cron.unschedule('scrape-ebay-active');
exception
  when others then
    raise notice 'scrape-ebay-active cron not previously scheduled (ok)';
end;
$$;

-- pokemon_top: every 6 hours at :40 (matches the old eBay-style minute
-- offset to avoid colliding with hourly score recomputes at :15/:30 and
-- alert checks at :00).
select cron.schedule(
  'scrape-ebay-active-pokemon-top',
  '40 0,6,12,18 * * *',
  $$ select public.invoke_function(
       'scrape-ebay-active',
       jsonb_build_object('tier', 'pokemon_top', 'limit', 50)
     ); $$
);

-- remaining: weekly Sunday 06:00 UTC. Keeps the long-tail catalog warm
-- without burning daily quota. limit=200 to maximize per-fire coverage.
select cron.schedule(
  'scrape-ebay-active-remaining',
  '0 6 * * 0',
  $$ select public.invoke_function(
       'scrape-ebay-active',
       jsonb_build_object('tier', 'remaining', 'limit', 200)
     ); $$
);
