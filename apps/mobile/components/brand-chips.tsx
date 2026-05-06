import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Brand } from '@/lib/use-brands';

type Props = {
  brands: Brand[] | undefined;
  selected: string | null;
  onSelect: (brandId: string | null) => void;
};

// Plain row of chips (was a horizontal ScrollView; switched to View+wrap so
// content respects parent padding and doesn't overflow on narrow viewports).
// Phase 1 has 3 brands, so wrap behavior is fine.
export function BrandChips({ brands, selected, onSelect }: Props) {
  return (
    <View style={styles.row}>
      <Chip label="All" active={selected === null} onPress={() => onSelect(null)} />
      {(brands ?? []).map((b) => (
        <Chip
          key={b.id}
          label={b.name}
          active={selected === b.id}
          onPress={() => onSelect(b.id)}
        />
      ))}
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <View style={[styles.chip, active && styles.chipActive]}>
        <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 24,
    paddingBottom: 12,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f2f2f2',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  chipActive: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  chipText: {
    fontSize: 13,
    color: '#333',
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#fff',
  },
});
