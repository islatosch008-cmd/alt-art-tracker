-- check-drop-alerts daily at 06:30 UTC, after the release scrapers have
-- had a chance to land any new pre_order_opens_at values.
--
--   06:00  leaf_scraper
--   06:02  cardboardconnection_scraper
--   06:30  check-drop-alerts   ← this
--   * * * *  process-notifications  (drains every minute, picks up enqueued)

select cron.schedule(
  'check-drop-alerts',
  '30 6 * * *',
  $$ select public.invoke_function('check-drop-alerts'); $$
);
