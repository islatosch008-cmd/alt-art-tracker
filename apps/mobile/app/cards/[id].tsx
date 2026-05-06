import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useCard } from '@/lib/use-card';

const HERO_BLURHASH = 'L6PZfSi_.AyE_3t7t7R**0o#DgR4';

export default function CardDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: card, isLoading, error } = useCard(id);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Loading…' }} />
        <ActivityIndicator />
      </View>
    );
  }
  if (error || !card) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ title: 'Not found' }} />
        <Text style={styles.errorText}>
          {error ? (error as Error).message : 'Card not found'}
        </Text>
      </View>
    );
  }

  const setName = card.sets?.name ?? '';
  const releaseDate = card.sets?.release_date
    ? new Date(card.sets.release_date).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;
  const score = Math.round(card.popularity_score ?? 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: card.name, headerBackTitle: 'Back' }} />

      <View style={styles.heroWrap}>
        <View style={styles.hero}>
          <Image
            source={card.image_url ?? undefined}
            style={styles.heroImage}
            contentFit="contain"
            transition={200}
            placeholder={{ blurhash: HERO_BLURHASH }}
          />
        </View>
      </View>

      <View style={styles.titleBlock}>
        <Text style={styles.name}>{card.name}</Text>
        <Text style={styles.subtitle}>
          {setName}
          {card.card_number ? ` · #${card.card_number}` : ''}
        </Text>
        <View style={styles.badgeRow}>
          {card.rarity ? <Badge color="amber">{card.rarity}</Badge> : null}
          <Badge color="slate">
            {card.brands?.name ?? card.brand_id}
          </Badge>
          {card.is_sealed ? <Badge color="green">Sealed</Badge> : null}
        </View>
      </View>

      <Stat label="Popularity" hint={popularityHint(score)}>
        <View style={styles.scoreRow}>
          <Text style={styles.scoreNumber}>{score}</Text>
          <Text style={styles.scoreOutOf}> / 100</Text>
        </View>
        <ProgressBar value={score} max={100} />
      </Stat>

      <Stat label="Current price" hint="Live prices light up Week 2 (PriceCharting + eBay).">
        <Text style={styles.priceNumber}>
          {card.current_price != null ? `$${card.current_price.toFixed(2)}` : '—'}
        </Text>
      </Stat>

      <Stat label="Price history (90d)" hint="Empty until the price scraper runs.">
        <View style={styles.chartPlaceholder}>
          <Text style={styles.chartPlaceholderText}>No price data yet</Text>
        </View>
      </Stat>

      {releaseDate ? (
        <Stat label="Set">
          <Text style={styles.metaValue}>{setName}</Text>
          <Text style={styles.metaSub}>Released {releaseDate}</Text>
        </Stat>
      ) : null}

      <View style={styles.buyRow}>
        <Pressable style={[styles.buyButton, styles.buyDisabled]} disabled>
          <Text style={styles.buyText}>Buy on TCGplayer</Text>
        </Pressable>
        <Pressable style={[styles.buyButton, styles.buyDisabled]} disabled>
          <Text style={styles.buyText}>Buy on eBay</Text>
        </Pressable>
      </View>
      <Text style={styles.disclosure}>
        Affiliate links wire up Week 4. Some links earn us a commission at no cost to you.
      </Text>
    </ScrollView>
  );
}

function Stat({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      {children}
      {hint ? <Text style={styles.statHint}>{hint}</Text> : null}
    </View>
  );
}

function Badge({
  color,
  children,
}: {
  color: 'amber' | 'slate' | 'green';
  children: React.ReactNode;
}) {
  const palette = {
    amber: { bg: '#fef3c7', fg: '#92400e' },
    slate: { bg: '#f1f5f9', fg: '#475569' },
    green: { bg: '#dcfce7', fg: '#166534' },
  }[color];
  return (
    <View style={[styles.badge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.badgeText, { color: palette.fg }]}>{children}</Text>
    </View>
  );
}

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${pct}%` }]} />
    </View>
  );
}

function popularityHint(score: number): string {
  if (score >= 90) return 'Top tier — among the hottest cards in the catalog.';
  if (score >= 75) return 'Strong demand. Often a chase card from its set.';
  if (score >= 60) return 'Above-average interest.';
  if (score >= 45) return 'Mid-tier interest.';
  return 'Lower demand right now.';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  content: { paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  errorText: { color: '#c00', fontSize: 14 },

  heroWrap: {
    backgroundColor: '#fafafa',
    paddingVertical: 28,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  hero: {
    width: 240,
    aspectRatio: 5 / 7,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#eee',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  heroImage: { width: '100%', height: '100%' },

  titleBlock: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 8,
  },
  name: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  stat: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#f5f5f5',
  },
  statLabel: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  statHint: {
    fontSize: 11,
    color: '#999',
    marginTop: 6,
    fontStyle: 'italic',
  },

  scoreRow: { flexDirection: 'row', alignItems: 'baseline' },
  scoreNumber: {
    fontSize: 30,
    fontWeight: '700',
    color: '#111',
    fontVariant: ['tabular-nums'],
  },
  scoreOutOf: { fontSize: 14, color: '#888' },
  barTrack: {
    height: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 999,
    marginTop: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: '#111',
    borderRadius: 999,
  },

  priceNumber: {
    fontSize: 30,
    fontWeight: '700',
    color: '#111',
    fontVariant: ['tabular-nums'],
  },

  chartPlaceholder: {
    height: 120,
    borderWidth: 1,
    borderColor: '#eee',
    borderStyle: 'dashed',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fafafa',
  },
  chartPlaceholderText: {
    color: '#aaa',
    fontSize: 13,
  },

  metaValue: { fontSize: 16, fontWeight: '600', color: '#111' },
  metaSub: { fontSize: 12, color: '#888', marginTop: 2 },

  buyRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingTop: 20,
    gap: 8,
  },
  buyButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#111',
  },
  buyDisabled: {
    backgroundColor: '#ddd',
  },
  buyText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  disclosure: {
    fontSize: 11,
    color: '#aaa',
    fontStyle: 'italic',
    paddingHorizontal: 24,
    paddingTop: 10,
    textAlign: 'center',
  },
});
