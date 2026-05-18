-- ============================================================================
-- Alt Art Tracker 2.0 — Phase 2 (Trending rebuild)
-- ============================================================================
-- Add public.cards.trending_score — the output of the new compute-trending
-- Edge Function.
--
-- v1's compute-popularity-scores (and its cards.popularity_score output)
-- is SCRAPPED. Rather than overload the old column with new semantics,
-- Phase 2 writes to a NEW, clearly-named column. popularity_score is left
-- in place (still carries the placeholder migration's rarity/recency
-- values) but is no longer updated and no longer read by the Trending tab.
--
-- trending_score blends two normalized signals (see compute-trending):
--   (a) price momentum   — % price change from justtcg_price_snapshots
--   (b) eBay active-listing volume — listing counts from price_history /
--                          the eBay active scraper
-- It is 0..100, higher = more trending.
--
-- Idempotent: add column + index if not exists.
-- ============================================================================

alter table public.cards
  add column if not exists trending_score numeric default 0;

comment on column public.cards.trending_score is
  'Output of compute-trending: 0..100 blend of JustTCG price momentum + '
  'eBay active-listing volume. Replaces popularity_score as the Trending '
  'tab ranking field. Higher = more trending.';

-- Trending tab orders by trending_score desc — index it the same way the
-- old popularity_score index served the old query.
create index if not exists cards_trending_score_idx
  on public.cards (trending_score desc);
