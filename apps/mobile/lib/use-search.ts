import { useQuery } from '@tanstack/react-query';

import { supabase } from './supabase';
import type { TrendingCard } from './use-trending';

const MIN_LEN = 2;
const LIMIT = 50;

// Escape % and _ in user input before passing to ilike — otherwise users typing
// these characters get unexpected wildcard behavior.
function escapeLike(input: string): string {
  return input.replace(/[%_\\]/g, (m) => `\\${m}`);
}

export function useSearchCards(query: string) {
  const trimmed = query.trim();
  return useQuery<TrendingCard[]>({
    queryKey: ['search', trimmed],
    enabled: trimmed.length >= MIN_LEN,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cards')
        .select(
          'id, name, image_url, rarity, card_number, popularity_score, current_price, brand_id, sets(name)',
        )
        .ilike('name', `%${escapeLike(trimmed)}%`)
        .order('popularity_score', { ascending: false, nullsFirst: false })
        .limit(LIMIT);
      if (error) throw error;
      return (data ?? []).map((row) => ({
        ...row,
        sets: Array.isArray(row.sets) ? row.sets[0] ?? null : row.sets,
      })) as TrendingCard[];
    },
    staleTime: 30_000,
  });
}

export const SEARCH_MIN_LEN = MIN_LEN;
