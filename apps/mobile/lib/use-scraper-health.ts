// Aggregates api_request_log + scraper_html_snapshots into a per-source
// health summary for /admin/scrapers.
//
// Single round-trip: pull the last 7 days of api_request_log, fold by source
// in JS. For 7 sources × ~20 rows/day max, that's well under any reasonable
// payload limit. If we add more sources or volume grows we can move the
// aggregation to a Postgres view.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from './supabase';

// Source config — the dashboard renders one card per entry. functionName is
// the Edge Function URL slug; triggerable=false hides the manual-trigger button
// (some entries are pure compute jobs without a 1:1 function).
export type SourceConfig = {
  source: string;
  display: string;
  description: string;
  functionName: string;
  triggerable: boolean;
};

export const SCRAPER_SOURCES: SourceConfig[] = [
  {
    source: 'cardboardconnection_scraper',
    display: 'CardboardConnection',
    description: 'Sports release calendar — primary source',
    functionName: 'scrape-cardboardconnection-releases',
    triggerable: true,
  },
  {
    source: 'leaf_scraper',
    display: 'Leaf Trading Cards',
    description: 'Manufacturer-direct (cross-reference for CC)',
    functionName: 'scrape-leaf-releases',
    triggerable: true,
  },
  {
    source: 'ai_research',
    display: 'AI research agent',
    description: 'Claude Sonnet 4.5 + web search · Sunday 09:00 UTC weekly',
    functionName: 'ai-research-releases',
    triggerable: true,
  },
  {
    source: 'reddit',
    display: 'Reddit mentions',
    description: 'Mention counts across PokemonTCG, sportscards, onepiecetcg, PkmnTcgCollections · 4-hourly',
    functionName: 'scrape-reddit-mentions',
    triggerable: true,
  },
  {
    source: 'ebay_active',
    display: 'eBay (active listings)',
    description: 'Browse API median active price · every 2h 06-22 UTC · awaits credentials',
    functionName: 'scrape-ebay-active',
    triggerable: true,
  },
  {
    source: 'ebay_sold',
    display: 'eBay (sold listings)',
    description: 'Marketplace Insights API · every 2h 06-22 UTC · awaits Insights API approval',
    functionName: 'scrape-ebay-sold',
    triggerable: true,
  },
  {
    source: 'psa_pop_reports',
    display: 'PSA pop reports',
    description: 'Population per grade · weekly Mon 06:15 UTC · awaits psa_card_map mapping',
    functionName: 'scrape-psa-pop-reports',
    triggerable: true,
  },
  {
    source: 'psa_graded_sales',
    display: 'PSA recent graded sales',
    description: 'Recent graded sales · daily 06:45 UTC · awaits psa_card_map mapping',
    functionName: 'scrape-psa-recent-sales',
    triggerable: true,
  },
  {
    source: 'compute-popularity',
    display: 'Popularity scores',
    description: 'Trending Now sigmoid recompute · hourly :15',
    functionName: 'compute-popularity-scores',
    triggerable: true,
  },
  {
    source: 'compute-heating-up',
    display: 'Heating-up scores',
    description: 'Predictive acceleration — price velocity + volume z-score · hourly :30',
    functionName: 'compute-heating-up-scores',
    triggerable: true,
  },
  {
    source: 'daily-maintenance',
    display: 'Daily maintenance',
    description: 'Partitions + 30d baselines + snapshot cleanup · 09:00 UTC daily',
    functionName: 'daily-maintenance',
    triggerable: true,
  },
];

// Sources we deliberately don't scrape (per project decisions update).
export const SKIPPED_SOURCES: Array<{ name: string; reason: string }> = [
  { name: 'Topps', reason: 'Cloudflare WAF block — covered by CardboardConnection' },
  { name: 'Panini', reason: 'Cloudflare WAF block — covered by CardboardConnection' },
  {
    name: 'Fanatics Collect',
    reason: 'Phase 4 Playwright worker if needed — covered by AI agent',
  },
  {
    name: 'Upper Deck',
    reason: 'No public release calendar URL — covered by CC + AI',
  },
  { name: 'PriceCharting', reason: 'Public API discontinued — TCGCSV is the source' },
];

export type LogRow = {
  source: string;
  endpoint: string;
  status_code: number | null;
  cost_units: number | null;
  requested_at: string;
};

export type SnapshotRow = {
  id: number;
  source: string;
  reason: string;
  fetched_at: string;
  html_size_bytes: number;
};

export type SourceHealth = {
  config: SourceConfig;
  lastRun: LogRow | null;
  countByEndpoint: Record<string, number>;
  totalRuns7d: number;
  totalCost7d: number;
  consecutiveZeroDays: number;
  lastSnapshot: SnapshotRow | null;
};

const QKEY = ['admin', 'scraper-health'] as const;

export function useScraperHealth() {
  return useQuery<SourceHealth[]>({
    queryKey: QKEY,
    queryFn: async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const [logsRes, snapsRes] = await Promise.all([
        supabase
          .from('api_request_log')
          .select('source, endpoint, status_code, cost_units, requested_at')
          .gte('requested_at', sevenDaysAgo)
          .order('requested_at', { ascending: false }),
        supabase
          .from('scraper_html_snapshots')
          .select('id, source, reason, fetched_at, html_size_bytes')
          .gte('fetched_at', sevenDaysAgo)
          .order('fetched_at', { ascending: false }),
      ]);
      if (logsRes.error) throw logsRes.error;
      if (snapsRes.error) throw snapsRes.error;
      const logs = (logsRes.data ?? []) as LogRow[];
      const snaps = (snapsRes.data ?? []) as SnapshotRow[];

      // Index logs + snaps by source.
      const logsBySource = new Map<string, LogRow[]>();
      for (const r of logs) {
        const arr = logsBySource.get(r.source) ?? [];
        arr.push(r);
        logsBySource.set(r.source, arr);
      }
      const snapsBySource = new Map<string, SnapshotRow>();
      for (const s of snaps) {
        if (!snapsBySource.has(s.source)) snapsBySource.set(s.source, s);
      }

      return SCRAPER_SOURCES.map((cfg) => {
        const rows = logsBySource.get(cfg.source) ?? [];
        const lastRun = rows[0] ?? null;
        const countByEndpoint: Record<string, number> = {};
        let totalCost = 0;
        for (const r of rows) {
          countByEndpoint[r.endpoint] = (countByEndpoint[r.endpoint] ?? 0) + 1;
          totalCost += Number(r.cost_units ?? 0);
        }
        // "Consecutive zero-result days": days where no success row landed.
        // Walk back from today; once a day has any 'success' break.
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        let consecutiveZero = 0;
        for (let d = 0; d < 7; d++) {
          const dayStart = new Date(today.getTime() - d * 86_400_000);
          const dayEnd = new Date(dayStart.getTime() + 86_400_000);
          const hadSuccess = rows.some(
            (r) =>
              r.endpoint === 'success' &&
              new Date(r.requested_at) >= dayStart &&
              new Date(r.requested_at) < dayEnd,
          );
          if (hadSuccess) break;
          consecutiveZero++;
        }
        return {
          config: cfg,
          lastRun,
          countByEndpoint,
          totalRuns7d: rows.length,
          totalCost7d: totalCost,
          consecutiveZeroDays: consecutiveZero,
          lastSnapshot: snapsBySource.get(cfg.source) ?? null,
        } as SourceHealth;
      });
    },
    staleTime: 30_000,
  });
}

// Manual trigger via supabase.functions.invoke. Returns the function's JSON.
export function useTriggerSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (functionName: string) => {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: {},
      });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: QKEY });
    },
  });
}
