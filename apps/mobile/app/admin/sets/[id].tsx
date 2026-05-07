import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PageShell } from '@/components/page-shell';
import {
  type AdminSetRow,
  EDITABLE_FIELDS,
  type EditableField,
  FIELD_KIND,
  useAdminSet,
  useUpdateAdminSet,
} from '@/lib/use-admin-sets';

const CONFIDENCE_OPTIONS = ['', 'high', 'medium', 'low'] as const;

type FormState = Record<EditableField, string>;

function rowToForm(row: AdminSetRow): FormState {
  return {
    name: row.name ?? '',
    brand_id: row.brand_id ?? '',
    sport: row.sport ?? '',
    box_type: row.box_type ?? '',
    release_date: row.release_date ?? '',
    pre_order_opens_at: row.pre_order_opens_at ?? '',
    msrp_box: row.msrp_box != null ? String(row.msrp_box) : '',
    msrp_pack: row.msrp_pack != null ? String(row.msrp_pack) : '',
    msrp_card: row.msrp_card != null ? String(row.msrp_card) : '',
    confidence: row.confidence ?? '',
  };
}

// Convert the form's string back to the typed value our DB expects.
function formToPatch(form: FormState, original: AdminSetRow): Partial<AdminSetRow> {
  const patch: Record<string, unknown> = {};
  for (const f of EDITABLE_FIELDS) {
    const kind = FIELD_KIND[f];
    const raw = form[f].trim();
    let next: unknown;
    if (raw === '') next = null;
    else if (kind === 'number') {
      const n = Number(raw);
      next = Number.isFinite(n) ? n : null;
    } else {
      next = raw;
    }
    if (next !== (original[f] ?? null)) patch[f] = next;
  }
  return patch as Partial<AdminSetRow>;
}

export default function AdminSetEdit() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: row, isLoading, error } = useAdminSet(id);
  const update = useUpdateAdminSet();

  const [form, setForm] = useState<FormState | null>(null);
  const [locked, setLocked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // Hydrate form when row arrives.
  useEffect(() => {
    if (row && !form) {
      setForm(rowToForm(row));
      setLocked(new Set(row.locked_fields ?? []));
    }
  }, [row, form]);

  if (isLoading) {
    return (
      <PageShell>
        <Stack.Screen options={{ title: 'Edit set' }} />
        <View style={styles.center}><ActivityIndicator /></View>
      </PageShell>
    );
  }
  if (error || !row || !form) {
    return (
      <PageShell>
        <Stack.Screen options={{ title: 'Edit set' }} />
        <View style={styles.center}>
          <Text style={styles.errorText}>
            {error ? (error as Error).message : 'Set not found'}
          </Text>
        </View>
      </PageShell>
    );
  }

  const toggleLock = (f: EditableField) => {
    setLocked((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  };

  const setField = (f: EditableField, v: string) => {
    setForm((prev) => (prev ? { ...prev, [f]: v } : prev));
  };

  const onSave = async () => {
    setMsg(null);
    const patch = formToPatch(form, row);
    const lockedNext = Array.from(locked).sort();
    const lockedPrev = [...(row.locked_fields ?? [])].sort();
    if (JSON.stringify(lockedNext) !== JSON.stringify(lockedPrev)) {
      (patch as { locked_fields?: string[] }).locked_fields = lockedNext;
    }
    if (Object.keys(patch).length === 0) {
      setMsg({ kind: 'ok', text: 'Nothing changed.' });
      return;
    }
    try {
      await update.mutateAsync({ id: row.id, patch });
      setMsg({ kind: 'ok', text: 'Saved. Scrapers will skip locked fields on next run.' });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    }
  };

  const dirty =
    JSON.stringify(form) !== JSON.stringify(rowToForm(row)) ||
    JSON.stringify([...locked].sort()) !==
      JSON.stringify((row.locked_fields ?? []).slice().sort());

  return (
    <PageShell>
      <Stack.Screen options={{ title: row.name.length > 30 ? row.name.slice(0, 30) + '…' : row.name }} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.metaCard}>
          <Text style={styles.metaTitle}>{row.name}</Text>
          <Text style={styles.metaLine}>
            source: <Text style={styles.mono}>{row.source}</Text>
            {row.source_id ? (
              <Text>
                {' · '}id: <Text style={styles.mono}>{row.source_id}</Text>
              </Text>
            ) : null}
          </Text>
          {row.last_synced_at ? (
            <Text style={styles.metaLine}>
              last synced: {new Date(row.last_synced_at).toLocaleString()}
            </Text>
          ) : null}
        </View>

        {EDITABLE_FIELDS.map((f) => (
          <FieldRow
            key={f}
            field={f}
            value={form[f]}
            locked={locked.has(f)}
            onChange={(v) => setField(f, v)}
            onToggleLock={() => toggleLock(f)}
          />
        ))}

        {msg ? (
          <Text style={[styles.msg, msg.kind === 'err' ? styles.msgErr : styles.msgOk]}>
            {msg.text}
          </Text>
        ) : null}

        <View style={styles.actionRow}>
          <Pressable
            style={[styles.btnSecondary]}
            onPress={() => router.back()}>
            <Text style={styles.btnSecondaryText}>Back</Text>
          </Pressable>
          <Pressable
            style={[styles.btnPrimary, (!dirty || update.isPending) && styles.btnDisabled]}
            disabled={!dirty || update.isPending}
            onPress={onSave}>
            <Text style={styles.btnPrimaryText}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </PageShell>
  );
}

function FieldRow({
  field,
  value,
  locked,
  onChange,
  onToggleLock,
}: {
  field: EditableField;
  value: string;
  locked: boolean;
  onChange: (v: string) => void;
  onToggleLock: () => void;
}) {
  const kind = FIELD_KIND[field];
  return (
    <View style={[styles.fieldRow, locked && styles.fieldRowLocked]}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{field}</Text>
        <Pressable onPress={onToggleLock} hitSlop={8} style={styles.lockToggle}>
          <Text style={styles.lockIcon}>{locked ? '🔒' : '🔓'}</Text>
          <Text style={[styles.lockLabel, locked && styles.lockLabelOn]}>
            {locked ? 'LOCKED' : 'unlocked'}
          </Text>
        </Pressable>
      </View>
      {kind === 'enum:confidence' ? (
        <View style={styles.enumRow}>
          {CONFIDENCE_OPTIONS.map((opt) => (
            <Pressable
              key={opt || 'none'}
              onPress={() => onChange(opt)}
              style={[styles.enumChip, value === opt && styles.enumChipActive]}>
              <Text style={[styles.enumText, value === opt && styles.enumTextActive]}>
                {opt || '(none)'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <TextInput
          value={value}
          onChangeText={onChange}
          placeholder={
            kind === 'date'
              ? 'YYYY-MM-DD'
              : kind === 'number'
                ? '0.00'
                : ''
          }
          inputMode={kind === 'number' ? 'decimal' : 'text'}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 8, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errorText: { color: '#c00', fontSize: 14, textAlign: 'center' },

  metaCard: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 8,
  },
  metaTitle: { fontSize: 16, fontWeight: '700', color: '#111', marginBottom: 4 },
  metaLine: { fontSize: 12, color: '#666' },
  mono: { fontFamily: 'monospace', color: '#444' },

  fieldRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
    gap: 6,
  },
  fieldRowLocked: { backgroundColor: '#fef9c3', borderColor: '#fde68a' },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
  lockToggle: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  lockIcon: { fontSize: 14 },
  lockLabel: { fontSize: 10, fontWeight: '700', color: '#999' },
  lockLabelOn: { color: '#92400e' },

  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#fff',
    fontFamily: 'monospace',
  },
  enumRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  enumChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  enumChipActive: { backgroundColor: '#111', borderColor: '#111' },
  enumText: { fontSize: 12, color: '#333', fontWeight: '600' },
  enumTextActive: { color: '#fff' },

  msg: { fontSize: 13, marginTop: 8, paddingHorizontal: 4 },
  msgOk: { color: '#0a7d3a' },
  msgErr: { color: '#c00' },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  btnPrimary: {
    flex: 1,
    backgroundColor: '#1e3a8a',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  btnSecondary: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  btnSecondaryText: { color: '#444', fontWeight: '600', fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
});
