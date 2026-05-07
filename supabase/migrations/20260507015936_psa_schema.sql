-- PSA grading data schema (Phase 2 prep — token in env, integration scaffold
-- ships now, live API calls land once endpoints are confirmed in field tests).
--
-- Three tables:
--   psa_card_map       — card_id ↔ PSA spec_id mapping. Spec IDs are PSA's
--                        internal product identifier; we need them before
--                        we can query pop reports. Admin populates via
--                        /admin/sets/[id] (or a future bulk-match Edge Func).
--   psa_pop_reports    — population per grade per card per snapshot date.
--                        Populated by scrape-psa-pop-reports (weekly).
--   psa_graded_sales   — recent graded sales. Populated by
--                        scrape-psa-recent-sales (daily).

create table if not exists public.psa_card_map (
  card_id      uuid primary key references public.cards(id) on delete cascade,
  psa_spec_id  text not null,
  notes        text,
  added_at     timestamptz not null default now(),
  added_by     uuid references public.profiles(id),
  unique (psa_spec_id, card_id)
);

create index if not exists psa_card_map_spec_idx
  on public.psa_card_map (psa_spec_id);

alter table public.psa_card_map enable row level security;
create policy "psa_card_map: admin all"
  on public.psa_card_map for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Population per (card, grade) snapshot. PSA grades: 1, 1.5, 2, 2.5, 3, 3.5,
-- 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10, 'PSA 10 Gem Mint'-style
-- modifiers exist too. Stored as text to accommodate variants.
create table if not exists public.psa_pop_reports (
  id           bigserial primary key,
  card_id      uuid not null references public.cards(id) on delete cascade,
  grade        text not null,
  count        integer not null,
  recorded_at  timestamptz not null default now()
);

create index if not exists psa_pop_reports_card_idx
  on public.psa_pop_reports (card_id, recorded_at desc);

alter table public.psa_pop_reports enable row level security;
-- Read-only for everyone (catalog), write via service role + cron only.
create policy "psa_pop_reports: read all"
  on public.psa_pop_reports for select
  to authenticated
  using (true);

create table if not exists public.psa_graded_sales (
  id              bigserial primary key,
  card_id         uuid not null references public.cards(id) on delete cascade,
  psa_cert_number text,
  grade           text,
  sale_price      numeric,
  sold_at         timestamptz,
  source_url      text,
  recorded_at     timestamptz not null default now(),
  -- Prevent duplicate inserts of the same cert across runs.
  unique (psa_cert_number)
);

create index if not exists psa_graded_sales_card_idx
  on public.psa_graded_sales (card_id, sold_at desc);

alter table public.psa_graded_sales enable row level security;
create policy "psa_graded_sales: read all"
  on public.psa_graded_sales for select
  to authenticated
  using (true);
