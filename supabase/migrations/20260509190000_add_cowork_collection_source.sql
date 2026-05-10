-- Allow source='cowork_collection' on sets table.
--
-- The sets_source_check constraint was last updated in
-- 20260509180000_add_ebay_discovery_source.sql. This migration adds
-- 'cowork_collection' to support the cowork-collected sport cards import
-- (see scripts/import-cowork-sport-cards.ts), which ingests an 875-row
-- JSONL of structured sport-card sales gathered out-of-band.
--
-- Distinct from existing sources because:
--   - Not a scraper run (no schedule, one-shot collection)
--   - Not ai_research (structured data, not LLM-extracted)
--   - Not ebay_discovery (we have full sale data, not just set names)
--
-- Without this addition, INSERTs from the cowork import script fail
-- with code 23514 (CHECK violation). Fix is additive — drop +
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
    'ebay_discovery',
    'cowork_collection'
  ));
