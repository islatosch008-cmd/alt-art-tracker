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
import { TrendingCardCell } from '@/components/trending-card-cell';
import { useBrands } from '@/lib/use-brands';
import { useGridCols } from '@/lib/use-grid-cols';
import { useHeatingUpCards } from '@/lib/use-heating-up';

export default function HeatingUpScreen() {
  const [brand, setBrand] = useState<string | null>(null);
  const brands = useBrands();
  const heating = useHeatingUpCards(brand);
  const cols = useGridCols();

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScreenHeader
        title="Heating Up"
        subtitle="Predictive — what's accelerating before it peaks"
        showSearch
      />
      <BrandChips brands={brands.data} selected={brand} onSelect={setBrand} />

      {heating.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : heating.error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{(heating.error as Error).message}</Text>
        </View>
      ) : (heating.data ?? []).length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>Nothing heating up yet</Text>
          <Text style={styles.emptySub}>
            Cards from sets released in the last ~90 days qualify. Older sets
            stay cold.
          </Text>
        </View>
      ) : (
        <FlatList
          data={heating.data}
          keyExtractor={(card) => card.id}
          key={`grid-${cols}`}
          numColumns={cols}
          columnWrapperStyle={cols > 1 ? styles.gridRow : undefined}
          contentContainerStyle={styles.gridContent}
          renderItem={({ item }) => <TrendingCardCell card={item} />}
          refreshControl={
            <RefreshControl
              refreshing={heating.isRefetching}
              onRefresh={() => heating.refetch()}
            />
          }
          ListFooterComponent={
            <Text style={styles.footer}>
              Placeholder ranking by mid-tier rarity + recency. Real predictive
              math (price + volume acceleration vs 30-day baseline) wires up
              Week 2.
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
    gap: 6,
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#444' },
  emptySub: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    maxWidth: 320,
  },
  errorText: { color: '#c00', fontSize: 14, textAlign: 'center' },
  gridContent: { paddingHorizontal: 12, paddingTop: 4 },
  gridRow: { gap: 8, marginBottom: 8 },
  footer: {
    color: '#aaa',
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 16,
    paddingHorizontal: 24,
  },
});
