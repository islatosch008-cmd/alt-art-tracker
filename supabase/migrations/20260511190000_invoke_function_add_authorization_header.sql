-- Add Authorization: Bearer <jwt> header to invoke_function().
--
-- 20260511180000 baked URL+apikey into the helper and got cron past the
-- GUC error, but every cron tick still returned 401 from the Edge
-- Function gateway:
--   net._http_response   status_code=401  error_msg=NULL
--
-- Root cause: Supabase Edge Functions default to verify_jwt=true. The
-- gateway checks the JWT in the Authorization header (Bearer scheme),
-- not the apikey header. The apikey header is for PostgREST RLS
-- role-switching, not Edge Function auth. Tested with curl:
--   apikey only                  → 401
--   apikey + Authorization       → 200
--   Authorization only           → 200
-- (process-notifications endpoint, prod, 2026-05-10.)
--
-- Keep both headers — apikey is harmless and matches what the
-- supabase-js client sends. Authorization is what unblocks the gateway.
--
-- Only ebay-deletion-webhook is configured with verify_jwt=false (in
-- supabase/config.toml) because it's a public webhook endpoint with
-- its own RSA signature verification. All other functions including
-- the cron-triggered ones rely on verify_jwt gateway protection.

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
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdHd3dHR2ZW1xcm1jZ3pic3BnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMjkwMDgsImV4cCI6MjA5MzYwNTAwOH0.epZc8LeS7BpRjMLIpJG_fIG5xaPHC3oIHFghNxsCOEc',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xdHd3dHR2ZW1xcm1jZ3pic3BnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMjkwMDgsImV4cCI6MjA5MzYwNTAwOH0.epZc8LeS7BpRjMLIpJG_fIG5xaPHC3oIHFghNxsCOEc'
    ),
    body := body
  ) into request_id;
  return request_id;
end;
$$;
