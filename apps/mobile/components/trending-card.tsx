import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatUsd } from '@/lib/money';
import { theme } from '@/lib/theme';
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
    borderBottomColor: theme.border,
    alignItems: 'center',
  },
  rowPressed: { backgroundColor: theme.surfaceHover },
  chevron: { fontSize: 24, color: theme.textFaint, fontWeight: '300' },
  image: {
    width: 60,
    height: 84,
    borderRadius: 6,
    backgroundColor: theme.surfaceAlt,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.text,
  },
  meta: {
    fontSize: 12,
    color: theme.textMuted,
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
    backgroundColor: 'rgba(255, 209, 0, 0.16)',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FFD000',
  },
  score: {
    fontSize: 12,
    color: theme.textMuted,
    fontVariant: ['tabular-nums'],
  },
  reason: {
    fontSize: 11,
    color: theme.textMuted,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },
  reasonUp: {
    color: theme.success,
    fontWeight: '600',
  },
  reasonDown: {
    color: theme.danger,
    fontWeight: '600',
  },
  reasonFlat: {
    color: theme.textMuted,
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
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  priceLabel: {
    fontSize: 9,
    fontWeight: '600',
    color: theme.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  priceMissing: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.textFaint,
    fontStyle: 'italic',
  },
});
