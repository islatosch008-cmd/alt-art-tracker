// fetch-justtcg — pull CURRENT prices for a rotating subset of the card
// catalog from JustTCG and append one snapshot row per variant to
// public.justtcg_price_snapshots. That snapshot history is the basis for
// the price-momentum signal in compute-trending.
//
// WHY ROTATING + BUDGETED
// =======================
// JustTCG free tier: 1,000 requests/month, 100/day, 10/min. We cannot
// price the whole catalog (22K+ cards) every run. Instead each run:
//   1. Reads a DAILY_REQUEST_CEILING budget guard — counts today's
//      JustTCG POST /cards calls already logged to api_request_log and
//      stops before the 100/day free-tier limit.
//   2. Selects a PRIORITISED slice of the catalog: set release_date DESC
//      NULLS LAST first (newest / upcoming sets — the cards that show in
//      Trending / Upcoming get priced first), then last_justtcg_fetch_at
//      ASC NULLS FIRST within that, so the rotation still advances and
//      every card is revisited eventually.
//   3. Batches that slice into JUSTTCG_BATCH_SIZE chunks; each chunk is
//      one POST /cards request.
//   4. On HTTP 429 (per-minute limit) stops the run cleanly — does not
//      hammer the API.
//
// CARD-IDENTITY STRATEGY
// ======================
// Our catalog has no single clean external id for JustTCG. Resolution
// priority per card:
//   1. cards.justtcg_card_id — already resolved on a prior run. Query
//      JustTCG by { cardId }.
//   2. external_ids.tcgplayer_product_id — tcgcsv-imported cards carry a
//      numeric tcgplayer id. Query JustTCG by { tcgplayerId }.
//   3. Neither present — skip. (game+set+number fallback is intentionally
//      NOT used yet: our `cards`/`sets` names are not guaranteed to match
//      JustTCG's set strings, and a wrong match would poison momentum.
//      Documented seam below if we want it later.)
// On a successful match we WRITE the resolved JustTCG id back into
// cards.justtcg_card_id so future runs take the fast path.
//
// FEATURE FLAG
// ============
// Missing JUSTTCG_API_KEY -> 412 with a clear hint, degraded outcome
// recorded. Same pattern as scrape-ebay-active / ai-research-releases.

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import {
  type CardQuery,
  getCardsBatch,
  JUSTTCG_BATCH_SIZE,
  JUSTTCG_KEY_PRESENT,
  type JustTcgVariant,
  JustTcgKeyMissingError,
  JustTcgRateLimitedError,
} from '../_shared/justtcg.ts';
import { recordOutcome } from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'justtcg_fetch';

// Hard daily ceiling on JustTCG POST /cards requests. Free tier allows
// 100/day; we leave headroom at 90 so a manual smoke test plus the cron
// runs don't collectively trip the limit.
const DAILY_REQUEST_CEILING = 90;

// How many cards to consider per invocation (before identity resolution
// filters out the unresolvable ones). At JUSTTCG_BATCH_SIZE=20 this is
// up to 10 requests per run — well under the per-minute limit of 10 and
// a small slice of the daily budget.
const CARDS_PER_RUN = 200;

type CardRow = {
  id: string;
  name: string;
  justtcg_card_id: string | null;
  external_ids: Record<string, unknown> | null;
};

// The select also embeds sets!inner(release_date) so we can prioritise by
// set recency at the DB layer (see SELECT below). The embed is to-one, so
// supabase-js returns it as an object (or null if the foreign row is
// missing — impossible here because of !inner). We only read release_date
// for ordering and otherwise ignore it, so it is not part of CardRow.

// Pull the numeric tcgplayer id stashed by the tcgcsv importer, if any.
function tcgplayerIdOf(card: CardRow): string | null {
  const ext = card.external_ids ?? {};
  const v = ext['tcgplayer_product_id'];
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  return null;
}

// Choose the price we surface as cards.current_price for a card.
//
// JustTCG returns one variant per (printing, condition) combination. The
// most representative "what's this card worth right now" figure for the
// Trending tab is the baseline collector grade: condition ~"Near Mint",
// printing ~"Normal"/non-foil. We prefer, in order:
//   1. Near Mint + Normal/non-foil  — the canonical baseline.
//   2. Any Near Mint variant         — grade matters more than printing.
//   3. Any Normal/non-foil variant   — printing matters more than grade.
//   4. The first priced variant      — last-resort fallback so a matched
//                                       card never shows "syncing" forever.
// Returns null only when no variant carries a finite numeric price.
function representativePrice(variants: JustTcgVariant[]): number | null {
  const priced = variants.filter(
    (v) => typeof v.price === 'number' && Number.isFinite(v.price),
  );
  if (priced.length === 0) return null;

  const isNearMint = (v: JustTcgVariant) =>
    (v.condition ?? '').toLowerCase().includes('near mint');
  // "Normal" is JustTCG's non-foil printing label; treat anything that
  // isn't explicitly a foil/holo finish as the baseline non-foil printing.
  const isNonFoil = (v: JustTcgVariant) => {
    const p = (v.printing ?? '').toLowerCase();
    if (p.includes('normal')) return true;
    return !(p.includes('foil') || p.includes('holo'));
  };

  const pick =
    priced.find((v) => isNearMint(v) && isNonFoil(v)) ??
    priced.find(isNearMint) ??
    priced.find(isNonFoil) ??
    priced[0];

  return Math.round(pick.price * 100) / 100;
}

Deno.serve(
  withSentry(SOURCE, async (req) => {
    const pre = preflight(req);
    if (pre) return pre;
    const admin = adminClient();

    // --- FEATURE FLAG -----------------------------------------------------
    if (!JUSTTCG_KEY_PRESENT) {
      await recordOutcome(admin, SOURCE, {
        kind: 'degraded',
        statusCode: 412,
        reason: 'justtcg_api_key_missing',
        url: 'justtcg:cards',
      });
      return jsonResponse(
        {
          ok: false,
          error: 'JUSTTCG_API_KEY not set',
          hint: 'Generate a key at justtcg.com (free tier: 1,000/mo, 100/day). Paste into supabase/functions/.env as JUSTTCG_API_KEY and restart functions serve.',
        },
        412,
      );
    }

    // --- DAILY REQUEST-BUDGET GUARD --------------------------------------
    // Count JustTCG POST /cards requests already made today (UTC). Each
    // such request logs a row to api_request_log with source=SOURCE and
    // endpoint='justtcg_request' (see logging below). The free tier
    // resets the daily limit at midnight UTC, so the window is "today
    // 00:00 UTC -> now".
    const startOfUtcDay = new Date();
    startOfUtcDay.setUTCHours(0, 0, 0, 0);

    const { count: usedToday, error: countErr } = await admin
      .from('api_request_log')
      .select('id', { count: 'exact', head: true })
      .eq('source', SOURCE)
      .eq('endpoint', 'justtcg_request')
      .gte('requested_at', startOfUtcDay.toISOString());
    if (countErr) {
      await recordOutcome(admin, SOURCE, {
        kind: 'failure',
        statusCode: 500,
        error: `budget count: ${countErr.message}`,
      });
      return jsonResponse({ ok: false, error: countErr.message }, 500);
    }

    // TOCTOU: two concurrent runs could each read a stale request count
    // before either logs its own requests, letting the combined total
    // overshoot the ceiling. Harmless in practice — the cron schedule
    // spaces runs ~8h apart, so concurrent runs cannot occur.
    const requestsUsedToday = usedToday ?? 0;
    const requestsRemaining = Math.max(
      0,
      DAILY_REQUEST_CEILING - requestsUsedToday,
    );
    if (requestsRemaining === 0) {
      await recordOutcome(admin, SOURCE, {
        kind: 'degraded',
        statusCode: 200,
        reason: 'daily_budget_exhausted',
        url: 'justtcg:cards',
      });
      return jsonResponse({
        ok: true,
        skipped: 'daily_budget_exhausted',
        requests_used_today: requestsUsedToday,
        daily_ceiling: DAILY_REQUEST_CEILING,
      });
    }

    // --- SELECT PRIORITISED CATALOG SLICE --------------------------------
    // Price the cards that MATTER first. The catalog is ~23K cards but the
    // free tier only allows ~2K lookups/day, so each run pulls the slice
    // most worth pricing, ordered by:
    //   1. PRIMARY  — the card's set release_date DESC, NULLS LAST. Cards
    //      from the newest / upcoming sets come first; these are exactly
    //      what surfaces in the Trending / Upcoming tabs. NULLS LAST keeps
    //      undated sets behind real release dates.
    //   2. SECONDARY — last_justtcg_fetch_at ASC, NULLS FIRST. Within a
    //      release-date cohort, never-fetched cards lead, then the
    //      least-recently-refreshed. This is the rotation cursor: it
    //      deterministically advances so we don't re-fetch the same cards
    //      every run and the cohort still cycles through over time.
    //
    // MECHANISM: we embed sets!inner(release_date) and order by the
    // referenced column. PostgREST only lets a referenced-table column
    // drive the PARENT row order when the embed is an INNER join — hence
    // !inner (also correct semantically: a card with no set can't be
    // prioritised by release_date, and every card here has a set_id FK).
    // supabase-js v2's option key for ordering by an embedded column is
    // `referencedTable`. The sets(release_date) embed is otherwise unused.
    const { data: cards, error: cardErr } = await admin
      .from('cards')
      .select('id, name, justtcg_card_id, external_ids, sets!inner(release_date)')
      .order('release_date', {
        referencedTable: 'sets',
        ascending: false,
        nullsFirst: false,
      })
      .order('last_justtcg_fetch_at', { ascending: true, nullsFirst: true })
      .limit(CARDS_PER_RUN);
    if (cardErr) {
      await recordOutcome(admin, SOURCE, {
        kind: 'failure',
        statusCode: 500,
        error: `cards fetch: ${cardErr.message}`,
      });
      return jsonResponse({ ok: false, error: cardErr.message }, 500);
    }

    // --- RESOLVE CARD IDENTITY -------------------------------------------
    // Build a query per card, remembering which of OUR card rows it maps
    // to so we can attribute JustTCG results back. Cards we cannot resolve
    // are skipped (and still get last_justtcg_fetch_at bumped so the
    // rotation doesn't get stuck on them every run).
    type Resolvable = {
      card: CardRow;
      query: CardQuery;
      // matchKey: how we'll find this card in the JustTCG response.
      matchBy: 'cardId' | 'tcgplayerId';
      matchValue: string;
    };
    const resolvable: Resolvable[] = [];
    const unresolvableIds: string[] = [];

    for (const c of (cards ?? []) as CardRow[]) {
      if (c.justtcg_card_id) {
        resolvable.push({
          card: c,
          query: { cardId: c.justtcg_card_id },
          matchBy: 'cardId',
          matchValue: c.justtcg_card_id,
        });
        continue;
      }
      const tcgId = tcgplayerIdOf(c);
      if (tcgId) {
        resolvable.push({
          card: c,
          query: { tcgplayerId: tcgId },
          matchBy: 'tcgplayerId',
          matchValue: tcgId,
        });
        continue;
      }
      // SEAM: a game+set+number fallback could go here once our `sets`
      // names are reconciled with JustTCG's set strings. Skipped for now
      // to avoid mismatched cards poisoning the momentum signal.
      unresolvableIds.push(c.id);
    }

    const nowIso = new Date().toISOString();

    // --- BATCH + FETCH ---------------------------------------------------
    // Chunk resolvable cards into JUSTTCG_BATCH_SIZE groups, but never
    // exceed the remaining daily request budget.
    const chunks: Resolvable[][] = [];
    for (let i = 0; i < resolvable.length; i += JUSTTCG_BATCH_SIZE) {
      chunks.push(resolvable.slice(i, i + JUSTTCG_BATCH_SIZE));
    }
    const chunksToRun = chunks.slice(0, requestsRemaining);

    type SnapshotRow = {
      card_id: string;
      justtcg_card_id: string;
      variant_id: string;
      printing: string | null;
      condition: string | null;
      price: number;
      captured_at: string;
    };
    const snapshots: SnapshotRow[] = [];
    // Cards we successfully matched -> their resolved JustTCG card id, so
    // we can persist justtcg_card_id and bump last_justtcg_fetch_at.
    const resolvedJusttcgId = new Map<string, string>();
    // Cards we matched -> the representative current price to write to
    // cards.current_price (see representativePrice). Absent for cards whose
    // variants had no finite price.
    const representativePriceByCard = new Map<string, number>();
    const fetchedCardIds = new Set<string>();

    let requestsMade = 0;
    let rateLimited = false;
    let chunkError: string | null = null;

    for (const chunk of chunksToRun) {
      try {
        const apiCards = await getCardsBatch(chunk.map((r) => r.query));
        // Log this request against the daily budget IMMEDIATELY after the
        // call returns so the count is accurate even if processing throws.
        requestsMade++;
        await admin.from('api_request_log').insert({
          source: SOURCE,
          endpoint: 'justtcg_request',
          status_code: 200,
          cost_units: 1,
        });

        // Index the JustTCG response by both tcgplayerId and id so we can
        // attribute each result back to the OUR-card it answered.
        const byTcgplayerId = new Map<string, typeof apiCards[number]>();
        const byCardId = new Map<string, typeof apiCards[number]>();
        for (const ac of apiCards) {
          if (ac.tcgplayerId) byTcgplayerId.set(String(ac.tcgplayerId), ac);
          if (ac.id) byCardId.set(ac.id, ac);
        }

        for (const r of chunk) {
          const ac =
            r.matchBy === 'cardId'
              ? byCardId.get(r.matchValue)
              : byTcgplayerId.get(r.matchValue);
          if (!ac) continue; // JustTCG had no match for this query
          fetchedCardIds.add(r.card.id);
          resolvedJusttcgId.set(r.card.id, ac.id);
          // Capture the representative current price for cards.current_price.
          const repPrice = representativePrice(ac.variants ?? []);
          if (repPrice != null) {
            representativePriceByCard.set(r.card.id, repPrice);
          }
          for (const v of ac.variants ?? []) {
            if (typeof v.price !== 'number' || !Number.isFinite(v.price)) {
              continue;
            }
            snapshots.push({
              card_id: r.card.id,
              justtcg_card_id: ac.id,
              variant_id: v.id,
              printing: v.printing ?? null,
              condition: v.condition ?? null,
              price: Math.round(v.price * 100) / 100,
              captured_at: nowIso,
            });
          }
        }
      } catch (err) {
        if (err instanceof JustTcgKeyMissingError) {
          // Defense-in-depth — should be caught by the feature flag above.
          return jsonResponse({ ok: false, error: err.message }, 412);
        }
        if (err instanceof JustTcgRateLimitedError) {
          // Per-minute limit hit — STOP the run cleanly, do not hammer.
          rateLimited = true;
          break;
        }
        // Other errors: record and stop processing further chunks.
        chunkError = (err as Error).message;
        break;
      }
    }

    // --- PERSIST SNAPSHOTS -----------------------------------------------
    let snapshotsInserted = 0;
    if (snapshots.length > 0) {
      const { error: snapErr } = await admin
        .from('justtcg_price_snapshots')
        .insert(snapshots);
      if (snapErr) {
        console.warn(`snapshot insert failed: ${snapErr.message}`);
      } else {
        snapshotsInserted = snapshots.length;
      }
    }

    // --- BUMP ROTATION CURSOR + PERSIST RESOLVED IDS ---------------------
    // Every card we actually attempted (resolvable, in a chunk we ran)
    // gets last_justtcg_fetch_at bumped so the rotation advances. Cards we
    // matched also get justtcg_card_id persisted for the fast path.
    // Unresolvable cards are bumped too, so the rotation doesn't stall on
    // them — they'll be retried after the rest of the catalog cycles.
    const attemptedCardIds = new Set<string>(
      chunksToRun.flat().map((r) => r.card.id),
    );
    for (const id of unresolvableIds) attemptedCardIds.add(id);

    // Same fan-out batching strategy the rotation cursor already used: one
    // partial-column UPDATE per attempted card, awaited together. This run
    // touches at most CARDS_PER_RUN (200) cards, so the fan-out stays small.
    // We fold the current_price write into THIS existing patch rather than
    // issuing a second pass, so a matched card's price + cursor land atomically.
    const updates = await Promise.all(
      [...attemptedCardIds].map((id) => {
        const patch: Record<string, unknown> = {
          last_justtcg_fetch_at: nowIso,
        };
        const resolved = resolvedJusttcgId.get(id);
        if (resolved) patch.justtcg_card_id = resolved;
        // Surface the representative JustTCG price as the card's current
        // price (and stamp last_price_check_at) for cards we actually priced.
        // Cards we couldn't price leave current_price untouched.
        const repPrice = representativePriceByCard.get(id);
        if (repPrice != null) {
          patch.current_price = repPrice;
          patch.last_price_check_at = nowIso;
        }
        return admin.from('cards').update(patch).eq('id', id);
      }),
    );
    const updateErrors = updates.filter((u) => u.error).length;
    if (updateErrors > 0) {
      console.warn(
        `${updateErrors}/${updates.length} card cursor updates failed`,
      );
    }

    // --- RECORD OUTCOME ---------------------------------------------------
    if (chunkError) {
      await recordOutcome(admin, SOURCE, {
        kind: 'failure',
        statusCode: 502,
        error: `justtcg batch: ${chunkError}`,
      });
      return jsonResponse(
        {
          ok: false,
          error: chunkError,
          requests_made: requestsMade,
          snapshots_inserted: snapshotsInserted,
        },
        502,
      );
    }
    await recordOutcome(admin, SOURCE, {
      kind: 'success',
      statusCode: 200,
      scraped: snapshotsInserted,
    });

    return jsonResponse({
      ok: true,
      cards_considered: cards?.length ?? 0,
      cards_resolvable: resolvable.length,
      cards_unresolvable: unresolvableIds.length,
      cards_matched: fetchedCardIds.size,
      cards_priced: representativePriceByCard.size,
      requests_made: requestsMade,
      requests_used_today: requestsUsedToday + requestsMade,
      daily_ceiling: DAILY_REQUEST_CEILING,
      snapshots_inserted: snapshotsInserted,
      rate_limited: rateLimited,
    });
  }),
);
