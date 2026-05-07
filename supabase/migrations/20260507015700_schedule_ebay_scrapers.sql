-- eBay scrapers — every 2 hours within a 06-22 UTC window. Spread by 10
-- minutes so the two don't share a token-fetch burst (and so logs are
-- easier to follow).
--
--   :40   scrape-ebay-active
--   :50   scrape-ebay-sold (only fires when EBAY_USE_MARKETPLACE_INSIGHTS)
--
-- Both return 412 cleanly until creds are in place — pg_cron won't crash,
-- the runs just no-op. After creds land, they start hitting eBay
-- automatically with no migration needed.

select cron.schedule(
  'scrape-ebay-active',
  '40 6-22/2 * * *',
  $$ select public.invoke_function('scrape-ebay-active'); $$
);

select cron.schedule(
  'scrape-ebay-sold',
  '50 6-22/2 * * *',
  $$ select public.invoke_function('scrape-ebay-sold'); $$
);
