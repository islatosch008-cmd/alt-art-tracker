import { Stack } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PageShell } from '@/components/page-shell';
import {
  type Conflict,
  usePendingConflicts,
  useResolveConflict,
} from '@/lib/use-conflicts';

export default function ConflictsScreen() {
  const { data, isLoading, error, isRefetching, refetch } = usePendingConflicts();
  const resolve = useResolveConflict();

  return (
    <PageShell>
      <Stack.Screen options={{ title: 'Conflicts' }} />

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{(error as Error).message}</Text>
        </View>
      ) : (data ?? []).length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyTitle}>No pending conflicts</Text>
          <Text style={styles.emptySub}>
            Conflicts are written when the AI agent disagrees with a scraper
            on the same release. Resolved or dismissed entries don’t show
            here.
          </Text>
          <Pressable style={styles.refreshBtn} onPress={() => refetch()}>
            <Text style={styles.refreshText}>{isRefetching ? '…' : 'Refresh'}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ConflictCard
              conflict={item}
              busy={resolve.isPending}
              onAction={(action) => resolve.mutate({ conflict: item, action })}
            />
          )}
        />
      )}
    </PageShell>
  );
}

function ConflictCard({
  conflict,
  busy,
  onAction,
}: {
  conflict: Conflict;
  busy: boolean;
  onAction: (a: 'keep_a' | 'keep_b' | 'dismiss') => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.setName} numberOfLines={2}>
        {conflict.set?.name ?? '(set deleted)'}
      </Text>
      <Text style={styles.fieldLine}>
        Field: <Text style={styles.fieldName}>{conflict.field_name}</Text>
      </Text>

      <ValueRow
        label={conflict.source_a}
        value={conflict.value_a}
        confidence={conflict.confidence_a}
      />
      <ValueRow
        label={conflict.source_b}
        value={conflict.value_b}
        confidence={conflict.confidence_b}
      />

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.btn, styles.btnA, busy && styles.btnDisabled]}
          disabled={busy}
          onPress={() => onAction('keep_a')}>
          <Text style={styles.btnText}>Keep A</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnB, busy && styles.btnDisabled]}
          disabled={busy}
          onPress={() => onAction('keep_b')}>
          <Text style={styles.btnText}>Keep B</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnDismiss, busy && styles.btnDisabled]}
          disabled={busy}
          onPress={() => onAction('dismiss')}>
          <Text style={styles.btnTextDismiss}>Dismiss</Text>
        </Pressable>
      </View>

      <Text style={styles.lockNote}>
        Choosing Keep A or Keep B locks <Text style={styles.code}>{conflict.field_name}</Text> on
        this set so future scraper runs won’t overwrite it.
      </Text>
    </View>
  );
}

function ValueRow({
  label,
  value,
  confidence,
}: {
  label: string;
  value: string | null;
  confidence: string | null;
}) {
  return (
    <View style={styles.valueRow}>
      <Text style={styles.valueLabel}>{label}</Text>
      <Text style={styles.value}>{value ?? '—'}</Text>
      {confidence ? (
        <View style={[styles.conf, confColor(confidence)]}>
          <Text style={styles.confText}>{confidence}</Text>
        </View>
      ) : null}
    </View>
  );
}

function confColor(c: string) {
  if (c === 'high') return { backgroundColor: '#dcfce7' };
  if (c === 'medium') return { backgroundColor: '#fef3c7' };
  if (c === 'low') return { backgroundColor: '#fee2e2' };
  return { backgroundColor: '#f1f5f9' };
}

const styles = StyleSheet.create({
  list: { padding: 16, gap: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  errorText: { color: '#c00', fontSize: 14, textAlign: 'center' },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#444' },
  emptySub: { fontSize: 13, color: '#888', textAlign: 'center', maxWidth: 360 },
  refreshBtn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  refreshText: { fontSize: 13, fontWeight: '600', color: '#333' },

  card: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    padding: 16,
    backgroundColor: '#fff',
    gap: 6,
  },
  setName: { fontSize: 16, fontWeight: '700', color: '#111' },
  fieldLine: { fontSize: 12, color: '#888', marginBottom: 6 },
  fieldName: { fontFamily: 'monospace', fontWeight: '700', color: '#333' },

  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#f3f3f3',
  },
  valueLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
    minWidth: 100,
    textAlign: 'center',
  },
  value: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'monospace',
    color: '#111',
  },
  conf: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
  confText: { fontSize: 10, fontWeight: '700', color: '#374151', textTransform: 'uppercase' },

  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnA: { backgroundColor: '#1e3a8a' },
  btnB: { backgroundColor: '#166534' },
  btnDismiss: { backgroundColor: '#f3f4f6', borderWidth: 1, borderColor: '#ddd' },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  btnTextDismiss: { color: '#444', fontWeight: '600', fontSize: 13 },

  lockNote: { fontSize: 11, color: '#888', fontStyle: 'italic', marginTop: 8 },
  code: { fontFamily: 'monospace', color: '#444' },
});
