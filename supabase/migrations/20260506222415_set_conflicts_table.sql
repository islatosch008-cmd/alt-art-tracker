-- Cross-source disagreements on the same release. Surfaces in
-- /admin/conflicts (step 8). Populated initially by the AI research agent
-- when its findings disagree with the cardboardconnection_scraper or
-- leaf_scraper rows.
--
-- A conflict is one row PER FIELD that disagrees. So if the agent finds a
-- release whose name matches an existing CC row but both release_date and
-- msrp_box differ, we insert two conflict rows pointing to the same set_id.

create table if not exists public.set_conflicts (
  id              bigserial primary key,
  set_id          uuid references public.sets(id) on delete cascade,
  source_a        text not null,
  source_b        text not null,
  field_name      text not null,
  value_a         text,
  value_b         text,
  confidence_a    text,
  confidence_b    text,
  status          text not null default 'pending'
                     check (status in ('pending','resolved_a','resolved_b','resolved_manual','dismissed')),
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles(id),

  -- Don't insert the same field-disagreement twice for the same set + source pair.
  unique (set_id, source_a, source_b, field_name)
);

create index if not exists set_conflicts_status_idx
  on public.set_conflicts (status, created_at desc)
  where status = 'pending';

create index if not exists set_conflicts_set_id_idx
  on public.set_conflicts (set_id);

alter table public.set_conflicts enable row level security;

-- Admins read/write the queue (matches admin_role_rls pattern).
create policy "set_conflicts: admin read"
  on public.set_conflicts for select
  to authenticated
  using (public.is_admin());

create policy "set_conflicts: admin update"
  on public.set_conflicts for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Inserts come from Edge Functions (service role bypasses RLS). No client
-- insert policy on purpose.
