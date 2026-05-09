-- Add a `tier` column to cards so the eBay-active scraper can prioritize
-- by partner-relevance instead of cycling all 22K cards uniformly.
--
-- TIER DEFINITIONS (ratified 2026-05-09)
--
--   tier='pokemon_top'  ~1,369 cards
--     cards.brand_id = 'pokemon'
--     AND popularity_score >= 50
--     AND rarity NOT IN ('Common', 'Uncommon')
--     AND set.release_date >= NOW() - INTERVAL '24 months'
--     scrape cadence: every 6 hours
--
--   tier='remaining'    ~21,101 cards
--     everything else (Pokemon commons/uncommons, Pokemon old releases,
--     all Bandai)
--     scrape cadence: weekly, batched
--
--   tier='sports'       0 cards (RESERVED)
--     As of 2026-05-09 no sport-brand cards exist in the cards table —
--     only sport SETS (release calendar entries, no individual SKUs).
--     Importing sport CARDS requires a separate effort tracked as P9
--     in tomorrow's queue: TCGCSV-equivalent dump for sports if it
--     exists, OR eBay-driven card discovery (parse listing titles into
--     structured cards), OR PSA spec catalog enumeration. Once cards
--     for these brands land, a follow-up migration will tag them with
--     tier='sports' and a 6-hour cron will start servicing the tier.
--
-- WHY DEFAULT 'remaining'
-- =======================
-- Conservative default — no card gets prioritized scraping unless we
-- explicitly tag it. Backfill below promotes the pokemon_top subset.
-- New cards inserted later (e.g. when next Pokemon set imports) start
-- as 'remaining' and only get promoted by re-running this tagging
-- logic in a follow-up migration. This is fine because:
--   1. New cards have popularity_score=0 initially (per the placeholder
--      backfill in 20260509070000) — they wouldn't pass the >=50 filter
--      anyway until compute-popularity-scores runs.
--   2. compute-popularity-scores' weekly cycle will lift signal-having
--      cards into the >=50 bucket; a periodic re-tag (manual or via
--      future trigger) promotes them. For tonight's scope, accepting
--      eventual-consistency on tier promotion is fine.

alter table public.cards
  add column if not exists tier text not null default 'remaining';

-- CHECK constraint covers the future 'sports' value too so we don't
-- need a follow-up ALTER when sport cards finally land.
alter table public.cards
  drop constraint if exists cards_tier_check;
alter table public.cards
  add constraint cards_tier_check
  check (tier in ('pokemon_top', 'remaining', 'sports'));

-- Index supports the scrape selection query
-- (SELECT ... FROM cards WHERE tier = $1 ORDER BY last_price_check_at).
-- Composite key matches the access pattern.
create index if not exists cards_tier_last_price_check_idx
  on public.cards (tier, last_price_check_at nulls first);

-- Backfill pokemon_top — joins to sets for the release_date filter.
update public.cards c
set tier = 'pokemon_top'
from public.sets s
where c.set_id = s.id
  and c.brand_id = 'pokemon'
  and c.popularity_score >= 50
  and c.rarity not in ('Common', 'Uncommon')
  and s.release_date >= (now() - interval '24 months');
