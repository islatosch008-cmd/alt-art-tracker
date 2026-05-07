// PSA pop reports scraper.
//
// Reads psa_card_map (card_id ↔ psa_spec_id), hits PSA Public API per spec,
// writes rows to psa_pop_reports (grade, count, recorded_at).
//
// Per Ian's plan: first run uses INITIAL_BATCH_LIMIT (5) to verify quota
// usage before scaling. Bump the env var PSA_BATCH_LIMIT or this constant
// once the daily quota is comfortable.
//
// Cron: weekly Monday 06:15 UTC. Pop reports change slowly; once a week
// is plenty. Combined with daily psa-recent-sales for finer-grained
// market signal.
//
// Feature flag layers:
//   1. PSA_API_TOKEN missing → 412 (token never set)
//   2. psa_card_map empty   → 200 with degraded='no_mapped_cards' (token
//                              works but no card→spec_id mappings yet)

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import {
  getPopReport,
  PSA_TOKEN_PRESENT,
  PsaRateLimitedError,
  PsaTokenMissingError,
} from '../_shared/psa.ts';
import { recordOutcome, type ScrapeOutcome } from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'psa_pop_reports';
const INITIAL_BATCH_LIMIT = 5;

Deno.serve(
  withSentry(SOURCE, async (req) => {
    const pre = preflight(req);
    if (pre) return pre;
    const admin = adminClient();

    if (!PSA_TOKEN_PRESENT) {
      return jsonResponse(
        {
          ok: false,
          error: 'PSA_API_TOKEN not set',
          hint: 'PSA Public API token. Already documented in supabase/functions/.env.example. Phase 2 integration — not blocking Phase 1 launch.',
        },
        412,
      );
    }

    // Pull mapped cards (oldest pop-report first). Order by recorded_at on
    // a sub-select would be cleaner once we have data; for now just first
    // INITIAL_BATCH_LIMIT cards in the map.
    const batchSize =
      Number(Deno.env.get('PSA_BATCH_LIMIT')) || INITIAL_BATCH_LIMIT;
    const { data: mappings, error: mapErr } = await admin
      .from('psa_card_map')
      .select('card_id, psa_spec_id')
      .limit(batchSize);
    if (mapErr) {
      const outcome: ScrapeOutcome = {
        kind: 'failure',
        statusCode: 500,
        error: `psa_card_map fetch: ${mapErr.message}`,
      };
      await recordOutcome(admin, SOURCE, outcome);
      return jsonResponse({ ok: false, ...outcome }, 500);
    }

    if (!mappings || mappings.length === 0) {
      // Token present but no spec mappings — surface as degraded so
      // /admin/scrapers shows it, but don't fail.
      await recordOutcome(admin, SOURCE, {
        kind: 'degraded',
        statusCode: 200,
        reason: 'no_mapped_cards',
        url: 'psa:pop',
      });
      return jsonResponse({
        ok: true,
        scraped: 0,
        reason: 'no_mapped_cards',
        hint: 'Populate psa_card_map.psa_spec_id via /admin/sets/[id] or a bulk-match Edge Function. Until then PSA scrapers no-op gracefully.',
      });
    }

    const now = new Date().toISOString();
    let cardsProcessed = 0;
    let rowsWritten = 0;
    let errored = 0;

    for (const m of mappings) {
      try {
        const rows = await getPopReport(m.psa_spec_id);
        if (rows.length === 0) continue;
        const inserts = rows.map((r) => ({
          card_id: m.card_id,
          grade: r.grade,
          count: r.count,
          recorded_at: now,
        }));
        const { error: insErr } = await admin
          .from('psa_pop_reports')
          .insert(inserts);
        if (insErr) {
          console.warn(`pop insert: ${insErr.message}`);
          errored++;
          continue;
        }
        rowsWritten += inserts.length;
        cardsProcessed++;
      } catch (err) {
        if (err instanceof PsaTokenMissingError) {
          return jsonResponse({ ok: false, error: err.message }, 412);
        }
        if (err instanceof PsaRateLimitedError) {
          await recordOutcome(admin, SOURCE, {
            kind: 'failure',
            statusCode: 429,
            error: `rate limited; retry in ${err.retryAfterMs}ms`,
          });
          return jsonResponse(
            { ok: false, error: 'rate_limited', retry_after_ms: err.retryAfterMs },
            429,
          );
        }
        console.warn(`[${SOURCE}] ${m.psa_spec_id}: ${(err as Error).message}`);
        errored++;
      }
    }

    await recordOutcome(admin, SOURCE, {
      kind: cardsProcessed > 0 ? 'success' : 'degraded',
      statusCode: 200,
      ...(cardsProcessed > 0
        ? { scraped: cardsProcessed }
        : { reason: 'all_specs_empty', url: 'psa:pop' }),
    } as ScrapeOutcome);

    return jsonResponse({
      ok: true,
      cards_processed: cardsProcessed,
      rows_written: rowsWritten,
      cards_errored: errored,
      batch_size: batchSize,
    });
  }),
);
