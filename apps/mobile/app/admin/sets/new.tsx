import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
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
import { useBrands } from '@/lib/use-brands';
import { useCreateAdminSet } from '@/lib/use-admin-sets';

const SPORT_OPTIONS = [
  '', 'baseball', 'basketball', 'football', 'hockey', 'soccer',
  'wrestling', 'racing', 'ufc', 'golf', 'tennis', 'multi-sport', 'entertainment',
] as const;

const BOX_TYPE_OPTIONS = [
  '', 'hobby', 'retail', 'blaster', 'mega', 'jumbo', 'choice', 'breakers_delight',
] as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type FormState = {
  name: string;
  brand_id: string;
  sport: string;
  box_type: string;
  release_date: string;
  pre_order_opens_at: string;
  msrp_box: string;
  msrp_pack: string;
  msrp_card: string;
};

const EMPTY: FormState = {
  name: '',
  brand_id: '',
  sport: '',
  box_type: '',
  release_date: '',
  pre_order_opens_at: '',
  msrp_box: '',
  msrp_pack: '',
  msrp_card: '',
};

function toNumber(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export default function AdminSetNew() {
  const router = useRouter();
  const brands = useBrands();
  const create = useCreateAdminSet();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof FormState, v: string) =>
    setForm((p) => ({ ...p, [k]: v }));

  const dateOk = (v: string) => v === '' || DATE_RE.test(v);

  const canSubmit =
    form.name.trim().length > 0 &&
    form.brand_id !== '' &&
    dateOk(form.release_date) &&
    dateOk(form.pre_order_opens_at) &&
    !create.isPending;

  const onSubmit = async () => {
    setErr(null);
    if (!canSubmit) {
      setErr('Name and brand are required. Dates must be YYYY-MM-DD.');
      return;
    }
    try {
      const created = await create.mutateAsync({
        name: form.name.trim(),
        brand_id: form.brand_id,
        sport: form.sport || null,
        box_type: form.box_type || null,
        release_date: form.release_date.trim() || null,
        pre_order_opens_at: form.pre_order_opens_at.trim() || null,
        msrp_box: toNumber(form.msrp_box),
        msrp_pack: toNumber(form.msrp_pack),
        msrp_card: toNumber(form.msrp_card),
      });
      // Navigate to the newly-created row's edit screen so admin can
      // review + lock fields if desired.
      router.replace(`/admin/sets/${created.id}` as never);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <PageShell>
      <Stack.Screen options={{ title: 'New set' }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.h1}>New set</Text>
        <Text style={styles.sub}>
          Manual entries are tagged source=manual and never touched by the
          scrapers. Use this for upcoming sports releases the scrapers don't
          cover yet.
        </Text>

        <Field label="Name" required>
          <TextInput
            value={form.name}
            onChangeText={(v) => set('name', v)}
            placeholder="2026 Topps Series 2 Baseball Hobby"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </Field>

        <Field label="Brand" required>
          {brands.isLoading ? (
            <ActivityIndicator />
          ) : (
            <ChipRow
              options={(brands.data ?? []).map((b) => ({
                value: b.id,
                label: b.name,
              }))}
              selected={form.brand_id}
              onSelect={(v) => set('brand_id', v)}
            />
          )}
        </Field>

        <Field label="Sport">
          <ChipRow
            options={SPORT_OPTIONS.map((s) => ({
              value: s,
              label: s || '(none)',
            }))}
            selected={form.sport}
            onSelect={(v) => set('sport', v)}
          />
        </Field>

        <Field label="Box type">
          <ChipRow
            options={BOX_TYPE_OPTIONS.map((b) => ({
              value: b,
              label: b || '(none)',
            }))}
            selected={form.box_type}
            onSelect={(v) => set('box_type', v)}
          />
        </Field>

        <Field
          label="Release date"
          error={!dateOk(form.release_date) ? 'YYYY-MM-DD' : undefined}>
          <TextInput
            value={form.release_date}
            onChangeText={(v) => set('release_date', v)}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </Field>

        <Field
          label="Pre-order opens at"
          error={!dateOk(form.pre_order_opens_at) ? 'YYYY-MM-DD' : undefined}>
          <TextInput
            value={form.pre_order_opens_at}
            onChangeText={(v) => set('pre_order_opens_at', v)}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </Field>

        <View style={styles.priceRow}>
          <Field label="MSRP box ($)" style={styles.priceCol}>
            <TextInput
              value={form.msrp_box}
              onChangeText={(v) => set('msrp_box', v)}
              placeholder="0.00"
              inputMode="decimal"
              style={styles.input}
            />
          </Field>
          <Field label="MSRP pack ($)" style={styles.priceCol}>
            <TextInput
              value={form.msrp_pack}
              onChangeText={(v) => set('msrp_pack', v)}
              placeholder="0.00"
              inputMode="decimal"
              style={styles.input}
            />
          </Field>
          <Field label="MSRP card ($)" style={styles.priceCol}>
            <TextInput
              value={form.msrp_card}
              onChangeText={(v) => set('msrp_card', v)}
              placeholder="0.00"
              inputMode="decimal"
              style={styles.input}
            />
          </Field>
        </View>

        {err ? <Text style={styles.errText}>{err}</Text> : null}

        <View style={styles.actionRow}>
          <Pressable
            style={styles.btnSecondary}
            onPress={() => router.back()}
            disabled={create.isPending}>
            <Text style={styles.btnSecondaryText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.btnPrimary, !canSubmit && styles.btnDisabled]}
            onPress={onSubmit}
            disabled={!canSubmit}>
            <Text style={styles.btnPrimaryText}>
              {create.isPending ? 'Creating…' : 'Create set'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </PageShell>
  );
}

function Field({
  label,
  required,
  error,
  style,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  style?: object;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.field, style]}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
        {error ? <Text style={styles.errLabel}>{error}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function ChipRow({
  options,
  selected,
  onSelect,
}: {
  options: Array<{ value: string; label: string }>;
  selected: string;
  onSelect: (v: string) => void;
}) {
  return (
    <View style={styles.chipRow}>
      {options.map((o) => {
        const active = o.value === selected;
        return (
          <Pressable
            key={o.label}
            onPress={() => onSelect(o.value)}
            style={[styles.chip, active && styles.chipActive]}>
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 32, gap: 12 },
  h1: { fontSize: 24, fontWeight: '700' },
  sub: { fontSize: 13, color: '#666', marginBottom: 8 },

  field: { gap: 6 },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  required: { color: '#c00' },
  errLabel: { fontSize: 11, color: '#c00', fontWeight: '600' },

  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    backgroundColor: '#fff',
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
  chipActive: { backgroundColor: '#1e3a8a', borderColor: '#1e3a8a' },
  chipText: { fontSize: 12, color: '#333', fontWeight: '600' },
  chipTextActive: { color: '#fff' },

  priceRow: { flexDirection: 'row', gap: 8 },
  priceCol: { flex: 1 },

  errText: { color: '#c00', fontSize: 13, marginTop: 4 },

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
