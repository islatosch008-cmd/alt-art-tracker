import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from './auth';
import { supabase } from './supabase';

// Subset of public.user_preferences the Settings screen reads/writes.
// The row itself is created by a signup trigger — clients only ever update it.
export type Preferences = {
  user_id: string;
  sms_enabled: boolean;
  drop_alerts_enabled: boolean;
  release_alerts_enabled: boolean;
};

const COLUMNS = 'user_id, sms_enabled, drop_alerts_enabled, release_alerts_enabled';

export function usePreferences() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['preferences', user?.id],
    enabled: !!user,
    queryFn: async (): Promise<Preferences | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('user_preferences')
        .select(COLUMNS)
        .eq('user_id', user.id)
        .single();
      if (error) throw error;
      return data as Preferences;
    },
  });
}

// Patches one or more boolean columns on the user's preferences row and
// refreshes the cached query so toggles reflect the persisted value.
export function useUpdatePreferences() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Omit<Preferences, 'user_id'>>) => {
      if (!user) throw new Error('Not signed in');
      const { error } = await supabase
        .from('user_preferences')
        .update(patch)
        .eq('user_id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['preferences', user?.id] });
    },
  });
}
