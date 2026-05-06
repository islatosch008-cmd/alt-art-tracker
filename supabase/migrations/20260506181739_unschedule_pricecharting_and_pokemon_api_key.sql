-- PriceCharting deferred to Phase 2 per project decisions update.
-- Unschedule the cron job that posted to the now-deleted Edge Function so
-- pg_cron stops emitting failed-request rows every hour.

-- cron.unschedule errors if the job doesn't exist; wrap in DO ... EXCEPTION
do $$
begin
  perform cron.unschedule('scrape-pricecharting-prices');
exception when others then
  null; -- already gone, fine
end $$;
