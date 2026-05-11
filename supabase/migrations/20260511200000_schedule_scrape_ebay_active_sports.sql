-- Schedule sport-tier eBay scraping every 6h, mirroring the
-- pokemon_top cadence and batch size. Pokemon top + sports
-- combined: 400 cards every 6h = 1600 calls/day, well under
-- the 5000/day free Browse quota (we're at ~6.5% utilization).
--
-- The scrape-ebay-active function applies tier-conditional
-- filtering: pokemon tiers use graded-only listings under CCG
-- category 183454 (slab-comparable units for heating-up math),
-- sport tier drops BOTH category and condition filters
-- (sport cards live under a different eBay category tree;
-- sport flippers price raw, not graded).
--
-- Schedule offset by 3 hours from pokemon_top to spread eBay
-- API load across the day:
--   pokemon_top: 40 0,6,12,18 * * *
--   sports:      40 3,9,15,21 * * *

select cron.schedule(
  'scrape-ebay-active-sports',
  '40 3,9,15,21 * * *',
  $$ select public.invoke_function(
       'scrape-ebay-active',
       jsonb_build_object('tier', 'sports', 'limit', 50)
     ); $$
);
