-- Allow source='ebay_discovery' on sets table.
--
-- The sets_source_check constraint was last updated in
-- 20260506191322_scraper_infrastructure.sql. P6 (eBay-driven set
-- discovery via dacardworld + blowoutcards retailers) introduces a
-- new source value 'ebay_discovery' to distinguish from:
--   - manual           (admin direct entry)
--   - ai_research      (Anthropic agent + web_search)
--   - cardboardconnection_scraper / leaf_scraper (sports release calendars)
--   - tcgcsv / pokemon_tcg_api / scryfall (TCG catalog ingest)
--
-- Without this addition, INSERTs from scripts/ebay-discover-sets.ts
-- fail with code 23514 (CHECK violation). Fix is additive — drop +
-- recreate with the expanded value list.

alter table public.sets drop constraint sets_source_check;
alter table public.sets add constraint sets_source_check
  check (source in (
    'manual',
    'topps_scraper',
    'panini_scraper',
    'fanatics_scraper',
    'upperdeck_scraper',
    'leaf_scraper',
    'cardboardconnection_scraper',
    'pokemon_tcg_api',
    'scryfall',
    'tcgcsv',
    'ai_research',
    'ebay_discovery'
  ));
