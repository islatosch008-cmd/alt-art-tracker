// eBay Marketplace Insights API → recently SOLD listings → price_history
// (source='ebay_sold') + volume_history (source='ebay').
//
// This is the higher-value of the two eBay scrapers — actual sold prices
// are the canonical signal for compute-heating-up-scores. But Marketplace
// Insights API is restricted; eBay must approve our app for the
// buy.marketplace.insights scope. Until then, this function returns 412.
//
// Two feature-flag layers:
//   1. EBAY_CLIENT_ID/SECRET missing → 412 (basic creds not present)
//   2. EBAY_USE_MARKETPLACE_INSIGHTS != 'true' → 412 (Insights not approved
//      / not enabled)
//
// When both are set, hits the API for the same card batch as
// scrape-ebay-active, computes per-card median sold price + count, writes
// rows to price_history + volume_history. compute-heating-up-scores reads
// these for velocity + z-score.

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import {
  buildSearchQuery,
  EBAY_KEYS_PRESENT,
  EBAY_USES_INSIGHTS,
  EbayKeyMissingError,
  EbayRateLimitedError,
  median,
  searchSold,
} from '../_shared/ebay.ts';
import {
  recordOutcome,
  type ScrapeOutcome,
} from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'ebay_sold';
const BATCH_SIZE = 50;

Deno.serve(
  withSentry(SOURCE, async (req) => {
    const pre = preflight(req);
    if (pre) return pre;
    const admin = adminClient();

    if (!EBAY_KEYS_PRESENT) {
      return jsonResponse(
        {
          ok: false,
          error: 'EBAY_CLIENT_ID / EBAY_CLIENT_SECRET not set',
          hint: 'Generate at developer.ebay.com → Application Keys.',
        },
        412,
      );
    }
    if (!EBAY_USES_INSIGHTS) {
      return jsonResponse(
        {
          ok: false,
          error: 'EBAY_USE_MARKETPLACE_INSIGHTS != "true"',
          hint: 'Apply for Marketplace Insights API at developer.ebay.com → Application Access Request. Once approved, set EBAY_USE_MARKETPLACE_INSIGHTS=true.',
        },
        412,
      );
    }

    const { data: cards, error: cardErr } = await admin
      .from('cards')
      .select('id, name, card_number, set_id, sets(name)')
      .order('last_price_check_at', { ascending: true, nullsFirst: true })
      .limit(BATCH_SIZE);
    if (cardErr) {
      const outcome: ScrapeOutcome = {
        kind: 'failure',
        statusCode: 500,
        error: `card fetch: ${cardErr.message}`,
      };
      await recordOutcome(admin, SOURCE, outcome);
      return jsonResponse({ ok: false, ...outcome }, 500);
    }

    const now = new Date().toISOString();
    let priced = 0;
    let noResults = 0;
    let errored = 0;
    let totalSales = 0;

    for (const card of cards ?? []) {
      const setName = (card as unknown as { sets?: { name?: string } }).sets?.name;
      const q = buildSearchQuery({
        name: card.name,
        setName: setName ?? null,
        cardNumber: card.card_number,
      });

      try {
        const items = await searchSold(q, 50);
        const prices = items
          .map((it) => parseFloat(it.lastSoldPrice?.value ?? ''))
          .filter((n) => Number.isFinite(n) && n > 0);
        const med = median(prices);
        if (med == null) {
          noResults++;
          continue;
        }

        // price_history: median sold price, single point per scrape run
        await admin.from('price_history').insert({
          card_id: card.id,
          price: Math.round(med * 100) / 100,
          source: SOURCE,
          recorded_at: now,
        });
        // volume_history: number of sales recorded in this batch
        // (eBay's API returns last 90 days; this is "sales count today" only
        // if we run daily. compute-heating-up reads recorded_at to bucket.)
        await admin.from('volume_history').insert({
          card_id: card.id,
          sales_count: items.length,
          source: 'ebay',
          recorded_at: now,
        });
        await admin
          .from('cards')
          .update({
            ebay_avg_price: Math.round(med * 100) / 100,
            last_price_check_at: now,
          })
          .eq('id', card.id);
        totalSales += items.length;
        priced++;
      } catch (err) {
        if (err instanceof EbayKeyMissingError) {
          return jsonResponse({ ok: false, error: err.message }, 412);
        }
        if (err instanceof EbayRateLimitedError) {
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
        console.warn(`[${SOURCE}] ${card.name}: ${(err as Error).message}`);
        errored++;
      }
    }

    if (priced === 0 && noResults > 0 && errored === 0) {
      await recordOutcome(admin, SOURCE, {
        kind: 'degraded',
        statusCode: 200,
        reason: 'all_searches_empty',
        url: 'ebay:insights',
      });
    } else {
      await recordOutcome(admin, SOURCE, {
        kind: 'success',
        statusCode: 200,
        scraped: priced,
      });
    }

    return jsonResponse({
      ok: true,
      cards_processed: cards?.length ?? 0,
      cards_priced: priced,
      cards_no_results: noResults,
      cards_errored: errored,
      total_sales_observed: totalSales,
    });
  }),
);
