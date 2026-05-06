-- Phase 1 core schema for Alt Art Tracker
-- Tables only. RLS, triggers, and seeds land in the next migration.

-- ============================================================================
-- Reference data
-- ============================================================================

create table public.brands (
  id text primary key,
  name text not null,
  category text not null check (category in ('tcg', 'sports')),
  logo_url text,
  active boolean default true
);

-- ============================================================================
-- Users / auth metadata
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  phone_number text,
  phone_verified_at timestamptz,
  role text default 'user' check (role in ('owner', 'partner', 'user', 'admin')),
  invited_by uuid references public.profiles(id),
  invite_code_used text,
  created_at timestamptz default now(),
  is_pro boolean default false,
  pro_expires_at timestamptz,
  age_verified boolean default false
);

create table public.invite_codes (
  code text primary key,
  created_by uuid references public.profiles(id),
  intended_for text,
  uses_remaining integer default 1,
  expires_at timestamptz,
  created_at timestamptz default now()
);

create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  brands text[] default '{}',
  categories text[] default '{}',
  alert_channels text[] default '{push}',
  sms_enabled boolean default false,
  alert_frequency text default 'realtime',
  release_alerts_enabled boolean default true,
  release_alert_days integer[] default '{30, 7, 1, 0}',
  drop_alerts_enabled boolean default true,
  trending_alerts_enabled boolean default false,
  heating_up_alerts_enabled boolean default true,
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text default 'America/Chicago',
  updated_at timestamptz default now()
);

-- ============================================================================
-- Catalog
-- ============================================================================

create table public.sets (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references public.brands(id),
  name text not null,
  release_date date,
  pre_order_opens_at timestamptz,
  msrp_box numeric,
  msrp_pack numeric,
  msrp_card numeric,
  external_ids jsonb default '{}',
  created_at timestamptz default now()
);

create index sets_release_date_idx on public.sets (release_date);
create index sets_pre_order_opens_at_idx
  on public.sets (pre_order_opens_at)
  where pre_order_opens_at is not null;

create table public.cards (
  id uuid primary key default gen_random_uuid(),
  set_id uuid references public.sets(id) on delete cascade,
  brand_id text not null references public.brands(id),
  category text not null,
  name text not null,
  card_number text,
  rarity text,
  is_sealed boolean default false,
  msrp numeric,
  current_price numeric,
  popularity_score numeric default 0,
  heating_up_score numeric default 0,
  baseline_30d_price numeric,
  baseline_30d_volume numeric,
  last_price_check_at timestamptz,
  external_ids jsonb default '{}',
  image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index cards_brand_id_idx on public.cards (brand_id);
create index cards_category_idx on public.cards (category);
create index cards_popularity_score_idx on public.cards (popularity_score desc);
create index cards_heating_up_score_idx on public.cards (heating_up_score desc);
create index cards_last_price_check_at_idx on public.cards (last_price_check_at);

-- ============================================================================
-- Time-series (partitioned by month on recorded_at)
-- ============================================================================

create table public.price_history (
  id bigserial,
  card_id uuid not null references public.cards(id) on delete cascade,
  price numeric not null,
  source text not null,
  condition text,
  recorded_at timestamptz not null default now(),
  primary key (id, recorded_at)
) partition by range (recorded_at);

create index price_history_card_recorded_idx
  on public.price_history (card_id, recorded_at desc);

-- Initial monthly partitions (cron will roll forward each month)
create table public.price_history_2026_05 partition of public.price_history
  for values from ('2026-05-01') to ('2026-06-01');
create table public.price_history_2026_06 partition of public.price_history
  for values from ('2026-06-01') to ('2026-07-01');
create table public.price_history_2026_07 partition of public.price_history
  for values from ('2026-07-01') to ('2026-08-01');

create table public.volume_history (
  id bigserial,
  card_id uuid not null references public.cards(id) on delete cascade,
  sales_count integer not null,
  source text not null,
  recorded_at timestamptz not null default now(),
  primary key (id, recorded_at)
) partition by range (recorded_at);

create index volume_history_card_recorded_idx
  on public.volume_history (card_id, recorded_at desc);

create table public.volume_history_2026_05 partition of public.volume_history
  for values from ('2026-05-01') to ('2026-06-01');
create table public.volume_history_2026_06 partition of public.volume_history
  for values from ('2026-06-01') to ('2026-07-01');
create table public.volume_history_2026_07 partition of public.volume_history
  for values from ('2026-07-01') to ('2026-08-01');

-- ============================================================================
-- Signal sources
-- ============================================================================

create table public.reddit_mentions (
  id bigserial primary key,
  card_id uuid references public.cards(id) on delete cascade,
  subreddit text not null,
  mention_count integer not null,
  recorded_at timestamptz default now()
);

create index reddit_mentions_card_recorded_idx
  on public.reddit_mentions (card_id, recorded_at desc);

create table public.score_history (
  id bigserial primary key,
  card_id uuid not null references public.cards(id) on delete cascade,
  popularity_score numeric,
  heating_up_score numeric,
  components jsonb not null,
  calculated_at timestamptz default now()
);

create index score_history_card_calculated_idx
  on public.score_history (card_id, calculated_at desc);

-- ============================================================================
-- Operational tables
-- ============================================================================

create table public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  payload jsonb not null,
  channel text not null check (channel in ('push', 'sms', 'email')),
  scheduled_for timestamptz default now(),
  sent_at timestamptz,
  status text default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped'))
);

create index notification_queue_pending_idx
  on public.notification_queue (status, scheduled_for)
  where status = 'pending';

create table public.release_alerts_sent (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  set_id uuid not null references public.sets(id) on delete cascade,
  alert_type text not null check (alert_type in ('t30', 't7', 't1', 't0', 'drop_open')),
  sent_at timestamptz default now(),
  unique (user_id, set_id, alert_type)
);

create table public.heating_up_alerts_sent (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  sent_at timestamptz default now()
);

create index heating_up_alerts_sent_user_card_sent_idx
  on public.heating_up_alerts_sent (user_id, card_id, sent_at desc);

create table public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  card_id uuid references public.cards(id),
  network text not null,
  affiliate_url text not null,
  clicked_at timestamptz default now()
);

create table public.api_request_log (
  id bigserial primary key,
  source text not null,
  endpoint text not null,
  status_code integer,
  cost_units numeric,
  requested_at timestamptz default now()
);

create table public.audit_log (
  id bigserial primary key,
  user_id uuid references public.profiles(id),
  event_type text not null,
  metadata jsonb,
  ip_address inet,
  user_agent text,
  occurred_at timestamptz default now()
);

-- audit_log is append-only for app users; RLS migration locks it down further
revoke update, delete on public.audit_log from authenticated, anon;

create table public.feature_flags (
  key text primary key,
  enabled boolean default false,
  rollout_percentage integer default 0 check (rollout_percentage between 0 and 100),
  description text,
  updated_at timestamptz default now()
);

create table public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_name text,
  ip_address inet,
  last_active_at timestamptz default now(),
  refresh_token_hash text,
  created_at timestamptz default now()
);

create table public.rate_limit_buckets (
  source text primary key,
  requests_in_window integer default 0,
  window_started_at timestamptz default now(),
  max_per_window integer not null
);
