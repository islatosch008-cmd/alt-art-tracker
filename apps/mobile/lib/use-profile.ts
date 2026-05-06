import { useQuery } from '@tanstack/react-query';

import { useAuth } from './auth';
import { supabase } from './supabase';

export type Profile = {
  id: string;
  phone_number: string | null;
  phone_verified_at: string | null;
  display_name: string | null;
  username: string | null;
  role: string | null;
};

export function useProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['profile', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Profile | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('id, phone_number, phone_verified_at, display_name, username, role')
        .eq('id', user.id)
        .single();
      if (error) throw error;
      return data;
    },
  });
}
