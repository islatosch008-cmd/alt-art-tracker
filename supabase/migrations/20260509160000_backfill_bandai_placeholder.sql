-- Backfill Bandai placeholder popularity_score with brand-aware rarity
-- mapping. The original P3 backfill (20260509070000) only knew Pokemon
-- rarities, so all ~19,559 Bandai cards hit the `else 40` fallback —
-- leaving Trending top-N dominated by metadata-empty Pokemon noise
-- because no Bandai card stood out from the neutral cluster.
--
-- BANDAI RARITY HIERARCHY
-- =======================
-- Bandai uses both spelled-out and shorthand labels across One Piece,
-- Digimon, and Dragon Ball Super Fusion World. Distribution sample
-- (1000 of 19,559 rows) showed: Common, Uncommon, Rare, C, Super Rare,
-- Promo, UC, R, SR, Secret Rare, L, Leader, SEC, PR, DON!!, Code Card,
-- Ultra Rare, Special Rare, Ultimate Rare, TR, plus null/None.
--
-- Mapping below extends the project spec to cover all observed
-- variants. Score values aligned with the Pokemon migration's
-- 35–90 band so cross-brand Trending top-N treats both ecosystems
-- consistently.
--
--   Bandai rarity      ~base   reasoning
--   ------------------ -----   ---------
--   Leader / L          80     highest collector value (Digimon)
--   Super Rare / SR     75     top-tier rarity, parallel to Pokemon SIR
--   Secret Rare / SEC   70     rare insert tier
--   Alt Art             70     parallel-tier collector cards
--   Special Rare        70     one-off high tier
--   Ultimate Rare       70     one-off high tier
--   Ultra Rare          65     between Rare and Super
--   DON!!               65     DBSFW signature card (high collectibility)
--   Rare / R            60     baseline rare
--   Promo / PR          50     neutral promotional
--   TR                  50     unknown — neutral default
--   Uncommon / UC       45     parallel to Pokemon Uncommon
--   Common / C          40     standard floor (per project spec — slightly
--                              above Pokemon Common 35; partner-meaningful
--                              Bandai cards skew higher than Pokemon commons)
--   Code Card           35     digital code, low collector value
--   else                40     fallback (catches new variants without
--                              clobbering them at 0)
--
-- WHERE clause: brand_id='bandai' AND (popularity_score = 0 OR < 60).
-- The < 60 cutoff preserves the 343 Bandai cards that landed at >= 60
-- via the original P3 backfill's else=40 + newness boost (recent sets
-- pushed up to ~58, plus jitter), or via real-signal computes from
-- compute-popularity-scores on Bandai cards we tested. None of those
-- need re-rolling.
--
-- VERIFIED PRE-MIGRATION
-- ======================
--   total Bandai cards          19,559
--   popularity_score < 60       19,216  ← target
--   popularity_score >= 60         343  ← untouched

update public.cards c
set popularity_score = least(100, (
  case c.rarity
    when 'Leader'        then 80
    when 'L'             then 80
    when 'Super Rare'    then 75
    when 'SR'            then 75
    when 'Secret Rare'   then 70
    when 'SEC'           then 70
    when 'Alt Art'       then 70
    when 'Special Rare'  then 70
    when 'Ultimate Rare' then 70
    when 'Ultra Rare'    then 65
    when 'DON!!'         then 65
    when 'Rare'          then 60
    when 'R'             then 60
    when 'Promo'         then 50
    when 'PR'            then 50
    when 'TR'            then 50
    when 'Uncommon'      then 45
    when 'UC'            then 45
    when 'Common'        then 40
    when 'C'             then 40
    when 'Code Card'     then 35
    else 40
  end
  -- newer sets get up to +10 (drops off after ~10 months). coalesce
  -- handles future-dated set release_date by clamping with greatest(0,...)
  -- below — same shape as the Pokemon migration.
  + greatest(0, 10 - coalesce(now()::date - s.release_date, 1000) / 30.0)
  -- light jitter so ties don't always sort the same way
  + random() * 3
))
from public.sets s
where s.id = c.set_id
  and c.brand_id = 'bandai'
  and (c.popularity_score is null
       or c.popularity_score = 0
       or c.popularity_score < 60);
