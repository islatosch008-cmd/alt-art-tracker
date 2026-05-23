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

import { formatUsd } from '@/lib/money';
import { theme } from '@/lib/theme';
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
  // Cap at 100 — placeholder formula can produce 100+ until the real
  // sigmoid-normalized algorithm lands.
  const score = Math.min(100, Math.round(card.popularity_score ?? 0));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: card.name, headerBackTitle: 'Back' }} />

      <View style={styles.heroWrap}>
        <View style={styles.hero}>
          <View style={styles.heroInner}>
            <Image
              source={card.image_url ?? undefined}
              style={styles.heroImage}
              contentFit="contain"
              transition={200}
              placeholder={{ blurhash: HERO_BLURHASH }}
            />
          </View>
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

      <Stat
        label="Last sold (avg)"
        hint={priceSourceHint(card.last_price_check_at, card.current_price)}>
        {card.current_price != null ? (
          <>
            <Text style={styles.priceNumber}>{formatUsd(card.current_price)}</Text>
            <View style={styles.priceTable}>
              <PriceRow
                label="TCGplayer market"
                value={card.tcgplayer_market_price}
                tag={card.last_price_check_at ? 'live' : 'placeholder'}
              />
              <PriceRow
                label="eBay (avg of recent sold)"
                value={card.ebay_avg_price}
                tag={card.tcgplayer_market_price != null ? 'estimated' : 'no-data'}
              />
            </View>
          </>
        ) : (
          <View style={styles.pricePending}>
            <Text style={styles.pricePendingTitle}>No price data yet</Text>
            <Text style={styles.pricePendingSub}>
              Newer sets show up here once the Pokemon TCG API or eBay API
              returns data for them.
            </Text>
          </View>
        )}
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

type PriceTag = 'live' | 'estimated' | 'placeholder' | 'no-data';

function PriceRow({
  label,
  value,
  tag,
}: {
  label: string;
  value: number | null;
  tag: PriceTag;
}) {
  const tagStyle =
    tag === 'live'
      ? styles.tagLive
      : tag === 'estimated'
        ? styles.tagEst
        : tag === 'no-data'
          ? styles.tagPlaceholder
          : styles.tagPlaceholder;
  const tagText =
    tag === 'live'
      ? 'live'
      : tag === 'estimated'
        ? 'estimated'
        : tag === 'no-data'
          ? 'awaiting eBay'
          : 'placeholder';
  return (
    <View style={styles.priceTableRow}>
      <View style={styles.priceTableLabelCol}>
        <Text style={styles.priceTableLabel}>{label}</Text>
        <View style={[styles.tagPill, tagStyle]}>
          <Text style={styles.tagText}>{tagText}</Text>
        </View>
      </View>
      <Text style={styles.priceTableValue}>{formatUsd(value)}</Text>
    </View>
  );
}

function priceSourceHint(
  lastCheckAt: string | null,
  currentPrice: number | null,
): string {
  if (currentPrice == null) {
    return 'No price feed yet. The Pokemon TCG API doesn’t list this card; eBay scraper takes over once credentials are wired.';
  }
  if (!lastCheckAt) {
    return 'Placeholder until prices refresh — run `npm run refresh:prices`.';
  }
  const when = new Date(lastCheckAt).toLocaleString();
  return `TCGplayer market is live (Pokemon TCG API, refreshed ${when}). eBay is estimated until the eBay scraper runs.`;
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
    amber: { bg: 'rgba(255, 209, 0, 0.16)', fg: '#FFD000' },
    slate: { bg: 'rgba(138, 147, 166, 0.18)', fg: '#B6BECC' },
    green: { bg: 'rgba(61, 220, 132, 0.16)', fg: '#3DDC84' },
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
  container: { flex: 1, backgroundColor: theme.bg },
  content: { paddingBottom: 40 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.bg,
  },
  errorText: { color: theme.danger, fontSize: 14 },

  heroWrap: {
    backgroundColor: theme.surface,
    paddingVertical: 28,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  hero: {
    width: 240,
    aspectRatio: 5 / 7,
    borderRadius: 12,
    backgroundColor: theme.surfaceAlt,
    // boxShadow works cross-platform on RN 0.76+ and silences the
    // shadow* deprecation warning on web.
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
  },
  heroInner: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    overflow: 'hidden',
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
    color: theme.text,
  },
  subtitle: {
    fontSize: 14,
    color: theme.textMuted,
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
    borderTopColor: theme.border,
  },
  statLabel: {
    fontSize: 12,
    color: theme.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  statHint: {
    fontSize: 11,
    color: theme.textFaint,
    marginTop: 6,
    fontStyle: 'italic',
  },

  scoreRow: { flexDirection: 'row', alignItems: 'baseline' },
  scoreNumber: {
    fontSize: 30,
    fontWeight: '700',
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  scoreOutOf: { fontSize: 14, color: theme.textMuted },
  barTrack: {
    height: 6,
    backgroundColor: theme.surfaceAlt,
    borderRadius: 999,
    marginTop: 8,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    backgroundColor: theme.accentDefault,
    borderRadius: 999,
  },

  priceNumber: {
    fontSize: 30,
    fontWeight: '700',
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },
  priceTable: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  pricePending: {
    marginTop: 4,
    paddingVertical: 16,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
    borderStyle: 'dashed',
    gap: 4,
  },
  pricePendingTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.text,
  },
  pricePendingSub: {
    fontSize: 12,
    color: theme.textMuted,
  },
  priceTableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  priceTableLabelCol: {
    flex: 1,
    gap: 4,
  },
  priceTableLabel: {
    fontSize: 13,
    color: theme.textMuted,
  },
  tagPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 3,
  },
  tagLive: { backgroundColor: 'rgba(61, 220, 132, 0.16)' },
  tagEst: { backgroundColor: 'rgba(255, 209, 0, 0.16)' },
  tagPlaceholder: { backgroundColor: 'rgba(138, 147, 166, 0.18)' },
  tagText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: theme.textMuted,
  },
  priceTableValue: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.text,
    fontVariant: ['tabular-nums'],
  },

  chartPlaceholder: {
    height: 120,
    borderWidth: 1,
    borderColor: theme.border,
    borderStyle: 'dashed',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surfaceAlt,
  },
  chartPlaceholderText: {
    color: theme.textFaint,
    fontSize: 13,
  },

  metaValue: { fontSize: 16, fontWeight: '600', color: theme.text },
  metaSub: { fontSize: 12, color: theme.textMuted, marginTop: 2 },

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
    backgroundColor: theme.accentDefault,
  },
  buyDisabled: {
    backgroundColor: theme.surfaceHover,
  },
  buyText: {
    color: theme.textMuted,
    fontSize: 14,
    fontWeight: '600',
  },
  disclosure: {
    fontSize: 11,
    color: theme.textFaint,
    fontStyle: 'italic',
    paddingHorizontal: 24,
    paddingTop: 10,
    textAlign: 'center',
  },
});
