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

import { BrandChips } from '@/components/brand-chips';
import { PageShell } from '@/components/page-shell';
import { ScreenHeader } from '@/components/screen-header';
import { addToCalendar } from '@/lib/calendar';
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
      <BrandChips brands={brands} selected={brandId} onSelect={setBrandId} />
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

  return (
    <View style={styles.row}>
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
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
            style={[styles.calButton, chooserOpen && styles.calButtonActive]}
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
  errorText: { color: '#c00', fontSize: 14, textAlign: 'center' },

  sectionHeader: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 6,
    backgroundColor: '#fff',
  },
  sectionTitle: {
    fontSize: 12,
    color: '#888',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Tappable "Past drops" header — same type language, a touch more prominent
  // and visibly interactive (separator above, darker label).
  pastToggle: {
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#f2f2f2',
  },
  pastToggleTitle: {
    color: '#555',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#f2f2f2',
    gap: 12,
  },
  body: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: '#111' },
  meta: { fontSize: 13, color: '#666', marginTop: 2 },

  trailing: {
    alignItems: 'flex-end',
    gap: 6,
  },
  calButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#f2f2f2',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  calButtonActive: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  calButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  calButtonTextActive: {
    color: '#fff',
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
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  chooserItemText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },

  brandBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: '#f1f5f9',
  },
  brandBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'capitalize',
  },

  upcomingEmpty: {
    paddingHorizontal: 24,
    paddingVertical: 18,
    alignItems: 'flex-start',
    gap: 4,
  },
  upcomingEmptyTitle: { fontSize: 14, fontWeight: '600', color: '#444' },
  upcomingEmptyHint: { fontSize: 12, color: '#999' },

  footer: {
    color: '#aaa',
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingTop: 16,
    paddingHorizontal: 24,
  },
});
