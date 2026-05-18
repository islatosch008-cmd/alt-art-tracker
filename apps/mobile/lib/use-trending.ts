import { useQuery } from '@tanstack/react-query';

import { supabase } from './supabase';

export type TrendingCard = {
  id: string;
  name: string;
  image_url: string | null;
  rarity: string | null;
  card_number: string | null;
  // Phase 2: Trending now ranks by trending_score (JustTCG price momentum
  // + eBay active-listing volume), written by the compute-trending Edge
  // Function. Replaces the v1 popularity_score.
  trending_score: number | null;
  current_price: number | null;
  ebay_avg_price: number | null;
  tcgplayer_market_price: number | null;
  brand_id: string;
  sets: { name: string | null } | null;
};

const PAGE = 50;

export function useTrendingCards(brandId: string | null) {
  return useQuery<TrendingCard[]>({
    queryKey: ['trending', brandId],
    queryFn: async () => {
      let q = supabase
        .from('cards')
        .select(
          'id, name, image_url, rarity, card_number, trending_score, current_price, ebay_avg_price, tcgplayer_market_price, brand_id, sets(name)',
        )
        .order('trending_score', { ascending: false, nullsFirst: false })
        .limit(PAGE);

      if (brandId) q = q.eq('brand_id', brandId);

      const { data, error } = await q;
      if (error) throw error;
      // Supabase returns sets as an array for relations; collapse to single
      // since we joined a one-to-one parent.
      return (data ?? []).map((row) => ({
        ...row,
        sets: Array.isArray(row.sets) ? row.sets[0] ?? null : row.sets,
      })) as TrendingCard[];
    },
    staleTime: 60_000,
  });
}
