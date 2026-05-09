// Recalculate cards.popularity_score per the phase-aware formula.
// Writes a score_history row per card with the component breakdown so we
// can backtest weight tweaks later.
//
// PERFORMANCE
// ===========
// The previous per-card-loop implementation did ~5 round-trips per card
// × 200 cards = 1000 round-trips, clocking 75-78s on prod — over the
// 60s Edge runtime ceiling. This rewrite batches all reads and writes:
//
//   1× cards SELECT   (existing — joined to sets for release_date)
//   3× history reads  (volume / reddit / trends — all card_ids via .in())
//   1× score_history  bulk INSERT (200 rows in one POST)
//   1× cards          bulk UPSERT (200 rows in one POST)
//
// Total: 6 round-trips per cron tick. Expected wall time < 5s.
//
// URL length watch: 200 UUIDs in a PostgREST .in() filter is ~7,200 chars
// of querystring, comfortably under the typical 8 KB URL ceiling. If
// BATCH_SIZE grows past ~220, switch to an RPC that takes a uuid[] arg.
//
// PHASE-AWARE FORMULA
// ===================
// The original formula (price_velocity_24h * 0.30 + price_velocity_7d *
// 0.20 + volume_24h * 0.25 + reddit_velocity * 0.15 + trends_velocity *
// 0.10) was 100% velocity-centric. Every signal needed time-series data
// to register. On prod that meant 0/22,470 cards had non-zero signal:
// price_history had 1 row total, volume_history/reddit_mentions/
// trends_history were empty.
//
// New formula introduces level-centric primary signals (work from a
// single snapshot) plus always-on metadata floors (newness + rarity)
// plus phase-aware reserved slots for sold-velocity (awaits eBay
// Marketplace Insights approval) and active_count (awaits price_history
// schema extension — TODO below).
//
//   W_SOLD_VELOCITY    0.30  RESERVED  flips on when EBAY_USE_MARKETPLACE_INSIGHTS=true
//   W_ACTIVE_COUNT     0.35  PRIMARY   eBay graded supply signal (currently 0 — see TODO)
//   W_REDDIT           0.20  PRIMARY   activates when REDDIT_CLIENT_ID/SECRET set + data flows
//   W_TRENDS           0.15  PRIMARY   activates when google-trends GH Action restored
//   W_NEWNESS          0.15  ALWAYS-ON set.release_date proximity (decays over 12 months)
//   W_RARITY           0.05  ALWAYS-ON tiebreaker, mirrors placeholder migration's CASE
//
// raw = Σ(weight × component_normalized_to_0_1)
// popularity_score = sigmoid(raw) * 100
//
// COMPONENT NORMALIZATIONS
// ========================
// active_count_signal = min(log10(active_count + 1) / 3, 1)  // log scale, caps at ~1000 actives
// reddit_velocity     = log10(mentions_24h + 1)              // existing
// trends_velocity     = (today - yesterday) / 100            // existing, normalized to ~[-1, 1]
// newness_signal      = max(0, 1 - days_since_release / 365) // 0-1, decays linearly over 12 mo
// rarity_signal       = rarity_tier_value / 90               // 0-1, mirrors the placeholder CASE
// sold_velocity       = (when Insights flows: pct delta on median sold price over 7d)
//
// ZERO-SIGNAL HANDLING (Option C — approved 2026-05-09)
// ======================================================
// Every card gets a computed score, including those with zero time-series
// signal. Newness + rarity floors give cold-start cards a meaningful
// score (~50-65 depending on rarity tier), and Trending top-N naturally
// surfaces cards with real signal once active_count / reddit / trends
// contribute. No exclusion gate, no schema change, no UI tweak. Revisit
// only if metadata-only cards start surfacing in actual partner
// Trending top-N at scale.
//
// PLACEHOLDER MIGRATION COVERAGE GAP
// ==================================
// 20260506065545_placeholder_popularity_score.sql ran ONCE at schema-push
// time and only filled cards that existed then. The 22,455 cards imported
// AFTER (via npm run import:pokemon + tcgcsv:refresh) never got the
// rarity-based default and have popularity_score=0. This formula updates
// them on first run regardless of prior value, so the gap closes
// implicitly. Full re-run of the placeholder is queued for separate
// follow-up commit (tomorrow's session).

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { recordOutcome, type ScrapeOutcome } from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'compute-popularity';

const BATCH_SIZE = 200;

// Weights — sum to 1.0. Reserved slots stay weighted but their
// component_value will be 0 until their data source flows. Sigmoid
// renormalization handles the math automatically.
const W_SOLD_VELOCITY = 0.30; // RESERVED — awaits Marketplace Insights
const W_ACTIVE_COUNT = 0.35; // PRIMARY — eBay graded supply
const W_REDDIT = 0.20;       // PRIMARY — awaits Reddit OAuth + data
const W_TRENDS = 0.15;       // PRIMARY — awaits Google Trends GH Action fix
const W_NEWNESS = 0.15;      // ALWAYS-ON — set.release_date proximity
const W_RARITY = 0.05;       // ALWAYS-ON — tiebreaker

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function pctDelta(current: number | null, then: number | null): number {
  if (current == null || then == null || then === 0) return 0;
  return (current - then) / then;
}

type PriceRow = { price: number; recorded_at: string };
type VolumeRow = { sales_count: number; recorded_at: string };
type MentionRow = { mention_count: number; recorded_at: string };
type TrendRow = { search_interest: number; date_reported: string };

function priceAtOrBefore(rows: PriceRow[], when: Date): number | null {
  for (const r of rows) {
    if (new Date(r.recorded_at) <= when) return r.price;
  }
  return null;
}

function sumWindow<T extends { recorded_at: string }>(
  rows: T[],
  pick: (r: T) => number,
  fromMsAgo: number,
): number {
  const cutoff = Date.now() - fromMsAgo;
  let total = 0;
  for (const r of rows) {
    if (new Date(r.recorded_at).getTime() >= cutoff) total += pick(r);
  }
  return total;
}

// Mirror the rarity tier values from
// 20260506065545_placeholder_popularity_score.sql so a card's rarity
// signal here matches the placeholder's intuition. Range 35–90 → /90 →
// 0.39–1.0 contribution to rarity_signal.
function rarityTierValue(rarity: string | null): number {
  if (!rarity) return 40;
  switch (rarity) {
    case 'Special Illustration Rare': return 90;
    case 'Mega Hyper Rare':           return 88;
    case 'Hyper Rare':                return 85;
    case 'Shiny Ultra Rare':          return 80;
    case 'Illustration Rare':         return 78;
    case 'ACE SPEC Rare':             return 75;
    case 'MEGA_ATTACK_RARE':          return 73;
    case 'Ultra Rare':                return 72;
    case 'Shiny Rare':                return 70;
    case 'Double Rare':               return 65;
    case 'Black White Rare':          return 60;
    case 'Rare Holo':                 return 58;
    case 'Rare':                      return 55;
    case 'Uncommon':                  return 45;
    case 'Common':                    return 35;
    default:                          return 40;
  }
}

// Newness: linear decay 1.0 → 0 over 365 days. Sets older than a year
// contribute 0. Sets without a release_date (sport sets pending data)
// contribute 0 as well — the agent fills these in over time.
function newnessSignal(setReleaseDate: string | null): number {
  if (!setReleaseDate) return 0;
  const d = new Date(setReleaseDate);
  if (Number.isNaN(d.getTime())) return 0;
  const days = (Date.now() - d.getTime()) / 86_400_000;
  if (days < 0) return 1; // future-dated set (pre-release) → max signal
  return Math.max(0, 1 - days / 365);
}

// Active count log scale: 0 actives → 0, 100 actives → ~0.67, 1000 → 1.0.
// Caps at 1.0 so a viral card with 10,000 actives doesn't dominate every
// other contribution.
function activeCountSignal(activeCount: number): number {
  if (activeCount <= 0) return 0;
  return Math.min(Math.log10(activeCount + 1) / 3, 1);
}

Deno.serve(
  withSentry('compute-popularity-scores', async (req) => {
    const pre = preflight(req);
    if (pre) return pre;

    const admin = adminClient();

    const { data: cards, error: cardErr } = await admin
      .from('cards')
      .select(
        'id, current_price, popularity_score, rarity, set_id, sets(release_date)',
      )
      .order('updated_at', { ascending: true })
      .limit(BATCH_SIZE);
    if (cardErr) {
      await recordOutcome(admin, SOURCE, {
        kind: 'failure',
        statusCode: 500,
        error: `cards fetch: ${cardErr.message}`,
      });
      return jsonResponse({ ok: false, error: cardErr.message }, 500);
    }

    const now = new Date();
    const ago24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    // Trends window: 7d covers any "today vs yesterday" comparison plus
    // buffer for GH Action irregularity. Per-card we still pick the most-
    // recent 2 daily points after grouping.
    const ago7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const cardIds = (cards ?? []).map((c) => c.id);
    if (cardIds.length === 0) {
      // No cards in batch — record success and short-circuit.
      await recordOutcome(admin, SOURCE, {
        kind: 'success',
        statusCode: 200,
        scraped: 0,
      } as ScrapeOutcome);
      return jsonResponse({ ok: true, cards_processed: 0, cards_updated: 0 });
    }

    // --- BATCHED HISTORY READS (3 round-trips for the entire batch) ----
    // Group results by card_id in JS. Cards with no rows just get empty
    // arrays, which downstream signal helpers already handle as zeros.
    const [volumeRes, mentionRes, trendsRes] = await Promise.all([
      admin
        .from('volume_history')
        .select('card_id, sales_count, recorded_at')
        .in('card_id', cardIds)
        .gte('recorded_at', ago24h.toISOString()),
      admin
        .from('reddit_mentions')
        .select('card_id, mention_count, recorded_at')
        .in('card_id', cardIds)
        .gte('recorded_at', ago24h.toISOString()),
      admin
        .from('trends_history')
        .select('card_id, search_interest, date_reported')
        .in('card_id', cardIds)
        .eq('region', 'US')
        .gte('date_reported', ago7d.toISOString().slice(0, 10))
        .order('date_reported', { ascending: false }),
    ]);

    type VolumeRowWithCard = VolumeRow & { card_id: string };
    type MentionRowWithCard = MentionRow & { card_id: string };
    type TrendRowWithCard = TrendRow & { card_id: string };

    const volumesByCard = new Map<string, VolumeRowWithCard[]>();
    for (const r of (volumeRes.data ?? []) as VolumeRowWithCard[]) {
      const arr = volumesByCard.get(r.card_id) ?? [];
      arr.push(r);
      volumesByCard.set(r.card_id, arr);
    }
    const mentionsByCard = new Map<string, MentionRowWithCard[]>();
    for (const r of (mentionRes.data ?? []) as MentionRowWithCard[]) {
      const arr = mentionsByCard.get(r.card_id) ?? [];
      arr.push(r);
      mentionsByCard.set(r.card_id, arr);
    }
    // Trends: results are sorted desc by date_reported; per-card we take
    // the first two (today + prior). Map keeps insertion order.
    const trendsByCard = new Map<string, TrendRowWithCard[]>();
    for (const r of (trendsRes.data ?? []) as TrendRowWithCard[]) {
      const arr = trendsByCard.get(r.card_id) ?? [];
      if (arr.length < 2) arr.push(r);
      trendsByCard.set(r.card_id, arr);
    }

    // --- PER-CARD SCORING (in-memory, no I/O) ----------------------------
    type ScoreHistoryRow = {
      card_id: string;
      popularity_score: number;
      heating_up_score: null;
      components: Record<string, number>;
    };
    type CardUpsertRow = {
      id: string;
      popularity_score: number;
      updated_at: string;
    };
    const scoreHistoryRows: ScoreHistoryRow[] = [];
    const cardUpserts: CardUpsertRow[] = [];

    const nowIso = now.toISOString();

    for (const card of cards ?? []) {
      const volumes = volumesByCard.get(card.id) ?? [];
      const mentions = mentionsByCard.get(card.id) ?? [];
      const trends = trendsByCard.get(card.id) ?? [];

      // --- PRIMARY SIGNALS ----------------------------------------------

      // Sold velocity — RESERVED. Will read median sold price over a 7d
      // window from price_history rows tagged source='ebay_sold' once
      // EBAY_USE_MARKETPLACE_INSIGHTS=true and rows start landing.
      const sold_velocity = 0;

      // Active count signal — TODO: requires price_history.active_count
      // column (or a new ebay_active_aggregates table). Persistence
      // scheduled for tomorrow's "active-listing integration" commit.
      // Until then, this contributes 0 (formula architecturally ready,
      // signal slot empty).
      const active_count = 0;
      const active_count_signal = activeCountSignal(active_count);

      // Reddit velocity — log10 of 24h mentions. Empty until creds set.
      const mentions_24h = sumWindow(
        mentions,
        (r) => r.mention_count,
        24 * 60 * 60 * 1000,
      );
      const reddit_velocity = Math.log10(mentions_24h + 1);

      // Trends velocity — day-over-day delta on Google's 0-100 search
      // interest. Cold-start (one data point) treats prior as 0. Empty
      // until GH Action restored.
      const trendsToday = trends[0]?.search_interest ?? null;
      const trendsPrior = trends[1]?.search_interest ?? null;
      const trends_velocity =
        trendsToday == null
          ? 0
          : trendsPrior == null
            ? trendsToday / 100
            : (trendsToday - trendsPrior) / 100;

      // --- ALWAYS-ON METADATA FLOORS ------------------------------------

      const setReleaseDate =
        (card as unknown as { sets?: { release_date?: string } }).sets
          ?.release_date ?? null;
      const newness_signal = newnessSignal(setReleaseDate);
      const rarity_signal = rarityTierValue(card.rarity ?? null) / 90;

      // Volume_24h kept in score_history components for backward-compat
      // backtest visibility; not weighted in the new formula directly
      // (it's superseded by the future sold_velocity slot once Insights
      // flows). Logging it here so weight-tuning experiments can pull
      // historical data without re-running the scoring loop.
      const volume_24h_count = sumWindow(
        volumes,
        (r) => r.sales_count,
        24 * 60 * 60 * 1000,
      );
      const volume_24h = Math.log10(volume_24h_count + 1);

      // --- COMBINE ------------------------------------------------------

      const raw =
        sold_velocity * W_SOLD_VELOCITY +
        active_count_signal * W_ACTIVE_COUNT +
        reddit_velocity * W_REDDIT +
        trends_velocity * W_TRENDS +
        newness_signal * W_NEWNESS +
        rarity_signal * W_RARITY;

      const score = Math.round(sigmoid(raw) * 100 * 100) / 100;
      const components = {
        sold_velocity,
        active_count,
        active_count_signal,
        reddit_velocity,
        trends_velocity,
        newness_signal,
        rarity_signal,
        volume_24h, // logged for backtesting; not weighted
        raw,
      };

      scoreHistoryRows.push({
        card_id: card.id,
        popularity_score: score,
        heating_up_score: null,
        components,
      });
      cardUpserts.push({
        id: card.id,
        popularity_score: score,
        updated_at: nowIso,
      });
    }

    // --- BATCHED WRITES (2 round-trips for the entire batch) ------------
    // score_history is append-only — straight insert.
    if (scoreHistoryRows.length > 0) {
      const { error: histErr } = await admin
        .from('score_history')
        .insert(scoreHistoryRows);
      if (histErr) {
        console.warn(`score_history bulk insert failed: ${histErr.message}`);
      }
    }
    // cards updates — fan out 200 partial-column UPDATEs via Promise.all.
    //
    // Why not bulk upsert? supabase-js .upsert() sends INSERT ... ON
    // CONFLICT (id) DO UPDATE; PostgreSQL evaluates the INSERT row first
    // and rejects it if NOT NULL columns are missing (cards has brand_id,
    // name, set_id, etc.) — even though the conflict path would only run
    // the UPDATE half. Result: the bulk upsert silently errored, returning
    // cards_updated: 0 in our first deploy.
    //
    // Fan-out parallelism: 200 partial-column UPDATEs over HTTP/2 keep-
    // alive run concurrently in ~1-2s. Together with the 4 batched reads
    // + 1 batched score_history insert, total wall time stays well under
    // the 60s ceiling. If volume grows past ~500 cards/batch, swap this
    // for an RPC that does UPDATE ... FROM jsonb_to_recordset() in a
    // single round-trip.
    let updated = 0;
    if (cardUpserts.length > 0) {
      const updateResults = await Promise.all(
        cardUpserts.map((u) =>
          admin
            .from('cards')
            .update({ popularity_score: u.popularity_score, updated_at: u.updated_at })
            .eq('id', u.id),
        ),
      );
      const errors = updateResults
        .filter((r) => r.error)
        .map((r) => r.error?.message);
      if (errors.length > 0) {
        console.warn(
          `cards updates: ${errors.length}/${updateResults.length} failed; first: ${errors[0] ?? 'unknown'}`,
        );
      }
      updated = updateResults.length - errors.length;
    }

    // Success on every clean batch run. cost_units = cards processed for
    // batch-pacing visibility on /admin/scrapers.
    await recordOutcome(admin, SOURCE, {
      kind: 'success',
      statusCode: 200,
      scraped: cards?.length ?? 0,
    } as ScrapeOutcome);

    return jsonResponse({
      ok: true,
      cards_processed: cards?.length ?? 0,
      cards_updated: updated,
    });
  }),
);
