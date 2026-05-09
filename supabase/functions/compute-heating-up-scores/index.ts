// Heating Up scorer. Different signal mix than compute-popularity-scores —
// this one is about ACCELERATION, not absolute hotness.
//
// PERFORMANCE
// ===========
// Mirrors the e47ed34 batching pattern from compute-popularity-scores.
// Original per-card-loop did ~4 round-trips per card × 200 cards = 800
// round-trips, clocking 49-51s on prod — uncomfortably close to the 60s
// Edge runtime ceiling. Now:
//
//   1× cards SELECT
//   3× history reads  (price / volume / mention — all card_ids via .in())
//   1× score_history  bulk INSERT (200 rows)
//   N× cards          UPDATE (only for cards where hasSignal — typically
//                     0 on prod today; parallelized via Promise.all when
//                     signal flows in)
//
// Total: ~5 round-trips per cron tick when signal is sparse, ~5 + N
// when it's not. Expected wall time well under the 60s ceiling.
//
// SPEC
// ====
//
//   price_velocity_24h, _7d, _30d  — % change over each window
//   price_acceleration              — (24h velocity − 7d velocity)
//   volume_zscore                   — (24h volume − 30d avg) / 30d stddev
//   reddit_zscore                   — same shape over reddit_mentions
//
// Combined via fixed weights, sigmoid → 0–100. Same graceful-degradation
// pattern as the popularity scorer: only overwrite cards.heating_up_score
// when at least ONE signal is non-zero, so the rarity-based placeholder
// keeps surfacing during the cold-start period.
//
// COLD-START DESIGN — "missing signal contributes 0" is intentional
// ----------------------------------------------------------------
// When a signal source is missing for a card (no Reddit data, no volume
// history, etc.), that signal contributes 0 to `raw` rather than
// redistributing its weight to active signals. This biases the
// heating_up_score downward during the early-data-warmup period — a card
// with only price signals reads ~25-30 even on a strong move because the
// volume/reddit zeros drag sigmoid output toward 0.5.
//
// We chose this over weight redistribution for two reasons:
//   1. Conservative scoring during cold-start matches the hasSignal gate
//      below — we already accept "score is biased low until data fills
//      in" as the explicit early-warmup behavior. Redistributing weights
//      would bias scores HIGH from sparse data, making single-source
//      noise spikes (e.g., one viral Reddit thread on a low-volume card)
//      look like real heating events.
//   2. As data sources fill in, scores naturally recalibrate without code
//      changes. No need to know in advance which subset of signals will
//      be reliable for which subset of cards.
//
// Revisit weight redistribution when EITHER condition is met:
//   - 3+ signal sources are reliably populated for >50% of tracked cards.
//     Today (2026-05-09): only price + trends are reliable; volume and
//     Reddit are sparse (eBay creds pending; Reddit creds pending).
//   - Score-distribution analysis shows clustering at 25-30 that
//     correlates with sparse-data cards rather than genuinely cool ones.
//
// Decision logged in the audit pass 2026-05-08, ratified in this commit.

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { recordOutcome, type ScrapeOutcome } from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'compute-heating-up';

const BATCH_SIZE = 200;

// Spec weights — re-tunable.
const W = {
  price_v24: 0.20,
  price_v7: 0.15,
  price_v30: 0.10,
  price_accel: 0.20,
  volume_z: 0.20,
  reddit_z: 0.15,
};

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function pctDelta(current: number | null, then: number | null): number {
  if (current == null || then == null || then === 0) return 0;
  return (current - then) / then;
}

type Row = { recorded_at: string };
type PriceRow = Row & { price: number };
type VolumeRow = Row & { sales_count: number };
type MentionRow = Row & { mention_count: number };

function priceAtOrBefore(rows: PriceRow[], when: Date): number | null {
  // rows desc by recorded_at; first row at-or-before `when` wins.
  for (const r of rows) {
    if (new Date(r.recorded_at) <= when) return r.price;
  }
  return null;
}

// Sum a numeric field across rows whose recorded_at falls inside the window.
function sumWindow<T extends Row>(
  rows: T[],
  pick: (r: T) => number,
  startMs: number,
  endMs: number,
): number {
  let total = 0;
  for (const r of rows) {
    const t = new Date(r.recorded_at).getTime();
    if (t >= startMs && t < endMs) total += pick(r);
  }
  return total;
}

// Bucket rows into N-hour windows and return the daily-equivalent count
// (sum per 24h window over the last 30 days). Used as the baseline series
// for z-score.
function dailyBuckets<T extends Row>(
  rows: T[],
  pick: (r: T) => number,
  startMs: number,
  endMs: number,
): number[] {
  const days = Math.max(1, Math.floor((endMs - startMs) / 86_400_000));
  const buckets = new Array(days).fill(0) as number[];
  for (const r of rows) {
    const t = new Date(r.recorded_at).getTime();
    if (t < startMs || t >= endMs) continue;
    const idx = Math.min(days - 1, Math.floor((t - startMs) / 86_400_000));
    buckets[idx] += pick(r);
  }
  return buckets;
}

function meanStddev(arr: number[]): { mean: number; stddev: number } {
  if (arr.length === 0) return { mean: 0, stddev: 0 };
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance =
    arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / arr.length;
  return { mean, stddev: Math.sqrt(variance) };
}

Deno.serve(
  withSentry('compute-heating-up-scores', async (req) => {
    const pre = preflight(req);
    if (pre) return pre;

    const admin = adminClient();

    const { data: cards, error: cardErr } = await admin
      .from('cards')
      .select('id, current_price, heating_up_score')
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

    const now = Date.now();
    const ago30d = now - 30 * 86_400_000;
    const ago7d = now - 7 * 86_400_000;
    const ago24h = now - 24 * 60 * 60 * 1000;

    const cardIds = (cards ?? []).map((c) => c.id);
    if (cardIds.length === 0) {
      await recordOutcome(admin, SOURCE, {
        kind: 'success',
        statusCode: 200,
        scraped: 0,
      } as ScrapeOutcome);
      return jsonResponse({
        ok: true,
        cards_processed: 0,
        cards_updated: 0,
        cards_unchanged_no_signal: 0,
      });
    }

    // --- BATCHED HISTORY READS (3 round-trips for the entire batch) ----
    // Same pattern as compute-popularity-scores (e47ed34). Fetch the full
    // 30-day window for all cards in one query each, then group by
    // card_id in JS for in-memory scoring.
    const ago30dIso = new Date(ago30d).toISOString();
    const [priceRes, volumeRes, mentionRes] = await Promise.all([
      admin
        .from('price_history')
        .select('card_id, price, recorded_at')
        .in('card_id', cardIds)
        .gte('recorded_at', ago30dIso),
      admin
        .from('volume_history')
        .select('card_id, sales_count, recorded_at')
        .in('card_id', cardIds)
        .gte('recorded_at', ago30dIso),
      admin
        .from('reddit_mentions')
        .select('card_id, mention_count, recorded_at')
        .in('card_id', cardIds)
        .gte('recorded_at', ago30dIso),
    ]);

    type PriceRowWithCard = PriceRow & { card_id: string };
    type VolumeRowWithCard = VolumeRow & { card_id: string };
    type MentionRowWithCard = MentionRow & { card_id: string };

    const pricesByCard = new Map<string, PriceRowWithCard[]>();
    for (const r of (priceRes.data ?? []) as PriceRowWithCard[]) {
      const arr = pricesByCard.get(r.card_id) ?? [];
      arr.push(r);
      pricesByCard.set(r.card_id, arr);
    }
    // priceAtOrBefore expects rows desc by recorded_at; sort each group
    // since the batched query doesn't guarantee per-card ordering.
    for (const arr of pricesByCard.values()) {
      arr.sort((a, b) => (a.recorded_at < b.recorded_at ? 1 : -1));
    }
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

    // --- PER-CARD SCORING (in-memory, no I/O) ---------------------------
    type ScoreHistoryRow = {
      card_id: string;
      popularity_score: null;
      heating_up_score: number;
      components: Record<string, number>;
    };
    type CardUpdate = { id: string; heating_up_score: number };
    const scoreHistoryRows: ScoreHistoryRow[] = [];
    const cardUpdates: CardUpdate[] = [];
    let unchanged = 0;

    for (const card of cards ?? []) {
      const prices = pricesByCard.get(card.id) ?? [];
      const volumes = volumesByCard.get(card.id) ?? [];
      const mentions = mentionsByCard.get(card.id) ?? [];

      // Price velocities
      const v24 = pctDelta(card.current_price, priceAtOrBefore(prices, new Date(ago24h)));
      const v7 = pctDelta(card.current_price, priceAtOrBefore(prices, new Date(ago7d)));
      const v30 = pctDelta(card.current_price, priceAtOrBefore(prices, new Date(ago30d)));
      const accel = v24 - v7; // 2nd-derivative-ish: 24h pace vs 7d pace

      // Volume z-score: today's count vs the prior 29 days' daily distribution
      const volBuckets = dailyBuckets(volumes, (r) => r.sales_count, ago30d, now);
      const volToday = volBuckets[volBuckets.length - 1] ?? 0;
      const volPrior = volBuckets.slice(0, -1);
      const { mean: volMean, stddev: volStd } = meanStddev(volPrior);
      const volume_z = volStd > 0 ? (volToday - volMean) / volStd : 0;

      // Reddit z-score: same shape, mention counts as the metric.
      const memBuckets = dailyBuckets(mentions, (r) => r.mention_count, ago30d, now);
      const memToday = memBuckets[memBuckets.length - 1] ?? 0;
      const memPrior = memBuckets.slice(0, -1);
      const { mean: memMean, stddev: memStd } = meanStddev(memPrior);
      const reddit_z = memStd > 0 ? (memToday - memMean) / memStd : 0;

      const raw =
        v24 * W.price_v24 +
        v7 * W.price_v7 +
        v30 * W.price_v30 +
        accel * W.price_accel +
        volume_z * W.volume_z +
        reddit_z * W.reddit_z;

      const score = Math.round(sigmoid(raw) * 100 * 100) / 100;
      const components = {
        v24, v7, v30, accel, volume_z, reddit_z, raw,
      };

      scoreHistoryRows.push({
        card_id: card.id,
        popularity_score: null,
        heating_up_score: score,
        components,
      });

      // Same gate as popularity: only overwrite live score when there's
      // at least ONE non-zero signal. Prevents the rarity-based placeholder
      // from getting flatlined to 50 (sigmoid(0)*100) for every card.
      const hasSignal =
        v24 !== 0 ||
        v7 !== 0 ||
        v30 !== 0 ||
        accel !== 0 ||
        volume_z !== 0 ||
        reddit_z !== 0;

      if (hasSignal) {
        cardUpdates.push({ id: card.id, heating_up_score: score });
      } else {
        unchanged++;
      }
    }

    // --- BATCHED WRITES -----------------------------------------------
    // score_history: bulk insert (1 round-trip).
    if (scoreHistoryRows.length > 0) {
      const { error: histErr } = await admin
        .from('score_history')
        .insert(scoreHistoryRows);
      if (histErr) {
        console.warn(`score_history bulk insert failed: ${histErr.message}`);
      }
    }
    // cards updates: parallel partial-column UPDATEs via Promise.all
    // (NOT bulk upsert — same NOT NULL trap as P1; see e47ed34 commit
    // message for the full diagnosis). Only signal-having cards are in
    // cardUpdates, so this is typically tiny on prod.
    let updated = 0;
    if (cardUpdates.length > 0) {
      const updatedAtIso = new Date(now).toISOString();
      const updateResults = await Promise.all(
        cardUpdates.map((u) =>
          admin
            .from('cards')
            .update({ heating_up_score: u.heating_up_score, updated_at: updatedAtIso })
            .eq('id', u.id),
        ),
      );
      const errors = updateResults
        .filter((r) => r.error)
        .map((r) => r.error?.message);
      if (errors.length > 0) {
        console.warn(
          `heating_up cards updates: ${errors.length}/${updateResults.length} failed; first: ${errors[0] ?? 'unknown'}`,
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
      cards_unchanged_no_signal: unchanged,
    });
  }),
);
