import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatUsd } from '@/lib/money';
import { theme } from '@/lib/theme';
import type { TrendingCard } from '@/lib/use-trending';

const BLURHASH = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

// Grid cell version of a trending card (image hero centered above title).
// Used in the Trending and Heating Up feeds with FlatList numColumns from
// useGridCols(). For dense list contexts (search results) use TrendingCardRow.
export function TrendingCardCell({ card }: { card: TrendingCard }) {
  // trending_score is already normalized to 0..100 by compute-trending.
  const score = card.trending_score ?? 0;
  const scoreText = score > 0 ? Math.min(100, Math.round(score)).toString() : '—';
  const setName = card.sets?.name ?? '';

  // Why-it-trends reason line. Momentum (▲/▼ X% · 7d) only when measured
  // (null = no data, not flat); listings ("· N listings") only when known.
  // Both null => render nothing (no placeholder).
  const momentum = card.trending_momentum_pct;
  const listings = card.trending_listings;
  const hasReason = momentum != null || listings != null;
  const momentumUp = momentum != null && momentum > 0;
  const momentumDown = momentum != null && momentum < 0;

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
          {card.current_price != null ? (
            <>
              <Text style={styles.price}>{formatUsd(card.current_price)}</Text>
              <Text style={styles.priceLabel}>last sold</Text>
            </>
          ) : (
            <Text style={styles.priceMissing}>price syncing</Text>
          )}
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
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  cellPressed: { backgroundColor: theme.surfaceHover },
  imageWrap: {
    width: '100%',
    aspectRatio: 5 / 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: theme.surfaceAlt,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  name: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.text,
    paddingHorizontal: 4,
  },
  meta: {
    fontSize: 11,
    color: theme.textMuted,
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
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  priceLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: theme.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  priceMissing: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.textFaint,
    fontStyle: 'italic',
  },
  reason: {
    fontSize: 11,
    color: theme.textMuted,
    marginTop: 4,
    paddingHorizontal: 4,
    fontVariant: ['tabular-nums'],
  },
  reasonUp: {
    color: theme.success,
    fontWeight: '700',
  },
  reasonDown: {
    color: theme.danger,
    fontWeight: '700',
  },
  reasonFlat: {
    color: theme.textMuted,
    fontWeight: '700',
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
    backgroundColor: 'rgba(255, 209, 0, 0.16)',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFD000',
  },
  score: {
    fontSize: 11,
    color: theme.textMuted,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
});
