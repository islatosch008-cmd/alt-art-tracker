-- Adds the per-source price columns. Originally this migration also
-- backfilled placeholder values from rarity tier, but those proved
-- misleading in practice — e.g. Mega Clefable ex SIR generated $206 when
-- actual market is ~$70 (wide variance within "Special Illustration Rare":
-- chase cards like Umbreon ex SIR are >$1000, common SIRs are <$50, so a
-- single rarity tier can't produce honest numbers).
--
-- Now: schema-only. Real prices come from npm run refresh:prices (Pokemon
-- TCG API → tcgplayer_market_price) and the scrape-ebay-sold Edge Function
-- (eBay API → ebay_avg_price) once eBay credentials are in place. Cards
-- without a refresh yet show "—" / "syncing" in the UI rather than fake
-- numbers.

alter table public.cards
  add column if not exists ebay_avg_price numeric,
  add column if not exists tcgplayer_market_price numeric;
