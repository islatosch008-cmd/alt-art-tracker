import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatUsd } from '@/lib/money';
import type { TrendingCard } from '@/lib/use-trending';

const BLURHASH = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

export function TrendingCardRow({ card }: { card: TrendingCard }) {
  const score = card.popularity_score ?? 0;
  // Cap at 100 — placeholder backfill can produce 100+ until the real
  // sigmoid-normalized algorithm lands. Cosmetic only.
  const scoreText = score > 0 ? Math.min(100, Math.round(score)).toString() : '—';
  const setName = card.sets?.name ?? '';

  return (
    <Link href={`/cards/${card.id}`} asChild>
      <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
        <Image
          source={card.image_url ?? undefined}
          style={styles.image}
          contentFit="cover"
          transition={150}
          placeholder={{ blurhash: BLURHASH }}
        />
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>
            {card.name}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            {setName}
            {card.card_number ? ` · #${card.card_number}` : ''}
          </Text>
          <View style={styles.row2}>
            {card.rarity ? (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{card.rarity}</Text>
              </View>
            ) : null}
            <Text style={styles.score}>score {scoreText}</Text>
          </View>
        </View>
        <View style={styles.priceCol}>
          {card.current_price != null ? (
            <>
              <Text style={styles.price}>{formatUsd(card.current_price)}</Text>
              <Text style={styles.priceLabel}>last sold</Text>
            </>
          ) : (
            <Text style={styles.priceMissing}>syncing</Text>
          )}
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 24,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f2f2f2',
    alignItems: 'center',
  },
  rowPressed: { backgroundColor: '#f7f7f7' },
  chevron: { fontSize: 24, color: '#ccc', fontWeight: '300' },
  image: {
    width: 60,
    height: 84,
    borderRadius: 6,
    backgroundColor: '#eee',
  },
  body: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
  },
  meta: {
    fontSize: 12,
    color: '#666',
  },
  row2: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: '#fef3c7',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#92400e',
  },
  score: {
    fontSize: 12,
    color: '#888',
    fontVariant: ['tabular-nums'],
  },
  priceCol: {
    alignItems: 'flex-end',
    gap: 2,
    minWidth: 64,
  },
  price: {
    fontSize: 15,
    fontWeight: '700',
    color: '#111',
    fontVariant: ['tabular-nums'],
  },
  priceLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: '#aaa',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  priceMissing: {
    fontSize: 12,
    fontWeight: '600',
    color: '#aaa',
    fontStyle: 'italic',
  },
});
