-- Replace public.invoke_function() to embed the prod Edge Functions
-- URL + anon apikey directly, eliminating dependency on database-level
-- GUCs that Supabase Cloud forbids the postgres role from setting.
--
-- HISTORY:
--   20260506163400_schedule_cron_jobs.sql set the GUCs via
--   set_config(..., false) which is session-scoped — invisible to
--   pg_cron background sessions. Local dev passed because
--   `supabase db reset` re-runs that migration in the same session.
--   Prod failed silently every hour with "unrecognized configuration
--   parameter".
--
--   First fix attempt (this migration's original contents): ALTER
--   DATABASE postgres SET. Returned 42501 permission denied — Supabase
--   Cloud restricts ALTER DATABASE for the postgres pooler role.
--
-- FINAL FIX: helper function carries the values itself. No GUC
-- dependency. Anon apikey is public-by-design (ships in mobile/web
-- client bundles); hardcoding server-side is consistent.
--
-- ROTATION: if anon key is ever rotated, ship a new migration with
-- CREATE OR REPLACE FUNCTION replacing the apikey literal.

create or replace function public.invoke_function(
  fname text,
  body jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  request_id bigint;
begin
  select net.http_post(
    url := 'https://nqtwwttvemqrmcgzbspg.supabase.co/functions/v1/' || fname,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdHd3dHR2ZW1xcm1jZ3pic3BnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMjkwMDgsImV4cCI6MjA5MzYwNTAwOH0.epZc8LeS7BpRjMLIpJG_fIG5xaPHC3oIHFghNxsCOEc'
    ),
    body := body
  ) into request_id;
  return request_id;
end;
$$;
