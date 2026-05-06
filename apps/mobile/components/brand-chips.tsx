import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Brand } from '@/lib/use-brands';

type Props = {
  brands: Brand[] | undefined;
  selected: string | null;
  onSelect: (brandId: string | null) => void;
};

export function BrandChips({ brands, selected, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}>
      <Chip label="All" active={selected === null} onPress={() => onSelect(null)} />
      {(brands ?? []).map((b) => (
        <Chip
          key={b.id}
          label={b.name}
          active={selected === b.id}
          onPress={() => onSelect(b.id)}
        />
      ))}
    </ScrollView>
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
    paddingHorizontal: 24,
    gap: 8,
    paddingBottom: 12,
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
