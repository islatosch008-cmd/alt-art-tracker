-- ============================================================================
-- Alt Art Tracker 2.0 — Phase 2 (JustTCG integration)
-- ============================================================================
-- New table: public.justtcg_price_snapshots.
--
-- JustTCG returns CURRENT PRICE ONLY — no historical trend, no sales
-- volume. To compute price MOMENTUM we take a snapshot of every tracked
-- variant's price each time fetch-justtcg runs and accumulate history
-- here. compute-trending then reads a recent (~7d) window per card and
-- derives a percent price change.
--
-- One row per JustTCG variant per fetch-justtcg run:
--   card_id            FK to public.cards — clean UUID join key. Set
--                      because fetch-justtcg only snapshots cards it has
--                      already matched to a row in our catalog.
--   justtcg_card_id    the JustTCG card id (provenance / debugging).
--   variant_id         the JustTCG variant id — a card has multiple
--                      variants (printing x condition); momentum is
--                      computed per variant then aggregated per card.
--   printing           e.g. 'Normal', 'Holofoil', 'Reverse Holofoil'.
--   condition          e.g. 'Near Mint', 'Lightly Played'.
--   price              the variant's current price at capture time.
--   captured_at        when fetch-justtcg recorded this snapshot.
--
-- This table is append-only history — no updates, no upserts.
-- ============================================================================

create table if not exists public.justtcg_price_snapshots (
  id bigserial primary key,
  card_id uuid not null references public.cards(id) on delete cascade,
  justtcg_card_id text not null,
  variant_id text not null,
  printing text,
  condition text,
  price numeric not null,
  captured_at timestamptz not null default now()
);

-- "Latest snapshot per card" + per-variant time-window queries: a
-- composite index on (card_id, variant_id, captured_at desc) serves both
-- — compute-trending walks each card's variants over a recent window and
-- also wants the most-recent point.
create index if not exists justtcg_price_snapshots_card_variant_captured_idx
  on public.justtcg_price_snapshots (card_id, variant_id, captured_at desc);

-- Time-window scans across the whole table (e.g. "all snapshots in the
-- last 7 days" when compute-trending batches its read).
create index if not exists justtcg_price_snapshots_captured_at_idx
  on public.justtcg_price_snapshots (captured_at desc);

comment on table public.justtcg_price_snapshots is
  'Append-only price snapshots from JustTCG. One row per variant per '
  'fetch-justtcg run. Basis for the price-momentum signal in '
  'compute-trending — JustTCG itself returns current price only.';
