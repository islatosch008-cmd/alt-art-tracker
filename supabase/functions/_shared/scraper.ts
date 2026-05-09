// Shared scraper utilities. Implements Ian's approved architecture +
// corrections:
//   - politeFetch: 100ms delay, 15s AbortController timeout, polite UA
//   - 3-outcome recordOutcome: success | degraded | failure
//   - Sentry alerts only on 2 consecutive failures (read prev from log)
//   - HTML snapshot to scraper_html_snapshots on degraded (scraped=0)
//   - upsertScrapedReleases respects sets.locked_fields (manual edits win)
//   - hashSourceId helper for sources without stable URL slugs

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { captureException } from './sentry.ts';

export const SCRAPER_UA =
  'AltArtTracker/0.1.0 (contact: hello@altarttracker.com)';
export const FETCH_TIMEOUT_MS = 15_000;
export const POLITE_DELAY_MS = 100;

// 100ms delay + AbortController timeout. Throws on timeout (caller catches
// and feeds into recordOutcome as a failure).
export async function politeFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  await new Promise((r) => setTimeout(r, POLITE_DELAY_MS));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': SCRAPER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export type ScrapedRelease = {
  source_id: string;
  brand_id: string;
  name: string;
  sport?: string | null;
  box_type?: string | null;
  release_date?: string | null;
  pre_order_opens_at?: string | null;
  msrp_box?: number | null;
  msrp_pack?: number | null;
  external_ids?: Record<string, unknown>;
};

// Three-outcome model. `degraded` is the silent-redesign case (HTTP 200 but
// nothing parsed). `failure` is HTTP non-2xx, exception, or timeout.
export type ScrapeOutcome =
  | { kind: 'success'; statusCode: number; scraped: number }
  | {
      kind: 'degraded';
      statusCode: number;
      reason: string;
      url: string;
      html?: string; // snapshotted when present
    }
  | { kind: 'failure'; statusCode: number; error: string };

// Record the run in api_request_log, snapshot HTML on degraded, and fire
// Sentry only when this failure is the SECOND in a row for the same source.
//
// Optional `metadata` argument lets webhook handlers capture sanitized
// request/response details (method, headers, body, origin IP) so we can
// diagnose live failures without redeploying with new instrumentation.
// Callers are responsible for allowlisting safe headers and never
// including the verification token, Authorization header, or any secret.
export async function recordOutcome(
  admin: SupabaseClient,
  source: string,
  outcome: ScrapeOutcome,
  metadata?: Record<string, unknown>,
): Promise<void> {
  // Read previous outcome to detect 2-consecutive failures.
  const { data: prev } = await admin
    .from('api_request_log')
    .select('endpoint, status_code')
    .eq('source', source)
    .order('requested_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // Build the insert row conditionally — only include `metadata` when the
  // caller supplied it AND the column exists in the deployed schema. The
  // 20260508210000_api_request_log_metadata migration adds the column;
  // until that's applied, omitting the field keeps the insert valid
  // against the older schema (PGRST204 otherwise — silent failure
  // because supabase-js doesn't throw on bad columns).
  const row: Record<string, unknown> = {
    source,
    endpoint: outcome.kind, // 'success' | 'degraded' | 'failure'
    status_code: outcome.statusCode,
    cost_units: outcome.kind === 'success' ? outcome.scraped : 0,
  };
  if (metadata !== undefined) row.metadata = metadata;
  await admin.from('api_request_log').insert(row);

  if (outcome.kind === 'degraded' && outcome.html) {
    try {
      await admin.from('scraper_html_snapshots').insert({
        source,
        url: outcome.url,
        reason: outcome.reason,
        html_size_bytes: new Blob([outcome.html]).size,
        html_content: outcome.html,
      });
    } catch (e) {
      console.warn(`snapshot insert failed for ${source}: ${(e as Error).message}`);
    }
  }

  if (outcome.kind === 'failure') {
    const prevWasFailure = prev?.endpoint === 'failure';
    if (prevWasFailure) {
      captureException(
        new Error(`[${source}] consecutive failure: ${outcome.error}`),
        source,
        { consecutive_failures: 2, status_code: outcome.statusCode },
      );
    }
  }
}

// Upsert sets matched by (source, source_id). Respects locked_fields:
// fields the admin has manually edited are NEVER overwritten.
export async function upsertScrapedReleases(
  admin: SupabaseClient,
  source: string,
  releases: ScrapedRelease[],
): Promise<{ inserted: number; updated: number; locked_skipped: number }> {
  const now = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  let locked_skipped = 0;

  for (const release of releases) {
    const { data: existing } = await admin
      .from('sets')
      .select('id, locked_fields')
      .eq('source', source)
      .eq('source_id', release.source_id)
      .maybeSingle();

    if (existing) {
      const locked = new Set(((existing.locked_fields as string[]) ?? []));
      const patch: Record<string, unknown> = { last_synced_at: now };
      for (const [key, value] of Object.entries(release)) {
        if (key === 'source_id' || key === 'brand_id') continue;
        if (value === undefined) continue;
        if (locked.has(key)) {
          locked_skipped++;
          continue;
        }
        patch[key] = value;
      }
      const { error } = await admin
        .from('sets')
        .update(patch)
        .eq('id', existing.id);
      if (error) {
        console.warn(`update failed for ${source}/${release.source_id}: ${error.message}`);
        continue;
      }
      updated++;
    } else {
      const { error } = await admin.from('sets').insert({
        ...release,
        source,
        last_synced_at: now,
      });
      if (error) {
        console.warn(`insert failed for ${source}/${release.source_id}: ${error.message}`);
        continue;
      }
      inserted++;
    }
  }

  return { inserted, updated, locked_skipped };
}

// SHA-256 of (parts joined by |). 32 hex chars is plenty of uniqueness for
// per-source dedup keys when the source has no stable URL slug.
export async function hashSourceId(...parts: string[]): Promise<string> {
  const enc = new TextEncoder().encode(parts.join('|'));
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
