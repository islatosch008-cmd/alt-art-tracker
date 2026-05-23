import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/lib/theme';

type Props = {
  title: string;
  subtitle?: string;
};

// Single source of truth for tab-screen headers. Replaces React Navigation's
// header (which we hide on tabs) so we don't get a duplicate title.
export function ScreenHeader({ title, subtitle }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.titleBlock}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
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
  title: { fontSize: 28, fontWeight: '700', color: theme.text },
  subtitle: { fontSize: 14, color: theme.textMuted, marginTop: 2 },
});
