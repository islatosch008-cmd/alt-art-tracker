-- Phase 1 seed: brands + owner invite code for Ian
-- Idempotent (on conflict do nothing) so re-running is safe.

insert into public.brands (id, name, category, active) values
  ('pokemon', 'Pokemon',  'tcg',    true),
  ('topps',   'Topps',    'sports', true),
  ('bandai',  'Bandai',   'tcg',    true)
on conflict (id) do nothing;

-- Owner invite code (uses_remaining=10 to allow dev iteration during Week 1).
-- Tighten / regenerate before any external partner gets a code.
insert into public.invite_codes (code, intended_for, uses_remaining)
values ('OWNER-2026', 'Ian Slatosch (founder)', 10)
on conflict (code) do nothing;
