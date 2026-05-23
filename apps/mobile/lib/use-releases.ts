import { useQuery } from '@tanstack/react-query';

import { supabase } from './supabase';

export type ReleaseSet = {
  id: string;
  name: string;
  brand_id: string;
  box_type: string | null;
  release_date: string | null;
  pre_order_opens_at: string | null;
};

export function useReleases() {
  return useQuery<ReleaseSet[]>({
    queryKey: ['releases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sets')
        .select('id, name, brand_id, box_type, release_date, pre_order_opens_at')
        .order('release_date', { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as ReleaseSet[];
    },
    staleTime: 5 * 60_000, // releases rarely change in a session
  });
}

export type ReleaseSection = { title: string; data: ReleaseSet[] };

// Split into Upcoming (release_date >= today) and Recent, with Recent further
// grouped by "Month YYYY". Returns SectionList-shaped sections.
export function groupReleases(sets: ReleaseSet[]): ReleaseSection[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcoming: ReleaseSet[] = [];
  const recent: ReleaseSet[] = [];

  for (const s of sets) {
    if (!s.release_date) continue;
    const d = new Date(s.release_date);
    if (d >= today) upcoming.push(s);
    else recent.push(s);
  }

  // Recent is already date-desc from the query. Group by Month YYYY.
  const groups = new Map<string, ReleaseSet[]>();
  for (const s of recent) {
    const d = new Date(s.release_date!);
    const key = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const sections: ReleaseSection[] = [];
  // Upcoming first if non-empty (we still render the empty header so users see we tried)
  sections.push({ title: 'Upcoming', data: upcoming });
  for (const [title, data] of groups) {
    sections.push({ title, data });
  }
  return sections;
}

export function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86_400_000);
}
