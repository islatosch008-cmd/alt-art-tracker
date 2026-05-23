import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatUsd } from '@/lib/money';
import type { TrendingCard } from '@/lib/use-trending';

const BLURHASH = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

export function TrendingCardRow({ card }: { card: TrendingCard }) {
  const score = card.trending_score ?? 0;
  // trending_score is already normalized to 0..100 by compute-trending;
  // the Math.min cap is a harmless belt-and-suspenders guard.
  const scoreText = score > 0 ? Math.min(100, Math.round(score)).toString() : '—';
  const setName = card.sets?.name ?? '';

  // Why-it-trends reason line. Momentum (▲/▼ X% · 7d) only when we have data
  // (null = unmeasured, not flat); listings ("· N listings") only when known.
  // If both are null we render nothing — no placeholder.
  const momentum = card.trending_momentum_pct;
  const listings = card.trending_listings;
  const hasReason = momentum != null || listings != null;
  const momentumUp = momentum != null && momentum > 0;
  const momentumDown = momentum != null && momentum < 0;

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
          {hasReason ? (
            <Text style={styles.reason} numberOfLines={1}>
              {momentum != null ? (
                <Text
                  style={
                    momentumUp
                      ? styles.reasonUp
                      : momentumDown
                        ? styles.reasonDown
                        : styles.reasonFlat
                  }
                >
                  {momentumUp ? '▲ ' : momentumDown ? '▼ ' : ''}
                  {Math.abs(momentum).toFixed(1)}% · 7d
                </Text>
              ) : null}
              {momentum != null && listings != null ? ' · ' : ''}
              {listings != null ? `${listings} listings` : ''}
            </Text>
          ) : null}
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
  reason: {
    fontSize: 11,
    color: '#888',
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  reasonUp: {
    color: '#16a34a',
    fontWeight: '600',
  },
  reasonDown: {
    color: '#dc2626',
    fontWeight: '600',
  },
  reasonFlat: {
    color: '#888',
    fontWeight: '600',
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
