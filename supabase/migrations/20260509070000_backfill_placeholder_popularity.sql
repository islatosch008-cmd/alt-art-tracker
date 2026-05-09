-- Backfill placeholder popularity_score for cards that missed the
-- original 2026-05-06 migration (20260506065545).
--
-- WHY THIS IS NEEDED
-- ==================
-- 20260506065545 ran ONCE at schema-push time and only filled the cards
-- that existed then. The 22,455 cards imported AFTER (via
-- npm run import:pokemon + tcgcsv:refresh) never got the rarity-based
-- default and have been stuck at popularity_score=0 — leaving Trending
-- top-N filled with metadata-empty cards.
--
-- DESIGN
-- ======
-- This migration runs the EXACT same UPDATE logic as the original
-- placeholder. Idempotent via the WHERE popularity_score IS NULL OR = 0
-- clause — won't disturb cards already populated by:
--   - compute-popularity-scores' real-signal computations
--   - manual admin overrides
-- Cards with score > 0 (currently 800 on prod) are untouched.
--
-- After migration, ~21,670 cards land in the 35-90 score band based on
-- Pokemon rarity tiers. Bandai-specific rarities ('C', 'SR',
-- 'Super Rare', 'Leader', 'L', 'Ultimate Rare') hit the `else 40`
-- fallback and cluster around ~40 — neutral. A separate follow-up
-- commit can add Bandai-aware rarity tiers if needed.
--
-- WHY NOT A TRIGGER
-- =================
-- We considered an AFTER INSERT trigger that fires the rarity logic
-- automatically for new cards. Rejected for now:
--   - We don't import 22K cards regularly; backfill matches the
--     actual problem
--   - compute-popularity-scores overwrites the placeholder as real
--     signal flows in
--   - Trigger adds ongoing per-INSERT overhead for a problem that
--     won't recur
--   - If we DO import another big batch, this migration template
--     can be re-run as a one-off (just bump the timestamp)
--
-- VERIFIED PRE-MIGRATION
-- ======================
--   total cards          22,470
--   popularity_score = 0  21,670  ← target
--   popularity_score > 0     800   ← untouched

update public.cards c
set popularity_score = least(100, (
  case c.rarity
    when 'Special Illustration Rare' then 90
    when 'Mega Hyper Rare'           then 88
    when 'Hyper Rare'                then 85
    when 'Shiny Ultra Rare'          then 80
    when 'Illustration Rare'         then 78
    when 'ACE SPEC Rare'             then 75
    when 'Ultra Rare'                then 72
    when 'Shiny Rare'                then 70
    when 'Double Rare'               then 65
    when 'Rare Holo'                 then 58
    when 'Rare'                      then 55
    when 'MEGA_ATTACK_RARE'          then 73
    when 'Black White Rare'          then 60
    when 'Uncommon'                  then 45
    when 'Common'                    then 35
    else 40
  end
  -- newer sets get up to +10 (drops off after ~10 months)
  + greatest(0, 10 - coalesce(now()::date - s.release_date, 1000) / 30.0)
  -- light jitter so ties don't always sort the same way
  + random() * 3
))
from public.sets s
where s.id = c.set_id
  and (c.popularity_score is null or c.popularity_score = 0);
