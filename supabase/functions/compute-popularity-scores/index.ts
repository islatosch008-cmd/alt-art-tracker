// Recalculate cards.popularity_score per the spec formula. Writes a
// score_history row per card with the component breakdown so we can backtest
// weight tweaks later.
//
// Formula (CLAUDE.md → "Trending Now scoring"):
//   raw =
//     price_velocity_24h * 0.30 +
//     price_velocity_7d  * 0.20 +
//     volume_24h         * 0.25 +
//     reddit_velocity    * 0.15 +
//     trends_velocity    * 0.10
//   popularity_score = sigmoid(raw) * 100
//
// Notes:
// * In Phase 1 most cards still lack price_history / volume_history rows,
//   so the score will sit near 50 (sigmoid(0)). We *only* overwrite the
//   existing popularity_score (which today holds the rarity-based
//   placeholder) when the recomputed score has at least one non-zero
//   signal. That way Trending stays useful while signals build up.
// * Trends signal reads from trends_history (region='US', most recent two
//   days). Day-over-day delta on Google's 0-100 search interest, divided
//   by 100 to keep contribution in roughly the same magnitude as the other
//   components. Zero when no trends rows exist for the card yet.

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { recordOutcome, type ScrapeOutcome } from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'compute-popularity';

const BATCH_SIZE = 200;

const W_PRICE_24H = 0.30;
const W_PRICE_7D = 0.20;
const W_VOLUME_24H = 0.25;
const W_REDDIT = 0.15;
const W_TRENDS = 0.10;

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
  // rows are sorted desc by recorded_at; find the most recent at or before `when`
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

Deno.serve(withSentry('compute-popularity-scores', async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const admin = adminClient();

  const { data: cards, error: cardErr } = await admin
    .from('cards')
    .select('id, current_price, popularity_score')
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
  const ago7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  let updated = 0;
  let unchanged = 0;

  for (const card of cards ?? []) {
    // Pull just-enough history per card. Each is a small range query so the
    // overall loop is acceptable for batch=200 in dev.
    const [priceRes, volumeRes, mentionRes, trendsRes] = await Promise.all([
      admin
        .from('price_history')
        .select('price, recorded_at')
        .eq('card_id', card.id)
        .gte('recorded_at', ago7d.toISOString())
        .order('recorded_at', { ascending: false }),
      admin
        .from('volume_history')
        .select('sales_count, recorded_at')
        .eq('card_id', card.id)
        .gte('recorded_at', ago24h.toISOString())
        .order('recorded_at', { ascending: false }),
      admin
        .from('reddit_mentions')
        .select('mention_count, recorded_at')
        .eq('card_id', card.id)
        .gte('recorded_at', ago24h.toISOString())
        .order('recorded_at', { ascending: false }),
      // Trends: most-recent two daily rows (US region, the only region the
      // GH Action populates today). Day-over-day delta is the velocity.
      admin
        .from('trends_history')
        .select('search_interest, date_reported')
        .eq('card_id', card.id)
        .eq('region', 'US')
        .order('date_reported', { ascending: false })
        .limit(2),
    ]);

    const prices = (priceRes.data ?? []) as PriceRow[];
    const volumes = (volumeRes.data ?? []) as VolumeRow[];
    const mentions = (mentionRes.data ?? []) as MentionRow[];
    const trends = (trendsRes.data ?? []) as TrendRow[];

    const price_velocity_24h = pctDelta(card.current_price, priceAtOrBefore(prices, ago24h));
    const price_velocity_7d = pctDelta(card.current_price, priceAtOrBefore(prices, ago7d));
    const volume_24h_count = sumWindow(volumes, (r) => r.sales_count, 24 * 60 * 60 * 1000);
    const volume_24h = Math.log10(volume_24h_count + 1);
    const mentions_24h = sumWindow(mentions, (r) => r.mention_count, 24 * 60 * 60 * 1000);
    const reddit_velocity = Math.log10(mentions_24h + 1);
    // Trends velocity: day-over-day delta on Google's 0-100 search interest,
    // normalized to roughly [-1, 1]. Cold start (only one data point) treats
    // missing prior day as 0 so the latest reading still contributes. Zero
    // when no trends rows exist for the card yet.
    const trendsToday = trends[0]?.search_interest ?? null;
    const trendsPrior = trends[1]?.search_interest ?? null;
    const trends_velocity =
      trendsToday == null
        ? 0
        : trendsPrior == null
          ? trendsToday / 100
          : (trendsToday - trendsPrior) / 100;

    const raw =
      price_velocity_24h * W_PRICE_24H +
      price_velocity_7d * W_PRICE_7D +
      volume_24h * W_VOLUME_24H +
      reddit_velocity * W_REDDIT +
      trends_velocity * W_TRENDS;

    const components = {
      price_velocity_24h,
      price_velocity_7d,
      volume_24h,
      reddit_velocity,
      trends_velocity,
      raw,
    };

    // Always log to score_history for backtesting visibility, even if we
    // don't update the live score.
    await admin.from('score_history').insert({
      card_id: card.id,
      popularity_score: Math.round(sigmoid(raw) * 100 * 100) / 100,
      heating_up_score: null,
      components,
    });

    // Only overwrite popularity_score when there's *any* signal — otherwise
    // the rarity-based placeholder is still the better default during the
    // signal-warmup period. Trends data alone qualifies as signal: a card
    // pulled into the daily Trends top-50 has demonstrated search activity
    // worth ranking on, even without price/volume/mention history.
    const hasSignal =
      price_velocity_24h !== 0 ||
      price_velocity_7d !== 0 ||
      volume_24h_count > 0 ||
      mentions_24h > 0 ||
      trendsToday != null;

    if (hasSignal) {
      const score = Math.round(sigmoid(raw) * 100 * 100) / 100;
      const { error: updErr } = await admin
        .from('cards')
        .update({ popularity_score: score, updated_at: now.toISOString() })
        .eq('id', card.id);
      if (updErr) {
        console.warn(`update failed for ${card.id}: ${updErr.message}`);
        continue;
      }
      updated++;
    } else {
      unchanged++;
    }
  }

  // Success on every clean batch run. cost_units = cards processed so the
  // dashboard can sanity-check the batch pacing (BATCH_SIZE=200 expected).
  await recordOutcome(admin, SOURCE, {
    kind: 'success',
    statusCode: 200,
    scraped: cards?.length ?? 0,
  } as ScrapeOutcome);

  return jsonResponse({
    ok: true,
    cards_processed: cards?.length ?? 0,
    cards_updated: updated,
    cards_unchanged_no_signal: unchanged,
  });
}));
