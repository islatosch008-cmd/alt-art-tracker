import { useQuery } from '@tanstack/react-query';

import { supabase } from './supabase';

export type Brand = {
  id: string;
  name: string;
  category: 'tcg' | 'sports';
};

export function useBrands() {
  return useQuery<Brand[]>({
    queryKey: ['brands'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brands')
        .select('id, name, category')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return (data ?? []) as Brand[];
    },
    staleTime: 5 * 60_000, // brands rarely change
  });
}
