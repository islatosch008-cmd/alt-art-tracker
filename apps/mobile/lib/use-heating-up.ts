import { useQuery } from '@tanstack/react-query';

import { supabase } from './supabase';
import type { TrendingCard } from './use-trending';

const PAGE = 50;

// Same shape as Trending — different ordering and a non-zero gate so cold cards
// (heating_up_score = 0) don't pad the list.
export function useHeatingUpCards(brandId: string | null) {
  return useQuery<TrendingCard[]>({
    queryKey: ['heating-up', brandId],
    queryFn: async () => {
      let q = supabase
        .from('cards')
        .select(
          'id, name, image_url, rarity, card_number, popularity_score, current_price, brand_id, sets(name)',
        )
        .gt('heating_up_score', 0)
        .order('heating_up_score', { ascending: false, nullsFirst: false })
        .limit(PAGE);

      if (brandId) q = q.eq('brand_id', brandId);

      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        sets: Array.isArray(row.sets) ? row.sets[0] ?? null : row.sets,
      })) as TrendingCard[];
    },
    staleTime: 60_000,
  });
}
