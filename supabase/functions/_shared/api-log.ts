import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// Append a row to public.api_request_log so we can audit cost + abuse later.
// Failures here are swallowed — we never want logging to take down a scraper.
export async function logApiRequest(
  admin: SupabaseClient,
  args: {
    source: string;
    endpoint: string;
    statusCode?: number;
    costUnits?: number;
  },
): Promise<void> {
  try {
    await admin.from('api_request_log').insert({
      source: args.source,
      endpoint: args.endpoint,
      status_code: args.statusCode ?? null,
      cost_units: args.costUnits ?? null,
    });
  } catch (e) {
    console.warn('api_request_log insert failed', (e as Error).message);
  }
}
