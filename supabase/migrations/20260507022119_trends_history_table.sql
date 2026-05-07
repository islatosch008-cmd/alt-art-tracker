-- Google Trends search-interest signal per card per day. Populated by
-- the .github/workflows/google-trends-cron.yml GitHub Action (pytrends
-- isn't comfortably runnable from a Deno Edge Function, so it lives in
-- CI minutes — free, ~10 min/day for top-50 cards).
--
-- search_interest is Google's normalized 0-100 metric for the timeframe
-- queried; we ask for "now 7-d" so each daily run re-anchors the prior 7
-- days. Earlier days get re-upserted with the latest normalization, which
-- the unique constraint cooperates with (resolution=merge-duplicates).

create table if not exists public.trends_history (
  id              bigserial primary key,
  card_id         uuid not null references public.cards(id) on delete cascade,
  region          text not null default 'US',
  search_interest integer not null check (search_interest >= 0 and search_interest <= 100),
  date_reported   date not null,
  recorded_at     timestamptz not null default now(),
  unique (card_id, region, date_reported)
);

create index if not exists trends_history_card_idx
  on public.trends_history (card_id, date_reported desc);

alter table public.trends_history enable row level security;
-- Catalog read for everyone; writes via service role (GH Action) only.
create policy "trends_history: read all"
  on public.trends_history for select
  to authenticated
  using (true);
