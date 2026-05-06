-- PLACEHOLDER: stub popularity_score for cards so the Trending tab has
-- something to render before real prices/Reddit/Trends data flows in.
--
-- Score = rarity_base + recency_boost + jitter
--   rarity_base   30-90  by Pokemon rarity tier
--   recency_boost 0-10   newer sets get a bigger boost
--   jitter        0-3    so cards in the same tier shuffle a bit
--
-- Idempotent: only fires when popularity_score = 0 (the default),
-- so re-running migrations or importing new cards both DTRT.
-- The real `compute-popularity-scores` Edge Function (Week 2) replaces
-- this once we have prices + signals.

update public.cards c
set popularity_score = (
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
)
from public.sets s
where s.id = c.set_id
  and (c.popularity_score is null or c.popularity_score = 0);
