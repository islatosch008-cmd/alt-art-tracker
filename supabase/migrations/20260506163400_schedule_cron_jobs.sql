-- pg_cron schedules for the scrapers + alert checks + queue drain.
--
-- Local-dev URLs use the kong gateway hostname inside the Supabase Docker
-- network (http://kong:8000). For Supabase Cloud, set
-- app.settings.functions_base_url to the project's Edge Functions URL and
-- the apikey to the anon publishable key — the migration reads both from
-- current_setting() with sensible defaults.
--
-- Schedules picked to spread load — no two jobs land on the same minute.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Defaults are local-dev. To override for cloud:
--   alter database postgres set app.settings.functions_base_url to 'https://<ref>.supabase.co/functions/v1';
--   alter database postgres set app.settings.functions_apikey to '<anon publishable key>';
do $$
begin
  if current_setting('app.settings.functions_base_url', true) is null then
    perform set_config(
      'app.settings.functions_base_url',
      'http://kong:8000/functions/v1',
      false
    );
  end if;
  if current_setting('app.settings.functions_apikey', true) is null then
    perform set_config(
      'app.settings.functions_apikey',
      'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
      false
    );
  end if;
end $$;

-- Helper that posts to a function with the apikey header.
create or replace function public.invoke_function(fname text, body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  request_id bigint;
begin
  select net.http_post(
    url := current_setting('app.settings.functions_base_url') || '/' || fname,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', current_setting('app.settings.functions_apikey')
    ),
    body := body
  ) into request_id;
  return request_id;
end;
$$;

-- ============================================================================
-- Schedules
-- ============================================================================
-- pg_cron runs in the database server's timezone (UTC by default for
-- Supabase). Cron expressions are 5-field (m h dom mon dow).

select cron.schedule(
  'process-notifications',
  '* * * * *',                    -- every minute
  $$ select public.invoke_function('process-notifications'); $$
);

select cron.schedule(
  'check-release-alerts',
  '0 * * * *',                    -- top of every hour
  $$ select public.invoke_function('check-release-alerts'); $$
);

select cron.schedule(
  'compute-popularity-scores',
  '15 * * * *',                   -- :15 of every hour
  $$ select public.invoke_function('compute-popularity-scores'); $$
);

select cron.schedule(
  'scrape-reddit-mentions',
  '0 */4 * * *',                  -- every 4 hours
  $$ select public.invoke_function('scrape-reddit-mentions'); $$
);

select cron.schedule(
  'scrape-pricecharting-prices',
  '30 * * * *',                   -- hourly :30 (no-op until/unless we ever wire PriceCharting)
  $$ select public.invoke_function('scrape-pricecharting-prices'); $$
);

select cron.schedule(
  'daily-maintenance',
  '0 9 * * *',                    -- 09:00 UTC = 04:00 CT (off-peak)
  $$ select public.invoke_function('daily-maintenance'); $$
);
