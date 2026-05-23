import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Brand } from '@/lib/use-brands';

type Props = {
  brands: Brand[] | undefined;
  selected: string | null;
  onSelect: (brandId: string | null) => void;
};

// Compact single-button replacement for the old wrapping brand-chip row.
// The button shows the current selection; tapping it opens a Modal picker
// listing "All" + every brand. Modal renders at the app root, so this works
// fine even when the button lives inside a SectionList header (releases.tsx).
export function BrandFilter({ brands, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  const list = brands ?? [];
  const selectedBrand = selected ? list.find((b) => b.id === selected) : undefined;
  const label = selectedBrand ? selectedBrand.name : 'Filter: All';
  const active = selected !== null;

  function choose(id: string | null) {
    onSelect(id);
    setOpen(false);
  }

  return (
    <View style={styles.bar}>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button">
        <View style={[styles.button, active && styles.buttonActive]}>
          <Text style={[styles.buttonText, active && styles.buttonTextActive]}>
            {label} ▾
          </Text>
        </View>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        {/* Tap-to-dismiss backdrop. */}
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Close brand filter"
        >
          {/* Inner Pressable swallows taps so the sheet itself doesn't dismiss. */}
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Filter by brand</Text>
            <ScrollView style={styles.optionList}>
              <Option
                label="All"
                active={selected === null}
                onPress={() => choose(null)}
              />
              {list.map((b) => (
                <Option
                  key={b.id}
                  label={b.name}
                  active={selected === b.id}
                  onPress={() => choose(b.id)}
                />
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Option({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      <View style={[styles.option, active && styles.optionActive]}>
        <Text style={[styles.optionText, active && styles.optionTextActive]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#f2f2f2',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  buttonActive: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  buttonText: {
    fontSize: 13,
    color: '#333',
    fontWeight: '600',
  },
  buttonTextActive: {
    color: '#fff',
  },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxWidth: 360,
    maxHeight: '80%',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    // Subtle elevation so the sheet reads above the backdrop on web/native.
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  sheetTitle: {
    fontSize: 12,
    color: '#888',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 8,
  },
  optionList: {
    flexGrow: 0,
  },
  option: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 4,
    backgroundColor: '#f2f2f2',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  optionActive: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  optionText: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
  },
  optionTextActive: {
    color: '#fff',
  },
});
