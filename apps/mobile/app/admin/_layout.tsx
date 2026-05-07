// Admin gate. RLS on the underlying tables already blocks writes by
// non-admins (public.is_admin() helper), so this layer is purely UX —
// non-admins shouldn't see admin URLs at all.

import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { useAuth } from '@/lib/auth';
import { useIsAdmin } from '@/lib/use-is-admin';
import { useProfile } from '@/lib/use-profile';

export default function AdminLayout() {
  const { session, loading: authLoading } = useAuth();
  const { isLoading: profileLoading } = useProfile();
  const isAdmin = useIsAdmin();

  // Wait for auth + profile to settle before deciding.
  if (authLoading || profileLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) return <Redirect href="/login" />;
  if (!isAdmin) return <Redirect href="/(tabs)" />;

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerTitleStyle: { fontWeight: '700' },
      }}
    />
  );
}
