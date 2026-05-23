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
import { parseSetCode, resolveSetArt, setTypeLabel } from '@/lib/set-art';
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

  // Per-set art + accent drive the neon look. accent border + soft glow is the
  // cross-platform-safe baseline for the reference's "art-forward release row".
  const { image, accent } = resolveSetArt(set);
  const code = parseSetCode(set.name);
  const typeLabel = setTypeLabel(set.box_type);

  return (
    <View style={styles.rowWrap}>
      <View
        style={[
          styles.row,
          {
            borderColor: withAlpha(accent, 0.45),
            // Web-only neon glow in the set's accent. Native gets `elevation`
            // (Android) or simply no glow (iOS) — degrades gracefully.
            boxShadow: `0 0 18px ${withAlpha(accent, 0.22)}, inset 0 0 0 1px ${withAlpha(
              accent,
              0.08,
            )}`,
          },
        ]}
      >
        {/* Left accent bar — the always-on neon signature even where glow is unsupported. */}
        <View style={[styles.accentBar, { backgroundColor: accent }]} />

        {/* Art cell, tinted with the set's accent. Colored placeholder when no art. */}
        <View
          style={[
            styles.artCell,
            { backgroundColor: withAlpha(accent, 0.14), borderColor: withAlpha(accent, 0.35) },
          ]}
        >
          {image ? (
            <Image source={image} style={styles.artImage} contentFit="contain" transition={150} />
          ) : (
            <View style={[styles.artPlaceholder, { backgroundColor: withAlpha(accent, 0.55) }]} />
          )}
        </View>

        <View style={styles.body}>
          <View style={styles.metaTopRow}>
            {code ? (
              <View style={[styles.codeChip, { borderColor: withAlpha(accent, 0.5) }]}>
                <Text style={[styles.codeChipText, { color: accent }]}>{code}</Text>
              </View>
            ) : null}
            {typeLabel ? (
              <Text style={[styles.typeLabel, { color: accent }]} numberOfLines={1}>
                {typeLabel}
              </Text>
            ) : null}
          </View>

          <Text style={styles.name} numberOfLines={2}>
            {set.name}
          </Text>
          <Text style={styles.meta}>
            {releaseLabel}
            {relative ? ` · ${relative}` : ''}
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
              <Text
                style={[
                  styles.calButtonText,
                  chooserOpen && styles.calButtonTextActive,
                ]}
              >
                + Calendar
              </Text>
            </Pressable>
          ) : null}
          <View style={styles.brandBadge}>
            <Text style={styles.brandBadgeText}>{set.brand_id}</Text>
          </View>
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
  // card is a discrete dark surface (no hairline list separators).
  rowWrap: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingLeft: 16,
    paddingRight: 14,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: theme.surface,
    gap: 12,
    overflow: 'hidden',
  },
  accentBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  artCell: {
    width: 56,
    height: 56,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  artImage: { width: '100%', height: '100%' },
  artPlaceholder: {
    width: '70%',
    height: '70%',
    borderRadius: 8,
  },

  body: { flex: 1 },
  metaTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
  },
  codeChip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 1,
  },
  codeChipText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  typeLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  name: { fontSize: 16, fontWeight: '700', color: theme.text },
  meta: { fontSize: 13, color: theme.textMuted, marginTop: 2 },

  trailing: {
    alignItems: 'flex-end',
    gap: 6,
  },
  calButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.borderStrong,
  },
  calButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.text,
  },
  calButtonTextActive: {
    color: '#0B0E14',
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
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
  },
  chooserItemText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.text,
  },

  brandBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
  },
  brandBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.textMuted,
    textTransform: 'capitalize',
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
