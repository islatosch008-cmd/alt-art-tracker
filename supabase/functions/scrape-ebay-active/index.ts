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
//
// Filters (per project spec):
//   category_ids = '183454'  Trading Card Singles (Collectible Card Games)
//   conditionIds = '2750'    Graded — slabs only, more price-comparable
//   sort         = 'price'   ASC, so items[0] is the floor
//
// Per-card aggregates surfaced in the response for the heating-up
// integration step:
//   total          eBay's total match count (supply signal)
//   lowestPrice    items[0].price.value (price floor anchor)
//   medianPrice    median of returned items' prices (asking baseline)
//
// Request body (POST):
//   { "limit": <num> }
//     Overrides BATCH_SIZE for smoke tests. Capped at BATCH_SIZE so a
//     typo'd 5000 doesn't burn the daily quota.
//   { "tier": "pokemon_top" | "remaining" | "sports" }
//     Restricts card selection to the named tier (see migration
//     20260509080000_add_card_tier.sql for tier definitions). Production
//     crons pass this — pokemon_top fires every 6h, remaining fires
//     weekly Sunday 06:00 UTC. When set, ordering stays "stale-first"
//     (oldest last_price_check_at within the tier).
//   { "strategy": "stale" | "popular" } (legacy, no tier set)
//     "stale"   (default — pre-tiering production behavior) — order by
//               last_price_check_at ASC NULLS FIRST across all cards.
//     "popular" — order by popularity_score DESC. Smoke-test helper.
//   When BOTH tier and strategy are passed, tier wins.

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
const PER_CARD_RESULT_LIMIT = 50; // eBay items returned per query

const CATEGORY_TRADING_CARD_SINGLES = '183454';
const CONDITION_GRADED = '2750';

type CardSummary = {
  card_id: string;
  card_name: string;
  query: string;
  total_active: number;
  lowest_price: number | null;
  median_price: number | null;
  top_titles: string[];
  ms: number;
};

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

    // Optional limit + tier + strategy overrides from request body.
    // Falls back to BATCH_SIZE / no-tier / "stale" when missing.
    let limit = BATCH_SIZE;
    let strategy: 'stale' | 'popular' = 'stale';
    let tier: 'pokemon_top' | 'remaining' | 'sports' | null = null;
    if (req.method === 'POST') {
      try {
        const body = (await req.json()) as {
          limit?: unknown;
          strategy?: unknown;
          tier?: unknown;
        };
        const raw = Number(body?.limit);
        if (Number.isFinite(raw) && raw > 0) {
          limit = Math.min(Math.floor(raw), BATCH_SIZE);
        }
        if (body?.strategy === 'popular') strategy = 'popular';
        if (
          body?.tier === 'pokemon_top' ||
          body?.tier === 'remaining' ||
          body?.tier === 'sports'
        ) {
          tier = body.tier;
        }
      } catch {
        // empty/non-JSON body — fine, use defaults.
      }
    }

    let cardsQuery = admin
      .from('cards')
      .select('id, name, card_number, set_id, tier, sets(name)');
    if (tier) {
      // Tier wins over strategy. Cards within a tier are still cycled
      // by oldest last_price_check_at first, so the tier's full membership
      // gets covered evenly over the cron's cycle time.
      cardsQuery = cardsQuery
        .eq('tier', tier)
        .order('last_price_check_at', { ascending: true, nullsFirst: true });
    } else if (strategy === 'popular') {
      cardsQuery = cardsQuery.order('popularity_score', {
        ascending: false,
        nullsFirst: false,
      });
    } else {
      cardsQuery = cardsQuery.order('last_price_check_at', {
        ascending: true,
        nullsFirst: true,
      });
    }
    const { data: cards, error: cardErr } = await cardsQuery.limit(limit);
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
    const summaries: CardSummary[] = [];

    for (const card of cards ?? []) {
      const setName = (card as unknown as { sets?: { name?: string } }).sets?.name;
      const q = buildSearchQuery({
        name: card.name,
        setName: setName ?? null,
        cardNumber: card.card_number,
      });

      const t0 = Date.now();
      try {
        const result = await searchActive(q, PER_CARD_RESULT_LIMIT, {
          categoryIds: [CATEGORY_TRADING_CARD_SINGLES],
          conditionIds: [CONDITION_GRADED],
        });

        const prices = result.items
          .map((it) => parseFloat(it.price?.value ?? ''))
          .filter((n) => Number.isFinite(n) && n > 0);
        const med = median(prices);
        // items are returned price-ASC by eBay; defensive Math.min in
        // case the category sort tweaks the order.
        const lowest = prices.length > 0 ? Math.min(...prices) : null;

        const summary: CardSummary = {
          card_id: card.id,
          card_name: card.name,
          query: q,
          total_active: result.total,
          lowest_price: lowest != null ? Math.round(lowest * 100) / 100 : null,
          median_price: med != null ? Math.round(med * 100) / 100 : null,
          top_titles: result.items.slice(0, 3).map((it) => it.title),
          ms: Date.now() - t0,
        };
        summaries.push(summary);

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
        summaries.push({
          card_id: card.id,
          card_name: card.name,
          query: q,
          total_active: 0,
          lowest_price: null,
          median_price: null,
          top_titles: [],
          ms: Date.now() - t0,
        });
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
      batch_limit: limit,
      tier,
      strategy: tier ? null : strategy,
      summaries,
    });
  }),
);
