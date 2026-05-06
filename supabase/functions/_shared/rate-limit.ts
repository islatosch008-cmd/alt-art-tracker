import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// Token-bucket-ish per-source rate limiter backed by public.rate_limit_buckets.
// Each `source` has a max_per_window value; once we hit it, takeToken returns
// false until the next window opens (1 hour).
//
// Crude but good enough for Phase 1 — protects us from accidentally hammering
// PriceCharting / eBay / etc. and getting our keys revoked.

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function takeToken(
  admin: SupabaseClient,
  source: string,
  maxPerWindow: number,
): Promise<boolean> {
  const { data: existing, error: readErr } = await admin
    .from('rate_limit_buckets')
    .select('requests_in_window, window_started_at')
    .eq('source', source)
    .maybeSingle();
  if (readErr && readErr.code !== 'PGRST116') {
    console.warn('rate_limit read failed', readErr.message);
    return true; // fail-open: don't block scraper on logging issues
  }

  const now = new Date();

  if (!existing) {
    await admin.from('rate_limit_buckets').insert({
      source,
      requests_in_window: 1,
      window_started_at: now.toISOString(),
      max_per_window: maxPerWindow,
    });
    return true;
  }

  const windowStarted = new Date(existing.window_started_at!);
  const windowAge = now.getTime() - windowStarted.getTime();

  if (windowAge >= WINDOW_MS) {
    await admin
      .from('rate_limit_buckets')
      .update({
        requests_in_window: 1,
        window_started_at: now.toISOString(),
        max_per_window: maxPerWindow,
      })
      .eq('source', source);
    return true;
  }

  if (existing.requests_in_window >= maxPerWindow) {
    return false;
  }

  await admin
    .from('rate_limit_buckets')
    .update({ requests_in_window: existing.requests_in_window + 1 })
    .eq('source', source);
  return true;
}
