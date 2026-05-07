// PSA recent-sales scraper.
//
// Reads psa_card_map, hits PSA Public API per spec for recent graded sales,
// writes new rows to psa_graded_sales (UNIQUE on cert_number prevents dupes).
//
// Daily 06:45 UTC (offset from check-drop-alerts at 06:30). Smaller cadence
// than pop reports because sales are time-sensitive.
//
// Same feature-flag pattern as scrape-psa-pop-reports.

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import {
  getRecentSales,
  PSA_TOKEN_PRESENT,
  PsaRateLimitedError,
  PsaTokenMissingError,
} from '../_shared/psa.ts';
import { recordOutcome, type ScrapeOutcome } from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'psa_graded_sales';
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
          hint: 'See supabase/functions/.env.example. Phase 2 integration.',
        },
        412,
      );
    }

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
      await recordOutcome(admin, SOURCE, {
        kind: 'degraded',
        statusCode: 200,
        reason: 'no_mapped_cards',
        url: 'psa:sales',
      });
      return jsonResponse({
        ok: true,
        scraped: 0,
        reason: 'no_mapped_cards',
        hint: 'Populate psa_card_map.psa_spec_id first.',
      });
    }

    let cardsProcessed = 0;
    let salesWritten = 0;
    let salesSkippedDupe = 0;
    let errored = 0;

    for (const m of mappings) {
      try {
        const rows = await getRecentSales(m.psa_spec_id);
        if (rows.length === 0) continue;
        for (const r of rows) {
          const { error: insErr } = await admin.from('psa_graded_sales').insert({
            card_id: m.card_id,
            psa_cert_number: r.certNumber,
            grade: r.grade,
            sale_price: r.salePrice,
            sold_at: r.soldAt,
            source_url: r.sourceUrl ?? null,
          });
          if (insErr && /duplicate key/i.test(insErr.message)) {
            salesSkippedDupe++;
          } else if (insErr) {
            console.warn(`sales insert: ${insErr.message}`);
            errored++;
          } else {
            salesWritten++;
          }
        }
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
      kind: salesWritten > 0 ? 'success' : 'degraded',
      statusCode: 200,
      ...(salesWritten > 0
        ? { scraped: salesWritten }
        : { reason: 'no_new_sales', url: 'psa:sales' }),
    } as ScrapeOutcome);

    return jsonResponse({
      ok: true,
      cards_processed: cardsProcessed,
      sales_written: salesWritten,
      sales_skipped_dupe: salesSkippedDupe,
      cards_errored: errored,
      batch_size: batchSize,
    });
  }),
);
