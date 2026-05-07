-- PSA scrapers — both 412 cleanly until psa_card_map is populated.
--
--   06:15 Mon  scrape-psa-pop-reports      (weekly; pop changes slowly)
--   06:45      scrape-psa-recent-sales     (daily; sales are time-sensitive,
--                                            offset 15min from drop alerts at 06:30)
--
-- Cron registry now spans the early-AM window:
--   06:00  leaf_scraper
--   06:02  cardboardconnection_scraper
--   06:15  scrape-psa-pop-reports          (Mon only)
--   06:30  check-drop-alerts
--   06:40  scrape-ebay-active              (every 2h)
--   06:45  scrape-psa-recent-sales         (daily)
--   06:50  scrape-ebay-sold                (every 2h)

select cron.schedule(
  'scrape-psa-pop-reports',
  '15 6 * * 1',
  $$ select public.invoke_function('scrape-psa-pop-reports'); $$
);

select cron.schedule(
  'scrape-psa-recent-sales',
  '45 6 * * *',
  $$ select public.invoke_function('scrape-psa-recent-sales'); $$
);
