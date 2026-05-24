import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BrandFilter } from '@/components/brand-filter';
import { PageShell } from '@/components/page-shell';
import { ScreenHeader } from '@/components/screen-header';
import { addToCalendar } from '@/lib/calendar';
import { resolveSetArt, setTypeLabel, shortSetCode } from '@/lib/set-art';
import { theme, withAlpha } from '@/lib/theme';
import { useBrands } from '@/lib/use-brands';
import {
  daysUntil,
  groupReleases,
  type ReleaseSection,
  type ReleaseSet,
  useReleases,
} from '@/lib/use-releases';

// Section feed for the screen. `kind` lets the renderer tell apart the
// upcoming section, the tappable "Past drops" toggle, and a past month group.
type DisplaySection = ReleaseSection & {
  kind: 'upcoming' | 'pastToggle' | 'pastMonth';
};

// Compact "Mon D, YYYY" used inside the calendar chooser labels.
function shortDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ReleasesScreen() {
  const { data, isLoading, isRefetching, error, refetch } = useReleases();
  const { data: brands } = useBrands();

  // null = "All"; otherwise a brands.id to narrow by TCG/brand.
  const [brandId, setBrandId] = useState<string | null>(null);

  const filtered = useMemo(
    () => (brandId ? (data ?? []).filter((s) => s.brand_id === brandId) : (data ?? [])),
    [data, brandId],
  );

  // Past drops are hidden behind a collapsible header, collapsed by default.
  const [pastExpanded, setPastExpanded] = useState(false);

  const headerEl = (
    <>
      <ScreenHeader
        title="Upcoming Drops"
        subtitle={`${filtered.length} set${filtered.length === 1 ? '' : 's'}${
          brandId ? ' in this brand' : ' in the catalog'
        }`}
      />
      <BrandFilter brands={brands} selected={brandId} onSelect={setBrandId} />
    </>
  );

  if (isLoading) {
    return (
      <PageShell>
        {headerEl}
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </PageShell>
    );
  }
  if (error) {
    return (
      <PageShell>
        {headerEl}
        <View style={styles.center}>
          <Text style={styles.errorText}>{(error as Error).message}</Text>
        </View>
      </PageShell>
    );
  }

  const grouped = groupReleases(filtered);
  // groupReleases always returns the "Upcoming" section first, then one
  // month-titled section per past month.
  const upcomingSection = grouped[0];
  const pastSections = grouped.slice(1);
  const pastCount = pastSections.reduce((n, s) => n + s.data.length, 0);

  // Build the SectionList feed:
  //  - always the upcoming section
  //  - a zero-row "Past drops" toggle section (only when there ARE past drops)
  //  - the real month sections, only while expanded
  const sections: DisplaySection[] = [{ ...upcomingSection, kind: 'upcoming' }];
  if (pastCount > 0) {
    sections.push({ title: 'Past drops', data: [], kind: 'pastToggle' });
    if (pastExpanded) {
      for (const s of pastSections) {
        sections.push({ ...s, kind: 'pastMonth' });
      }
    }
  }

  return (
    <PageShell>
      <SectionList<ReleaseSet, DisplaySection>
        contentContainerStyle={styles.content}
        sections={sections}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <ReleaseRow set={item} />}
        renderSectionHeader={({ section }) => {
          if (section.kind === 'pastToggle') {
            return (
              <Pressable
                style={[styles.sectionHeader, styles.pastToggle]}
                onPress={() => setPastExpanded((open) => !open)}
                accessibilityRole="button"
                accessibilityState={{ expanded: pastExpanded }}
                accessibilityLabel={`${pastExpanded ? 'Collapse' : 'Expand'} past drops, ${pastCount} ${
                  pastCount === 1 ? 'release' : 'releases'
                }`}
              >
                <Text style={[styles.sectionTitle, styles.pastToggleTitle]}>
                  {pastExpanded ? '▾' : '▸'} Past drops ({pastCount})
                </Text>
              </Pressable>
            );
          }
          return (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </View>
          );
        }}
        renderSectionFooter={({ section }) =>
          section.kind === 'upcoming' && section.data.length === 0 ? (
            <View style={styles.upcomingEmpty}>
              <Text style={styles.upcomingEmptyTitle}>
                No upcoming releases tracked yet
              </Text>
              <Text style={styles.upcomingEmptyHint}>
                When new sets are announced, the import job picks them up.
              </Text>
            </View>
          ) : null
        }
        stickySectionHeadersEnabled
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={() => refetch()} />
        }
        ListHeaderComponent={headerEl}
        ListFooterComponent={
          <Text style={styles.footer}>
            Pre-order dates are still empty in Phase 1. Manual entry per release in Week 4.
          </Text>
        }
      />
    </PageShell>
  );
}

function ReleaseRow({ set }: { set: ReleaseSet }) {
  const days = set.release_date ? daysUntil(set.release_date) : null;
  const releaseLabel = set.release_date
    ? new Date(set.release_date).toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Unknown';

  let relative = '';
  if (days !== null) {
    if (days === 0) relative = 'today';
    else if (days > 0) relative = `in ${days} day${days === 1 ? '' : 's'}`;
    else relative = `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`;
  }

  const hasPreOrder = !!set.pre_order_opens_at;
  const hasRelease = !!set.release_date;
  const hasAnyDate = hasPreOrder || hasRelease;
  const hasBothDates = hasPreOrder && hasRelease;

  // Only relevant for the both-dates case: toggles the inline chooser.
  const [chooserOpen, setChooserOpen] = useState(false);

  function addPreOrder() {
    if (!set.pre_order_opens_at) return;
    addToCalendar({
      uid: `${set.id}-preorder@altarttracker`,
      title: `${set.name} — pre-orders open`,
      date: set.pre_order_opens_at,
      description: `Alt Art Tracker reminder · ${set.name}`,
    });
    setChooserOpen(false);
  }

  function addRelease() {
    if (!set.release_date) return;
    addToCalendar({
      uid: `${set.id}-release@altarttracker`,
      title: `${set.name} — releases`,
      date: set.release_date,
      description: `Alt Art Tracker reminder · ${set.name}`,
    });
    setChooserOpen(false);
  }

  // Single-date drops add directly; both-date drops toggle the chooser.
  function onCalendarPress() {
    if (hasBothDates) {
      setChooserOpen((open) => !open);
    } else if (hasPreOrder) {
      addPreOrder();
    } else {
      addRelease();
    }
  }

  // Per-set art + accent drive the look: a dark "art + code" cell on the left,
  // a white body, and the set's accent as a thin seam + bottom-right stripe.
  const { image, accent } = resolveSetArt(set);
  const code = shortSetCode(set.name); // '' only if the name has no usable chars
  const typeLabel = setTypeLabel(set.box_type);

  // Brand pill text: capitalize and de-underscore the raw brand_id.
  const brandLabel = set.brand_id
    ? set.brand_id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : '';

  return (
    <View style={styles.rowWrap}>
      {/* Outer card carries the subtle angular skew + clipping. */}
      <View style={styles.cardSkew}>
        {/* Inner content counter-skews so all text/layout stays upright. */}
        <View style={styles.cardInner}>
          {/* 1. Left art + code cell (dark navy). */}
          <View style={styles.artCell}>
            {image ? (
              <Image
                source={image}
                style={styles.artImage}
                contentFit="cover"
                contentPosition="right"
                transition={150}
              />
            ) : null}
            {/* Accent tint over the art so the white code reads on any image. */}
            <View
              style={[styles.artTint, { backgroundColor: withAlpha(accent, image ? 0.28 : 0.16) }]}
            />
            <View style={styles.artLabel}>
              {code ? (
                <Text style={styles.codeText} numberOfLines={1}>
                  {code}
                </Text>
              ) : null}
              {typeLabel ? (
                <Text style={styles.typeLabel} numberOfLines={1}>
                  {typeLabel}
                </Text>
              ) : null}
            </View>
            {/* Thin vertical accent seam where the dark cell meets the white body. */}
            <View style={[styles.artSeam, { backgroundColor: accent }]} />
          </View>

          {/* 2. Body (white). */}
          <View style={styles.body}>
            <Text style={styles.name} numberOfLines={2}>
              {set.name}
            </Text>
            <Text style={styles.meta} numberOfLines={1}>
              {releaseLabel}
              {relative ? ` • ${relative}` : ''}
            </Text>

            {hasBothDates && chooserOpen ? (
              <View style={styles.chooser}>
                <Pressable
                  style={styles.chooserItem}
                  onPress={addPreOrder}
                  accessibilityRole="button"
                  accessibilityLabel={`Add pre-order open date for ${set.name} to calendar`}
                >
                  <Text style={styles.chooserItemText}>
                    Pre-orders open ({shortDate(set.pre_order_opens_at!)})
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.chooserItem}
                  onPress={addRelease}
                  accessibilityRole="button"
                  accessibilityLabel={`Add release date for ${set.name} to calendar`}
                >
                  <Text style={styles.chooserItemText}>
                    Releases ({shortDate(set.release_date!)})
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {/* 3. Right cell (white): calendar pill + brand badge. */}
          <View style={styles.trailing}>
            {hasAnyDate ? (
              <Pressable
                style={[
                  styles.calButton,
                  chooserOpen && { backgroundColor: accent, borderColor: accent },
                ]}
                onPress={onCalendarPress}
                accessibilityRole="button"
                accessibilityLabel={`Add ${set.name} to calendar`}
              >
                <Text style={[styles.calButtonText, chooserOpen && styles.calButtonTextActive]}>
                  📅 CALENDAR
                </Text>
              </Pressable>
            ) : null}
            {brandLabel ? (
              <View style={styles.brandBadge}>
                <Text style={styles.brandBadgeText}>{brandLabel}</Text>
              </View>
            ) : null}
          </View>

          {/* Diagonal accent stripe along the card's bottom-right edge. */}
          <View style={[styles.accentStripe, { backgroundColor: accent }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 32 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  errorText: { color: theme.danger, fontSize: 14, textAlign: 'center' },

  sectionHeader: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 6,
    backgroundColor: theme.bg,
  },
  sectionTitle: {
    fontSize: 12,
    color: theme.textMuted,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Tappable "Past drops" header — same type language, a touch more prominent
  // and visibly interactive (separator above, brighter label).
  pastToggle: {
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  pastToggleTitle: {
    color: theme.text,
  },

  // Outer wrapper provides horizontal page padding + vertical rhythm so each
  // card is a discrete surface (no hairline list separators).
  rowWrap: {
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  // Outer card: white body + subtle angular skew for the "tech-frame" feel.
  // The skew is intentionally tiny (-3deg); the inner row counter-skews so all
  // text stays upright. overflow:hidden keeps the art cover + accent stripe
  // inside the rounded, slanted frame.
  cardSkew: {
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    transform: [{ skewX: '-3deg' }],
    // Soft lift off the dark page bg. Web reads box-shadow; Android elevation.
    boxShadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
    elevation: 4,
  },
  // Inner row carries the counter-skew so content renders upright, and holds
  // the three cells in a single row.
  cardInner: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 92,
    transform: [{ skewX: '3deg' }],
  },

  // 1. Dark "art + code" cell. The slight negative margin + extra width hide
  // the skewed left edge so the navy reaches the card corner cleanly.
  artCell: {
    width: 138,
    marginLeft: -6,
    backgroundColor: '#0E1626',
    overflow: 'hidden',
    justifyContent: 'flex-start',
  },
  artImage: { ...StyleSheet.absoluteFillObject, width: undefined, height: undefined },
  artTint: { ...StyleSheet.absoluteFillObject },
  artLabel: {
    paddingTop: 12,
    paddingHorizontal: 14,
    paddingLeft: 18,
  },
  codeText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.5,
    // Black outline so the white code stays legible over any artwork.
    textShadowColor: '#000000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  typeLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#E6ECF5',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginTop: 3,
    textShadowColor: '#000000',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Vertical accent seam on the cell's right edge against the white body.
  artSeam: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: 3,
  },

  // 2. White body.
  body: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  name: { fontSize: 16, fontWeight: '700', color: '#0B0E14', lineHeight: 20 },
  meta: { fontSize: 13, color: '#6B7280', marginTop: 4 },

  // 3. Right cell.
  trailing: {
    width: 150,
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingRight: 16,
  },
  calButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#0B0E14',
  },
  calButtonText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0B0E14',
    letterSpacing: 0.5,
  },
  calButtonTextActive: {
    color: '#FFFFFF',
  },

  chooser: {
    marginTop: 8,
    gap: 6,
    alignItems: 'flex-start',
  },
  chooserItem: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F1F3F7',
    borderWidth: 1,
    borderColor: '#D7DCE5',
  },
  chooserItemText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#0B0E14',
  },

  brandBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#F1F3F7',
    borderWidth: 1,
    borderColor: '#E2E6ED',
  },
  brandBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6B7280',
    textTransform: 'capitalize',
    letterSpacing: 0.3,
  },

  // Diagonal colored cut along the bottom-right edge of the card. A thin bar
  // rotated ~ -18deg reads as the angled accent slash from the mockup.
  accentStripe: {
    position: 'absolute',
    right: -14,
    bottom: -10,
    width: 120,
    height: 10,
    borderRadius: 4,
    transform: [{ rotate: '-24deg' }],
  },

  upcomingEmpty: {
    paddingHorizontal: 24,
    paddingVertical: 18,
    alignItems: 'flex-start',
    gap: 4,
  },
  upcomingEmptyTitle: { fontSize: 14, fontWeight: '600', color: theme.text },
  upcomingEmptyHint: { fontSize: 12, color: theme.textMuted },

  footer: {
    color: theme.textFaint,
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingTop: 16,
    paddingHorizontal: 24,
  },
});
