-- ============================================================================
-- Alt Art Tracker 2.0 — Phase 2 (JustTCG integration)
-- ============================================================================
-- Add JustTCG card-identity + rotation-cursor columns to public.cards.
--
-- WHY A NEW COLUMN
-- ----------------
-- Our catalog has no single external id that maps cleanly to JustTCG:
--   * Pokemon-API-imported cards carry only external_ids.tcg_api_id
--     (a Pokemon TCG API id — NOT a tcgplayer id).
--   * tcgcsv-imported cards carry external_ids.tcgplayer_product_id
--     (a numeric tcgplayer id) — this DOES map to JustTCG's tcgplayerId.
--   * No card carries a scryfall or mtgjson id.
--
-- The fetch-justtcg Edge Function resolves a card to JustTCG in priority
-- order: (1) this column if already set, (2) external_ids.tcgplayer_
-- product_id -> JustTCG batch lookup by tcgplayerId. A (3) game+set+
-- number fallback is left as a documented seam but NOT used yet — our
-- set names are not guaranteed to match JustTCG's, and a wrong match
-- would poison the price-momentum signal. On a successful match the
-- function WRITES the resolved JustTCG card id back into this column so
-- subsequent runs skip resolution entirely.
--
-- BACKFILL: this column starts NULL for every existing card. It is
-- populated incrementally by fetch-justtcg as the rotating catalog sweep
-- resolves cards over time. No one-shot backfill migration is shipped —
-- the free-tier quota (100 req/day) makes a bulk backfill impractical;
-- the rotating sweep is the backfill.
--
-- Idempotent: add column if not exists.
-- ============================================================================

alter table public.cards
  add column if not exists justtcg_card_id text;

comment on column public.cards.justtcg_card_id is
  'JustTCG card id (the `id` field of a JustTCG card object). NULL until '
  'fetch-justtcg resolves the card; populated incrementally by the '
  'rotating catalog sweep. Used to skip identity resolution on later runs.';

-- Partial index: the fetch function frequently filters "cards already
-- resolved" vs "not yet resolved". A partial index on the resolved set
-- keeps lookups by justtcg_card_id cheap without indexing the long tail
-- of NULLs.
create index if not exists cards_justtcg_card_id_idx
  on public.cards (justtcg_card_id)
  where justtcg_card_id is not null;

-- ----------------------------------------------------------------------------
-- Rotation cursor: fetch-justtcg cannot price the whole catalog every run
-- (free tier is 100 requests/day). It selects a rotating slice ordered by
-- last_justtcg_fetch_at ASC NULLS FIRST — never-fetched cards lead, then
-- least-recently-refreshed. Every card is revisited eventually.
-- Starts NULL for every card so the first sweep picks up the whole catalog.
-- ----------------------------------------------------------------------------
alter table public.cards
  add column if not exists last_justtcg_fetch_at timestamptz;

comment on column public.cards.last_justtcg_fetch_at is
  'When fetch-justtcg last attempted this card. Drives the rotating '
  'catalog sweep (ASC NULLS FIRST). NULL = never attempted.';

create index if not exists cards_last_justtcg_fetch_at_idx
  on public.cards (last_justtcg_fetch_at asc nulls first);
