-- Scraper infrastructure: HTML snapshot storage, source-CHECK update for the
-- new CardboardConnection scraper, and seeds for the sports brands the
-- scrapers will target.

-- ============================================================================
-- scraper_html_snapshots — debug snapshots when a scrape returns 0 results
-- ============================================================================
-- Lets us investigate "why did Topps return 0 today" without re-fetching.
-- Retention: 7 days per source (cleanup-old-data weekly job).
create table if not exists public.scraper_html_snapshots (
  id              bigserial primary key,
  source          text not null,
  url             text not null,
  fetched_at      timestamptz not null default now(),
  reason          text not null,                 -- 'no_results' | 'parse_failure' | …
  html_size_bytes integer not null,
  html_content    text not null
);

create index if not exists scraper_html_snapshots_source_idx
  on public.scraper_html_snapshots (source, fetched_at desc);

alter table public.scraper_html_snapshots enable row level security;
-- service-role only; admin dashboard reads via Edge Function

-- ============================================================================
-- sets.source check — add cardboardconnection_scraper
-- ============================================================================
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
    'ai_research'
  ));

-- ============================================================================
-- Sports brand seeds — needed before cardboardconnection_scraper can insert
-- ============================================================================
-- All sports manufacturers we expect CC + Leaf to surface. Idempotent.
insert into public.brands (id, name, category, active) values
  ('panini',     'Panini',     'sports', true),
  ('bowman',     'Bowman',     'sports', true),
  ('upper_deck', 'Upper Deck', 'sports', true),
  ('leaf',       'Leaf',       'sports', true),
  ('fanatics',   'Fanatics',   'sports', true),
  ('donruss',    'Donruss',    'sports', true),
  ('wild_card',  'Wild Card',  'sports', true)
on conflict (id) do nothing;

-- ============================================================================
-- cleanup-old-data: extend daily-maintenance to prune snapshots > 7 days
-- ============================================================================
-- Implemented as a Postgres function called from daily-maintenance Edge
-- Function (already wired). Returns rows deleted.
create or replace function public.cleanup_scraper_snapshots(retention_days integer default 7)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  delete from public.scraper_html_snapshots
   where fetched_at < now() - (retention_days || ' days')::interval;
  get diagnostics affected = row_count;
  return affected;
end;
$$;
