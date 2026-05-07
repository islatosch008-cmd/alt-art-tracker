// eBay Browse API → median active price per card → price_history (with
// source='ebay_active'). Active listings (not sold) — useful as a "current
// asking price" signal that fills in even before Marketplace Insights
// approval lands.
//
// Feature flag: 412 + clear hint when EBAY_CLIENT_ID/SECRET missing.
// No Sentry alert on missing creds (it's a known-pending state). Sentry
// fires only on real call failures via recordOutcome.
//
// Run cadence: cron every 2 hours 06-22 UTC. Each invocation handles a
// batch of cards (oldest last_price_check_at first), bounded so we don't
// blow rate limits. Browse API is generous (~5000 calls/day per app), so
// 50 cards × 12 runs/day = 600 calls/day fits comfortably.

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import {
  buildSearchQuery,
  EBAY_KEYS_PRESENT,
  EbayKeyMissingError,
  EbayRateLimitedError,
  median,
  searchActive,
} from '../_shared/ebay.ts';
import {
  recordOutcome,
  type ScrapeOutcome,
} from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'ebay_active';
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
          hint: 'Generate at developer.ebay.com → Application Keys (CLIENT_ID = App ID, CLIENT_SECRET = Cert ID). Paste into supabase/functions/.env and restart functions serve.',
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

    for (const card of cards ?? []) {
      const setName = (card as unknown as { sets?: { name?: string } }).sets?.name;
      const q = buildSearchQuery({
        name: card.name,
        setName: setName ?? null,
        cardNumber: card.card_number,
      });

      try {
        const items = await searchActive(q, 50);
        const prices = items
          .map((it) => parseFloat(it.price?.value ?? ''))
          .filter((n) => Number.isFinite(n) && n > 0);
        const med = median(prices);
        if (med == null) {
          noResults++;
          continue;
        }

        await admin.from('price_history').insert({
          card_id: card.id,
          price: Math.round(med * 100) / 100,
          source: SOURCE,
          recorded_at: now,
        });
        await admin
          .from('cards')
          .update({ last_price_check_at: now })
          .eq('id', card.id);
        priced++;
      } catch (err) {
        if (err instanceof EbayKeyMissingError) {
          // Defense-in-depth — should be caught by the feature flag above.
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
        url: 'ebay:browse',
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
    });
  }),
);
