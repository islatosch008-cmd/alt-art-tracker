-- RLS policies + auto-create-profile trigger for Phase 1
--
-- Pattern:
--   * User-owned tables: select/update only own rows
--   * Catalog tables (brands/sets/cards/...): public read, no client write
--   * System tables (api_request_log, feature_flags, rate_limit_buckets,
--     invite_codes, notification_queue server-side): RLS on, no client policies
--     (= service role only)

-- ============================================================================
-- User-owned tables
-- ============================================================================

alter table public.profiles enable row level security;
create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

alter table public.user_preferences enable row level security;
create policy "user_preferences: read own"
  on public.user_preferences for select
  using (auth.uid() = user_id);
create policy "user_preferences: update own"
  on public.user_preferences for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
-- Insert is handled by trigger on user signup; clients never insert directly.

alter table public.user_sessions enable row level security;
create policy "user_sessions: read own"
  on public.user_sessions for select
  using (auth.uid() = user_id);

alter table public.notification_queue enable row level security;
create policy "notification_queue: read own"
  on public.notification_queue for select
  using (auth.uid() = user_id);
-- Writes are server-side only (service role bypasses RLS).

alter table public.release_alerts_sent enable row level security;
create policy "release_alerts_sent: read own"
  on public.release_alerts_sent for select
  using (auth.uid() = user_id);

alter table public.heating_up_alerts_sent enable row level security;
create policy "heating_up_alerts_sent: read own"
  on public.heating_up_alerts_sent for select
  using (auth.uid() = user_id);

alter table public.affiliate_clicks enable row level security;
create policy "affiliate_clicks: read own"
  on public.affiliate_clicks for select
  using (auth.uid() = user_id);
-- Inserts are server-side via /go/:id Edge Function.

alter table public.audit_log enable row level security;
create policy "audit_log: read own"
  on public.audit_log for select
  using (auth.uid() = user_id);
-- update/delete already revoked from authenticated/anon in core schema.

-- ============================================================================
-- Public-readable catalog tables (anyone can read, only service role writes)
-- ============================================================================

alter table public.brands enable row level security;
create policy "brands: public read" on public.brands for select using (true);

alter table public.sets enable row level security;
create policy "sets: public read" on public.sets for select using (true);

alter table public.cards enable row level security;
create policy "cards: public read" on public.cards for select using (true);

alter table public.price_history enable row level security;
create policy "price_history: public read" on public.price_history for select using (true);

alter table public.volume_history enable row level security;
create policy "volume_history: public read" on public.volume_history for select using (true);

alter table public.score_history enable row level security;
create policy "score_history: public read" on public.score_history for select using (true);

alter table public.reddit_mentions enable row level security;
create policy "reddit_mentions: public read" on public.reddit_mentions for select using (true);

-- ============================================================================
-- System / service-role-only tables (RLS on, no client policies = no access)
-- ============================================================================

alter table public.invite_codes enable row level security;
alter table public.api_request_log enable row level security;
alter table public.feature_flags enable row level security;
alter table public.rate_limit_buckets enable row level security;

-- ============================================================================
-- Auto-create profile + preferences on signup, validating invite code
-- ============================================================================
--
-- Fires on auth.users insert. Reads invite_code from raw_user_meta_data
-- (the second arg to supabase.auth.signUp({ options: { data: ... } })).
-- Atomically: checks code is valid + has uses left, creates profile +
-- preferences, decrements uses_remaining. Raises if invalid (which fails
-- the auth signup).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invite_code text;
  v_invite      public.invite_codes%rowtype;
begin
  v_invite_code := new.raw_user_meta_data->>'invite_code';

  if v_invite_code is null or length(v_invite_code) = 0 then
    raise exception 'Invite code required for signup' using errcode = 'P0001';
  end if;

  select *
    into v_invite
    from public.invite_codes
   where code = v_invite_code
     and uses_remaining > 0
     and (expires_at is null or expires_at > now())
   for update;

  if not found then
    raise exception 'Invalid or expired invite code' using errcode = 'P0001';
  end if;

  insert into public.profiles (id, invite_code_used, invited_by)
  values (new.id, v_invite_code, v_invite.created_by);

  insert into public.user_preferences (user_id) values (new.id);

  update public.invite_codes
     set uses_remaining = uses_remaining - 1
   where code = v_invite_code;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
