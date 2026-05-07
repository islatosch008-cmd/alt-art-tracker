// Pending set_conflicts queue + resolution mutations. Resolution flow:
//   - Keep A    → write value_a to sets[field_name], lock the field, mark resolved_a
//   - Keep B    → write value_b to sets[field_name], lock the field, mark resolved_b
//   - Dismiss   → leave set untouched, mark dismissed
// Locking is intentional — a manual choice should not get re-clobbered by the
// next daily scrape; that's the whole point of locked_fields.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from './supabase';
import { useAuth } from './auth';

export type Conflict = {
  id: number;
  set_id: string;
  source_a: string;
  source_b: string;
  field_name: string;
  value_a: string | null;
  value_b: string | null;
  confidence_a: string | null;
  confidence_b: string | null;
  status: 'pending' | 'resolved_a' | 'resolved_b' | 'resolved_manual' | 'dismissed';
  created_at: string;
  set: { id: string; name: string; brand_id: string; locked_fields: string[] } | null;
};

const QKEY = ['admin', 'conflicts', 'pending'] as const;

export function usePendingConflicts() {
  return useQuery<Conflict[]>({
    queryKey: QKEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('set_conflicts')
        .select(
          'id, set_id, source_a, source_b, field_name, value_a, value_b, confidence_a, confidence_b, status, created_at, set:sets(id, name, brand_id, locked_fields)',
        )
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown as Conflict[]).map((c) => ({
        ...c,
        set: Array.isArray(c.set) ? c.set[0] ?? null : c.set,
      }));
    },
    staleTime: 30_000,
  });
}

// Coerce the text-stored value back to whatever the column type wants.
// Most fields stay text; a few are numeric or date.
const NUMERIC_FIELDS = new Set(['msrp_box', 'msrp_pack', 'msrp_card']);
const DATE_FIELDS = new Set(['release_date', 'pre_order_opens_at']);
function coerce(field: string, raw: string | null): string | number | null {
  if (raw == null || raw === '') return null;
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  // DATE fields stored as YYYY-MM-DD; supabase accepts the string.
  return raw;
}

async function applyResolution(
  conflict: Conflict,
  pickedValue: string | null,
  status: 'resolved_a' | 'resolved_b' | 'resolved_manual' | 'dismissed',
  resolvedBy: string,
) {
  // 1. Update the underlying set if the resolution chose a value.
  if (status !== 'dismissed' && conflict.set_id && pickedValue !== undefined) {
    const value = coerce(conflict.field_name, pickedValue);
    const lockedNext = Array.from(
      new Set([...(conflict.set?.locked_fields ?? []), conflict.field_name]),
    );
    const { error: updErr } = await supabase
      .from('sets')
      .update({ [conflict.field_name]: value, locked_fields: lockedNext })
      .eq('id', conflict.set_id);
    if (updErr) throw updErr;
  }

  // 2. Mark the conflict resolved.
  const { error } = await supabase
    .from('set_conflicts')
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: resolvedBy,
    })
    .eq('id', conflict.id);
  if (error) throw error;
}

export function useResolveConflict() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (args: {
      conflict: Conflict;
      action: 'keep_a' | 'keep_b' | 'dismiss';
    }) => {
      if (!user) throw new Error('not signed in');
      const { conflict, action } = args;
      switch (action) {
        case 'keep_a':
          return applyResolution(conflict, conflict.value_a, 'resolved_a', user.id);
        case 'keep_b':
          return applyResolution(conflict, conflict.value_b, 'resolved_b', user.id);
        case 'dismiss':
          return applyResolution(conflict, null, 'dismissed', user.id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QKEY });
    },
  });
}
