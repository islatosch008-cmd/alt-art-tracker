import { Link, Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PageShell } from '@/components/page-shell';
import { useDebounce } from '@/lib/use-debounce';
import { type AdminSetRow, useAdminSets } from '@/lib/use-admin-sets';
import { useBrands } from '@/lib/use-brands';

const SOURCES: Array<{ id: string | null; label: string }> = [
  { id: null, label: 'All' },
  { id: 'manual', label: 'Manual' },
  { id: 'ai_research', label: 'AI' },
  { id: 'cardboardconnection_scraper', label: 'CC' },
  { id: 'leaf_scraper', label: 'Leaf' },
  { id: 'tcgcsv', label: 'TCGCSV' },
  { id: 'pokemon_tcg_api', label: 'Poke API' },
];

export default function AdminSetsList() {
  const [q, setQ] = useState('');
  const [brandId, setBrandId] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const debouncedQ = useDebounce(q, 250);
  const brands = useBrands();
  const sets = useAdminSets({ q: debouncedQ, brandId, source });

  return (
    <PageShell>
      <Stack.Screen
        options={{
          title: 'Sets',
          headerRight: () => (
            <Link href="/admin/sets/new" asChild>
              <Pressable hitSlop={8} style={{ paddingHorizontal: 12 }}>
                <Text style={styles.headerNewBtn}>+ New</Text>
              </Pressable>
            </Link>
          ),
        }}
      />

      <View style={styles.searchBar}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search by name…"
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
      </View>

      <FilterChips
        label="Brand"
        items={[
          { id: null, label: 'All' },
          ...((brands.data ?? []).map((b) => ({ id: b.id, label: b.name }))),
        ]}
        selected={brandId}
        onSelect={setBrandId}
      />
      <FilterChips
        label="Source"
        items={SOURCES}
        selected={source}
        onSelect={setSource}
      />

      {sets.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : sets.error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{(sets.error as Error).message}</Text>
        </View>
      ) : (sets.data ?? []).length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>No sets match these filters.</Text>
        </View>
      ) : (
        <FlatList
          data={sets.data}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <SetRow set={item} />}
          ListHeaderComponent={
            <Text style={styles.count}>
              {(sets.data ?? []).length} sets
              {(sets.data ?? []).length === 100 ? ' (showing first 100)' : ''}
            </Text>
          }
        />
      )}
    </PageShell>
  );
}

function FilterChips({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string;
  items: Array<{ id: string | null; label: string }>;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <View style={styles.chipBlock}>
      <Text style={styles.chipBlockLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {items.map((it) => {
          const active = it.id === selected;
          return (
            <Pressable
              key={it.label}
              onPress={() => onSelect(it.id)}
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {it.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function SetRow({ set }: { set: AdminSetRow }) {
  const lockedCount = set.locked_fields?.length ?? 0;
  return (
    <Link href={`/admin/sets/${set.id}` as never} asChild>
      <Pressable style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={styles.rowName} numberOfLines={1}>
            {set.name}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {set.brand_id} · {set.source}
            {set.release_date ? ` · ${set.release_date}` : ''}
            {set.sport ? ` · ${set.sport}` : ''}
          </Text>
        </View>
        {lockedCount > 0 ? (
          <View style={styles.lockPill}>
            <Text style={styles.lockText}>🔒 {lockedCount}</Text>
          </View>
        ) : null}
        <Text style={styles.chevron}>›</Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  headerNewBtn: { fontSize: 14, fontWeight: '700', color: '#1e3a8a' },
  searchBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#f9fafb',
  },
  chipBlock: { paddingHorizontal: 16, paddingTop: 8 },
  chipBlockLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  chipActive: { backgroundColor: '#111', borderColor: '#111' },
  chipText: { fontSize: 12, color: '#333', fontWeight: '600' },
  chipTextActive: { color: '#fff' },

  count: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 8,
  },
  listContent: { paddingBottom: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 24,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  rowPressed: { backgroundColor: '#f9fafb' },
  rowName: { fontSize: 15, fontWeight: '600', color: '#111' },
  rowMeta: { fontSize: 12, color: '#666' },
  lockPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: '#fef3c7',
  },
  lockText: { fontSize: 11, fontWeight: '700', color: '#92400e' },
  chevron: { fontSize: 22, color: '#bbb' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { color: '#c00', fontSize: 14, textAlign: 'center' },
  empty: { color: '#888', fontSize: 14 },
});
