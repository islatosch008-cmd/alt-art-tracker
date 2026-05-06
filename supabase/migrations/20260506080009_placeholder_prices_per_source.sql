-- PLACEHOLDER prices per source (eBay + TCGplayer) so the UI can render a
-- "last sold" price + per-platform breakdown before the real scrapers land.
--
-- Real data flow (Week 2+):
--   * scrape-pricecharting-prices Edge Function fetches market prices
--   * scrape-ebay-sold Edge Function fetches recent eBay sold listings
--   * each writes to public.price_history with source = 'ebay' or 'tcgplayer'
--   * compute job rolls latest-by-source into the denormalized columns
--     below and a fresh current_price = avg(ebay, tcg).
--
-- Until then we backfill plausible numbers from the rarity tier with
-- per-source jitter so eBay + TCG don't always match. Marked as
-- PLACEHOLDER in the UI's price footer.

alter table public.cards
  add column if not exists ebay_avg_price numeric,
  add column if not exists tcgplayer_market_price numeric;

-- One pass: derive a per-card base price from rarity, then jitter ±15% for
-- eBay and ±10% for TCGplayer (TCG is generally tighter — listed price vs
-- sold-listing variance). current_price = avg of the two.
update public.cards
set
  ebay_avg_price         = round((base * (0.85 + random() * 0.30))::numeric, 2),
  tcgplayer_market_price = round((base * (0.90 + random() * 0.20))::numeric, 2),
  current_price          = round(base::numeric, 2)
from (
  select id, (
    case rarity
      when 'Common'                    then  0.20 + random() *   0.40
      when 'Uncommon'                  then  0.40 + random() *   1.00
      when 'Rare'                      then  1.00 + random() *   4.00
      when 'Rare Holo'                 then  2.00 + random() *   8.00
      when 'Black White Rare'          then  5.00 + random() *  15.00
      when 'Double Rare'               then  3.00 + random() *  12.00
      when 'Ultra Rare'                then  5.00 + random() *  25.00
      when 'Shiny Rare'                then  5.00 + random() *  15.00
      when 'Illustration Rare'         then 10.00 + random() *  40.00
      when 'ACE SPEC Rare'             then  5.00 + random() *  25.00
      when 'Shiny Ultra Rare'          then 20.00 + random() *  60.00
      when 'Hyper Rare'                then 20.00 + random() * 130.00
      when 'MEGA_ATTACK_RARE'          then 30.00 + random() * 170.00
      when 'Special Illustration Rare' then 30.00 + random() * 270.00
      when 'Mega Hyper Rare'           then 50.00 + random() * 350.00
      else                                   1.00 + random() *   4.00
    end
  ) as base
  from public.cards
  where ebay_avg_price is null and tcgplayer_market_price is null
) basis
where public.cards.id = basis.id;

-- Recompute current_price as the avg of the two sources so it matches what
-- the UI shows. (We seeded it to base above; this normalizes it to the
-- jittered values that will actually display.)
update public.cards
set current_price = round(((ebay_avg_price + tcgplayer_market_price) / 2)::numeric, 2)
where ebay_avg_price is not null and tcgplayer_market_price is not null;
