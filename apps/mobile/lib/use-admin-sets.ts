// Admin sets list + single-set fetch + update with locked_fields support.
//
// The trust hierarchy lives in two places:
//   1. _shared/scraper.ts:upsertScrapedReleases() skips fields in
//      sets.locked_fields when applying scraper data.
//   2. This module — admin can edit any field AND toggle its lock state.
// Locking is sticky: once a field is locked here, it stays locked until
// the admin explicitly unlocks it.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from './supabase';

const LIMIT = 100;

export type AdminSetRow = {
  id: string;
  name: string;
  brand_id: string;
  source: string;
  source_id: string | null;
  sport: string | null;
  box_type: string | null;
  release_date: string | null;
  pre_order_opens_at: string | null;
  msrp_box: number | null;
  msrp_pack: number | null;
  msrp_card: number | null;
  confidence: string | null;
  last_synced_at: string | null;
  locked_fields: string[];
};

export type AdminSetFilters = {
  q?: string; // name search (case-insensitive contains)
  brandId?: string | null;
  source?: string | null;
};

export function useAdminSets(filters: AdminSetFilters = {}) {
  return useQuery<AdminSetRow[]>({
    queryKey: ['admin', 'sets', filters],
    queryFn: async () => {
      let q = supabase
        .from('sets')
        .select(
          'id, name, brand_id, source, source_id, sport, box_type, release_date, pre_order_opens_at, msrp_box, msrp_pack, msrp_card, confidence, last_synced_at, locked_fields',
        )
        .order('release_date', { ascending: false, nullsFirst: false })
        .limit(LIMIT);
      if (filters.q && filters.q.length > 0) {
        q = q.ilike('name', `%${filters.q.replace(/[%_\\]/g, (m) => '\\' + m)}%`);
      }
      if (filters.brandId) q = q.eq('brand_id', filters.brandId);
      if (filters.source) q = q.eq('source', filters.source);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AdminSetRow[];
    },
    staleTime: 30_000,
  });
}

export function useAdminSet(id: string | undefined) {
  return useQuery<AdminSetRow | null>({
    queryKey: ['admin', 'set', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sets')
        .select(
          'id, name, brand_id, source, source_id, sport, box_type, release_date, pre_order_opens_at, msrp_box, msrp_pack, msrp_card, confidence, last_synced_at, locked_fields',
        )
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as AdminSetRow;
    },
  });
}

// Manual creation (always source='manual'). Server-side insert via the
// authenticated admin user — RLS allows it because public.is_admin().
export function useCreateAdminSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Partial<AdminSetRow> & { name: string; brand_id: string }) => {
      const { error, data } = await supabase
        .from('sets')
        .insert({
          ...input,
          source: 'manual',
          source_id: null,
          last_synced_at: null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'sets'] });
    },
  });
}

// Patch the set; locked_fields is patched as part of the same row update so
// the lock state and edited values stay consistent.
export function useUpdateAdminSet() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      patch: Partial<AdminSetRow>;
    }) => {
      const { error, data } = await supabase
        .from('sets')
        .update(args.patch)
        .eq('id', args.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['admin', 'sets'] });
      qc.invalidateQueries({ queryKey: ['admin', 'set', vars.id] });
    },
  });
}

// Convenience constants for the edit form.
export const EDITABLE_FIELDS = [
  'name',
  'brand_id',
  'sport',
  'box_type',
  'release_date',
  'pre_order_opens_at',
  'msrp_box',
  'msrp_pack',
  'msrp_card',
  'confidence',
] as const;

export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_KIND: Record<EditableField, 'text' | 'date' | 'number' | 'enum:confidence'> = {
  name: 'text',
  brand_id: 'text',
  sport: 'text',
  box_type: 'text',
  release_date: 'date',
  pre_order_opens_at: 'date',
  msrp_box: 'number',
  msrp_pack: 'number',
  msrp_card: 'number',
  confidence: 'enum:confidence',
};
