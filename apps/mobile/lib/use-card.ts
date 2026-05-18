import { useQuery } from '@tanstack/react-query';

import { supabase } from './supabase';

export type CardDetail = {
  id: string;
  name: string;
  image_url: string | null;
  rarity: string | null;
  card_number: string | null;
  popularity_score: number | null;
  current_price: number | null;
  ebay_avg_price: number | null;
  tcgplayer_market_price: number | null;
  last_price_check_at: string | null;
  brand_id: string;
  category: string;
  is_sealed: boolean;
  set_id: string | null;
  external_ids: Record<string, unknown> | null;
  sets: { name: string | null; release_date: string | null } | null;
  brands: { name: string } | null;
};

export function useCard(id: string | undefined) {
  return useQuery<CardDetail | null>({
    queryKey: ['card', id],
    enabled: !!id,
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from('cards')
        .select(
          'id, name, image_url, rarity, card_number, popularity_score, current_price, ebay_avg_price, tcgplayer_market_price, last_price_check_at, brand_id, category, is_sealed, set_id, external_ids, sets(name, release_date), brands(name)',
        )
        .eq('id', id)
        .single();
      if (error) throw error;
      const collapsed = {
        ...data,
        sets: Array.isArray(data.sets) ? data.sets[0] ?? null : data.sets,
        brands: Array.isArray(data.brands) ? data.brands[0] ?? null : data.brands,
      };
      return collapsed as CardDetail;
    },
  });
}
