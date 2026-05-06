import { Stack } from 'expo-router';
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

import { IconSymbol } from '@/components/ui/icon-symbol';
import { TrendingCardRow } from '@/components/trending-card';
import { useDebounce } from '@/lib/use-debounce';
import { SEARCH_MIN_LEN, useSearchCards } from '@/lib/use-search';

export default function SearchScreen() {
  const [input, setInput] = useState('');
  const debounced = useDebounce(input, 250);
  const { data, isLoading, isFetching, error } = useSearchCards(debounced);

  const tooShort = input.trim().length > 0 && input.trim().length < SEARCH_MIN_LEN;
  const hasQuery = debounced.trim().length >= SEARCH_MIN_LEN;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Search', headerBackTitle: 'Back' }} />

      <View style={styles.searchBar}>
        <IconSymbol name="magnifyingglass" size={18} color="#888" />
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="Search cards by name…"
          placeholderTextColor="#aaa"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
        />
        {input.length > 0 ? (
          <Pressable onPress={() => setInput('')} hitSlop={8}>
            <IconSymbol name="xmark.circle.fill" size={20} color="#bbb" />
          </Pressable>
        ) : null}
      </View>

      {input.length === 0 ? (
        <Empty title="Type to search" sub="Try “Charizard”, “Mega”, or any card name." />
      ) : tooShort ? (
        <Empty title="Keep typing…" sub={`At least ${SEARCH_MIN_LEN} characters.`} />
      ) : isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : error ? (
        <Empty title="Search failed" sub={(error as Error).message} />
      ) : (data ?? []).length === 0 ? (
        <Empty title="No matches" sub={`Nothing in our catalog matches “${debounced}”.`} />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <TrendingCardRow card={item} />}
          ListHeaderComponent={
            <View style={styles.resultsHeader}>
              <Text style={styles.resultsCount}>
                {data!.length} match{data!.length === 1 ? '' : 'es'}
                {data!.length === 50 ? ' (showing first 50)' : ''}
              </Text>
              {isFetching && hasQuery ? (
                <ActivityIndicator size="small" color="#888" />
              ) : null}
            </View>
          }
          keyboardShouldPersistTaps="handled"
        />
      )}
    </View>
  );
}

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySub}>{sub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    margin: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#111',
    padding: 0,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#444',
  },
  emptySub: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    maxWidth: 320,
  },
  resultsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 4,
    paddingBottom: 8,
  },
  resultsCount: {
    fontSize: 12,
    color: '#888',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
