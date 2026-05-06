import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandChips } from '@/components/brand-chips';
import { ScreenHeader } from '@/components/screen-header';
import { TrendingCardRow } from '@/components/trending-card';
import { useBrands } from '@/lib/use-brands';
import { useTrendingCards } from '@/lib/use-trending';

export default function TrendingScreen() {
  const [brand, setBrand] = useState<string | null>(null);
  const brands = useBrands();
  const trending = useTrendingCards(brand);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader title="Trending Now" subtitle="Cards moving today" showSearch />
      <BrandChips brands={brands.data} selected={brand} onSelect={setBrand} />

      {trending.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : trending.error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>
            {(trending.error as Error).message ?? 'Failed to load trending'}
          </Text>
        </View>
      ) : (trending.data ?? []).length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No cards in this view yet</Text>
        </View>
      ) : (
        <FlatList
          data={trending.data}
          keyExtractor={(card) => card.id}
          renderItem={({ item }) => <TrendingCardRow card={item} />}
          refreshControl={
            <RefreshControl
              refreshing={trending.isRefetching}
              onRefresh={() => trending.refetch()}
            />
          }
          ListFooterComponent={
            <Text style={styles.footer}>
              Placeholder ranking by rarity + recency. Real prices and signals wire
              up Week 2.
            </Text>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: { color: '#c00', fontSize: 14, textAlign: 'center' },
  emptyText: { color: '#999', fontSize: 14 },
  footer: {
    color: '#aaa',
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
});
