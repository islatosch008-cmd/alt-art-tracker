import { Link, Tabs } from 'expo-router';
import React from 'react';
import { Pressable } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const tint = Colors[colorScheme ?? 'light'].tint;

  const SearchHeaderButton = () => (
    <Link href="/search" asChild>
      <Pressable style={{ paddingHorizontal: 16, paddingVertical: 4 }} hitSlop={8}>
        <IconSymbol size={22} name="magnifyingglass" color={tint} />
      </Pressable>
    </Link>
  );

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: tint,
        headerShown: true,
        tabBarButton: HapticTab,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Trending',
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="chart.line.uptrend.xyaxis" color={color} />
          ),
          headerRight: SearchHeaderButton,
        }}
      />
      <Tabs.Screen
        name="heating-up"
        options={{
          title: 'Heating Up',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="flame.fill" color={color} />,
          headerRight: SearchHeaderButton,
        }}
      />
      <Tabs.Screen
        name="releases"
        options={{
          title: 'Releases',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="calendar" color={color} />,
          headerRight: SearchHeaderButton,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="gearshape.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
