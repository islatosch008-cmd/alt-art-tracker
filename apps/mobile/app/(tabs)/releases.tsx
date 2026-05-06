import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/screen-header';
import {
  daysUntil,
  groupReleases,
  type ReleaseSet,
  useReleases,
} from '@/lib/use-releases';

export default function ReleasesScreen() {
  const { data, isLoading, isRefetching, error, refetch } = useReleases();

  const headerEl = (
    <ScreenHeader
      title="Releases"
      subtitle={`${data?.length ?? 0} set${data?.length === 1 ? '' : 's'} in the catalog`}
      showSearch
    />
  );

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {headerEl}
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }
  if (error) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        {headerEl}
        <View style={styles.center}>
          <Text style={styles.errorText}>{(error as Error).message}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const sections = groupReleases(data ?? []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <SectionList
        contentContainerStyle={styles.content}
        sections={sections}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <ReleaseRow set={item} />}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderSectionFooter={({ section }) =>
          section.title === 'Upcoming' && section.data.length === 0 ? (
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
    </SafeAreaView>
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
      </View>
      <View style={styles.brandBadge}>
        <Text style={styles.brandBadgeText}>{set.brand_id}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
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
