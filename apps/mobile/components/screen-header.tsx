import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconSymbol } from '@/components/ui/icon-symbol';

type Props = {
  title: string;
  subtitle?: string;
  showSearch?: boolean;
};

// Single source of truth for tab-screen headers. Replaces React Navigation's
// header (which we hide on tabs) so we don't get a duplicate title.
export function ScreenHeader({ title, subtitle, showSearch = false }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.titleBlock}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {showSearch ? (
        <Link href="/search" asChild>
          <Pressable style={styles.searchButton} hitSlop={10}>
            <IconSymbol name="magnifyingglass" size={22} color="#444" />
          </Pressable>
        </Link>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 12,
  },
  titleBlock: { flex: 1 },
  title: { fontSize: 28, fontWeight: '700', color: '#111' },
  subtitle: { fontSize: 14, color: '#666', marginTop: 2 },
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
});
