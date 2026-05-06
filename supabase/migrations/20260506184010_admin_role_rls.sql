-- Admin role gate. Lets users with profiles.role in ('admin', 'owner') write
-- to the catalog tables (sets, brands) and review-queue tables directly from
-- the client, instead of having to go through Edge Functions for every
-- manual entry.
--
-- Reads stay open to everyone (public-readable catalog). Writes from
-- regular users continue to be blocked at the RLS layer.

-- Helper: returns true if the current auth.uid() is an admin or owner.
-- security definer because we need to read public.profiles even when the
-- caller's RLS would otherwise hide other rows. search_path locked.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'owner')
  );
$$;

-- ============================================================================
-- sets — admin write
-- ============================================================================

create policy "sets: admin insert"
  on public.sets for insert
  to authenticated
  with check (public.is_admin());

create policy "sets: admin update"
  on public.sets for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "sets: admin delete"
  on public.sets for delete
  to authenticated
  using (public.is_admin());

-- ============================================================================
-- brands — admin write (for manual brand creation, e.g. sports manufacturers)
-- ============================================================================

create policy "brands: admin insert"
  on public.brands for insert
  to authenticated
  with check (public.is_admin());

create policy "brands: admin update"
  on public.brands for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- invite_codes — admin read + write
-- ============================================================================
-- Currently service-role only. Admins need to mint codes for partners and
-- review the queue.

create policy "invite_codes: admin read"
  on public.invite_codes for select
  to authenticated
  using (public.is_admin());

create policy "invite_codes: admin insert"
  on public.invite_codes for insert
  to authenticated
  with check (public.is_admin());

create policy "invite_codes: admin update"
  on public.invite_codes for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================================
-- profiles — admin can promote others to admin
-- ============================================================================
-- Existing "Users update own preferences" policy stays. Add an admin-bypass
-- so an owner can promote a partner to admin without going through SQL.

create policy "profiles: admin read all"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

create policy "profiles: admin update any"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
