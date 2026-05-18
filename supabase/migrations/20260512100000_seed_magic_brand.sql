-- ============================================================================
-- Alt Art Tracker 2.0 — Phase 3 (Release calendar / TCG coverage)
-- ============================================================================
-- The retargeted ai-research-releases agent now finds TCG releases for
-- Pokemon, Magic: The Gathering, and the Bandai card games. It maps release
-- brand names to brand_id FKs on public.sets:
--   Pokemon                              -> pokemon  (seeded)
--   One Piece / Dragon Ball / Digimon /
--   Union Arena / Gundam (all Bandai)    -> bandai   (seeded)
--   Magic: The Gathering                 -> magic    (added here)
--
-- `pokemon` and `bandai` already exist from 20260506042944_seed_brands_and_
-- owner_invite.sql; only `magic` is missing. Insert it with
-- `on conflict do nothing` so re-running this migration is safe.
-- ============================================================================

insert into public.brands (id, name, category, active) values
  ('magic', 'Magic: The Gathering', 'tcg', true)
on conflict (id) do nothing;
