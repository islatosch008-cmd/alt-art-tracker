-- Adds the columns the manufacturer scrapers + AI research agent need on
-- public.sets, plus a small lookup table that caches resolved TCGCSV
-- category IDs so we don't have to hardcode them (TCGplayer renumbers).

-- ============================================================================
-- public.sets — metadata columns
-- ============================================================================
-- Why each:
--   sport             — sports cards split by sport (basketball / baseball / ...)
--   box_type          — hobby / retail / blaster / mega / jumbo / other
--   source            — provenance for conflict resolution + admin audit
--   source_id         — external ID from the source (re-sync match key)
--   last_synced_at    — when we last refreshed this row from its source
--   confidence        — only set for AI research entries (high/medium/low)
--   locked_fields     — fields the admin has manually edited; scrapers
--                       and AI must skip these on next sync.
alter table public.sets
  add column if not exists sport          text,
  add column if not exists box_type       text,
  add column if not exists source         text not null default 'manual',
  add column if not exists source_id      text,
  add column if not exists last_synced_at timestamptz,
  add column if not exists confidence     text,
  add column if not exists locked_fields  text[] not null default '{}';

-- Trust-hierarchy CHECK constraint on `source` to keep values controlled.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sets_source_check'
  ) then
    alter table public.sets
      add constraint sets_source_check
      check (source in (
        'manual',
        'topps_scraper',
        'panini_scraper',
        'fanatics_scraper',
        'upperdeck_scraper',
        'leaf_scraper',
        'pokemon_tcg_api',
        'scryfall',
        'tcgcsv',
        'ai_research'
      ));
  end if;
end $$;

-- Confidence is only meaningful for ai_research; constrain values.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sets_confidence_check'
  ) then
    alter table public.sets
      add constraint sets_confidence_check
      check (confidence is null or confidence in ('high', 'medium', 'low'));
  end if;
end $$;

-- Re-sync match index: source + source_id is the canonical pair scrapers
-- use to find existing rows.
create index if not exists sets_source_source_id_idx
  on public.sets (source, source_id)
  where source_id is not null;

-- Useful for the conflict review queue (`/admin/conflicts`).
create index if not exists sets_source_idx on public.sets (source);

-- ============================================================================
-- public.tcgcsv_category_map
-- ============================================================================
-- Resolved at runtime from https://tcgcsv.com/tcgplayer/categories. Each row
-- holds the TCGCSV-numbered category for one of our brand IDs. Re-verified
-- weekly by the TCGCSV refresher so TCGplayer renumbering doesn't silently
-- break us.
create table if not exists public.tcgcsv_category_map (
  brand_id      text primary key references public.brands(id) on delete cascade,
  category_id   integer not null,
  category_name text not null,
  resolved_at   timestamptz not null default now()
);

alter table public.tcgcsv_category_map enable row level security;
-- Service-role only (no client policies on purpose).
