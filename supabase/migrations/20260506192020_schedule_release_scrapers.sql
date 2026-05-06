-- Schedule the release scrapers. Times are UTC; spread by 1-2 minutes to
-- avoid hammering the Edge runtime.
--
-- Per Ian's spec: daily 6 AM block. CC gets the +2 offset since it's our
-- primary source — Leaf goes first as warmup so any infra-level breakage
-- shows on the smaller scraper before the big one.

select cron.schedule(
  'leaf_scraper',
  '0 6 * * *',                    -- 06:00 UTC daily
  $$ select public.invoke_function('scrape-leaf-releases'); $$
);

select cron.schedule(
  'cardboardconnection_scraper',
  '2 6 * * *',                    -- 06:02 UTC daily
  $$ select public.invoke_function('scrape-cardboardconnection-releases'); $$
);
