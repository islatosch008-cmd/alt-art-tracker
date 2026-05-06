-- Bandai covers multiple TCGplayer categories on TCGCSV (One Piece Card
-- Game, Digimon Card Game, Dragon Ball Super Fusion World, etc.). The
-- single-column PK on brand_id forced 1:1 — switch to composite so one
-- brand can map to many categories.

alter table public.tcgcsv_category_map
  drop constraint tcgcsv_category_map_pkey;

alter table public.tcgcsv_category_map
  add primary key (brand_id, category_id);
