-- Drop/release reminders moved from SMS to email (Gmail SMTP) in 2.0.
-- email_enabled is the master notifications toggle for email, mirroring the
-- old sms_enabled. Default true so existing subscribers keep getting alerts
-- (the per-type gates drop_alerts_enabled / release_alerts_enabled still apply
-- at enqueue time). sms_enabled is left intact but is no longer read.
alter table public.user_preferences
  add column if not exists email_enabled boolean not null default true;
