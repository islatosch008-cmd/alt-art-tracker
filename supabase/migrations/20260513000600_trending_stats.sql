-- ============================================================================
-- Alt Art Tracker 2.0 — Phase 2 (Trending rebuild): trending reason stats
-- ============================================================================
-- Add the two human-readable "why is this trending?" stats to public.cards.
-- compute-trending already derives both values internally to build
-- trending_score; this migration just gives them durable columns so the
-- Trending tab can SHOW the reason (e.g. "▲ 8.0% · 7d · 124 listings")
-- instead of an opaque score.
--
--   trending_momentum_pct — 7-day percent price change for the card,
--     derived from justtcg_price_snapshots. Stored as a PERCENT (e.g. 8.0
--     means +8.0%, -3.2 means -3.2%), 1 decimal place. NULLABLE on purpose:
--     NULL means "no usable price history yet" (too few snapshots) so the
--     UI can distinguish a genuinely FLAT card (0.0) from one we simply
--     can't measure (NULL). Consumers must treat NULL as "unknown".
--
--   trending_listings — eBay active-listing count for the card (the same
--     total_active value the volume signal uses). NULLABLE on purpose:
--     NULL means no usable eBay active-listing count in the window.
--
-- Idempotent: add columns if not exists. No defaults — absence must read as
-- NULL ("unknown"), not 0, to preserve the flat-vs-no-data distinction.
-- ============================================================================

alter table public.cards
  add column if not exists trending_momentum_pct numeric;

alter table public.cards
  add column if not exists trending_listings integer;

comment on column public.cards.trending_momentum_pct is
  'Output of compute-trending: 7-day percent price change from '
  'justtcg_price_snapshots, stored as a percent (8.0 = +8.0%), 1 decimal. '
  'NULL = too few snapshots to measure (distinct from a flat 0.0). '
  'Drives the Trending tab''s momentum reason line.';

comment on column public.cards.trending_listings is
  'Output of compute-trending: eBay active-listing count for the card (the '
  'same total_active used by the volume signal). NULL = no usable count in '
  'the window. Drives the Trending tab''s "{n} listings" reason line.';
