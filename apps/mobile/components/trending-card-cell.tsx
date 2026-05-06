import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatUsd } from '@/lib/money';
import type { TrendingCard } from '@/lib/use-trending';

const BLURHASH = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

// Grid cell version of a trending card (image hero centered above title).
// Used in the Trending and Heating Up feeds with FlatList numColumns from
// useGridCols(). For dense list contexts (search results) use TrendingCardRow.
export function TrendingCardCell({ card }: { card: TrendingCard }) {
  const score = card.popularity_score ?? 0;
  const scoreText = score > 0 ? Math.min(100, Math.round(score)).toString() : '—';
  const setName = card.sets?.name ?? '';

  return (
    <Link href={`/cards/${card.id}`} asChild>
      <Pressable style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}>
        <View style={styles.imageWrap}>
          <Image
            source={card.image_url ?? undefined}
            style={styles.image}
            contentFit="contain"
            transition={150}
            placeholder={{ blurhash: BLURHASH }}
          />
        </View>
        <Text style={styles.name} numberOfLines={2}>
          {card.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {setName}
          {card.card_number ? ` · #${card.card_number}` : ''}
        </Text>

        <View style={styles.priceRow}>
          <Text style={styles.price}>{formatUsd(card.current_price)}</Text>
          <Text style={styles.priceLabel}>last sold</Text>
        </View>

        <View style={styles.bottomRow}>
          {card.rarity ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText} numberOfLines={1}>
                {card.rarity}
              </Text>
            </View>
          ) : (
            <View />
          )}
          <Text style={styles.score}>{scoreText}</Text>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    paddingHorizontal: 6,
    paddingTop: 6,
    paddingBottom: 12,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  cellPressed: { backgroundColor: '#f7f7f7' },
  imageWrap: {
    width: '100%',
    aspectRatio: 5 / 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#f0f0f0',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111',
    paddingHorizontal: 4,
  },
  meta: {
    fontSize: 11,
    color: '#777',
    marginTop: 2,
    paddingHorizontal: 4,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  price: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111',
    fontVariant: ['tabular-nums'],
  },
  priceLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingHorizontal: 4,
    gap: 6,
  },
  badge: {
    flexShrink: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#fef3c7',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#92400e',
  },
  score: {
    fontSize: 11,
    color: '#888',
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
