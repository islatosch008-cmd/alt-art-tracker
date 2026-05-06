-- PLACEHOLDER: stub heating_up_score so the Heating Up tab differs from
-- Trending in a meaningful way before the real predictive algorithm exists.
--
-- Different math than placeholder_popularity_score by design:
--   * Mid-tier rares (Ultra Rare, Double Rare, Illustration Rare) score
--     HIGHER here — they're "the heating ones" before they become chase cards.
--   * Top-tier chase rares (Special Illustration / Mega Hyper / Hyper) score
--     LOWER — already trending, can't be "heating up" if they're at peak.
--   * Only fires on cards from sets released in the last 90 days. Older sets
--     stay at heating_up_score = 0 (cold).
--   * Heavier random jitter than popularity so the ordering feels less stable
--     (which is roughly what predictive feeds look like).
--
-- Idempotent: only updates rows where heating_up_score = 0.
-- Real compute-heating-up-scores Edge Function (Week 2) replaces this.

update public.cards c
set heating_up_score = least(100, (
  case c.rarity
    when 'Ultra Rare'                then 70
    when 'Double Rare'               then 65
    when 'Illustration Rare'         then 62
    when 'Shiny Rare'                then 58
    when 'ACE SPEC Rare'             then 55
    when 'MEGA_ATTACK_RARE'          then 52
    when 'Rare'                      then 45
    when 'Black White Rare'          then 50
    -- Already at the top of Trending — treat as "low heat" since they can't
    -- accelerate much from peak.
    when 'Hyper Rare'                then 30
    when 'Special Illustration Rare' then 25
    when 'Mega Hyper Rare'           then 22
    when 'Shiny Ultra Rare'          then 28
    when 'Uncommon'                  then 32
    when 'Common'                    then 20
    else                             35
  end
  -- Newer sets get a stronger recency boost than popularity does (0–15).
  + greatest(0, 15 - coalesce(now()::date - s.release_date, 1000) / 7.0)
  -- Heavier jitter — predictive feeds shouldn't feel like a stable leaderboard.
  + random() * 20
))
from public.sets s
where s.id = c.set_id
  and (c.heating_up_score is null or c.heating_up_score = 0)
  -- Only "warm" sets are eligible to be heating; older sets stay cold.
  and (now()::date - s.release_date) <= 90;
