import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';

import { AuthProvider, useAuth } from '@/lib/auth';
import { QueryProvider } from '@/lib/query-client';
import { theme } from '@/lib/theme';

export const unstable_settings = {
  anchor: '(tabs)',
};

// App-wide dark navigation theme. Drives the native Stack header (card detail)
// and the default scene background so there's no white flash between screens.
const navDarkTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: theme.bg,
    card: theme.surface,
    border: theme.border,
    text: theme.text,
    primary: theme.accentDefault,
  },
};

const AUTH_ROUTES = new Set(['login', 'signup']);

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const top = segments[0] ?? '';
    const inAuthRoute = AUTH_ROUTES.has(top);

    if (!session && !inAuthRoute) {
      router.replace('/login');
    } else if (session && inAuthRoute) {
      router.replace('/(tabs)');
    }
  }, [session, loading, segments, router]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.bg,
        }}>
        <ActivityIndicator color={theme.accentDefault} />
      </View>
    );
  }
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <QueryProvider>
      <AuthProvider>
        <ThemeProvider value={navDarkTheme}>
          <AuthGate>
            <Stack
              screenOptions={{
                contentStyle: { backgroundColor: theme.bg },
              }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ headerShown: false }} />
              <Stack.Screen name="signup" options={{ headerShown: false }} />
            </Stack>
          </AuthGate>
          <StatusBar style="light" />
        </ThemeProvider>
      </AuthProvider>
    </QueryProvider>
  );
}
