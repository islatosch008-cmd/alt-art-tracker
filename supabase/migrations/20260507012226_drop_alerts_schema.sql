-- check-drop-alerts schema. Mirrors release_alerts but on pre_order_opens_at.
--
-- Adds:
--   user_preferences.drop_alert_days (integer[]) — like release_alert_days
--     but for pre-order open dates. Default {30,7,1,0}.
--   public.drop_alerts_sent — dedup table mirror of release_alerts_sent
--     so the cron is idempotent across reruns.

alter table public.user_preferences
  add column if not exists drop_alert_days integer[] not null
    default array[30, 7, 1, 0];

create table if not exists public.drop_alerts_sent (
  id         bigserial primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  set_id     uuid not null references public.sets(id) on delete cascade,
  alert_type text not null,
  sent_at    timestamptz not null default now(),
  unique (user_id, set_id, alert_type)
);

create index if not exists drop_alerts_sent_user_set_idx
  on public.drop_alerts_sent (user_id, set_id);

alter table public.drop_alerts_sent enable row level security;
-- Service role only; user-facing visibility comes from process-notifications,
-- not from a direct read of this table.
