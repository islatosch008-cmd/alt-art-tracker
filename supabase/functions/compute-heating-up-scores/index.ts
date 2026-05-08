// Heating Up scorer. Different signal mix than compute-popularity-scores —
// this one is about ACCELERATION, not absolute hotness. The spec:
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

    let updated = 0;
    let unchanged = 0;

    for (const card of cards ?? []) {
      const [priceRes, volumeRes, mentionRes] = await Promise.all([
        admin
          .from('price_history')
          .select('price, recorded_at')
          .eq('card_id', card.id)
          .gte('recorded_at', new Date(ago30d).toISOString())
          .order('recorded_at', { ascending: false }),
        admin
          .from('volume_history')
          .select('sales_count, recorded_at')
          .eq('card_id', card.id)
          .gte('recorded_at', new Date(ago30d).toISOString())
          .order('recorded_at', { ascending: false }),
        admin
          .from('reddit_mentions')
          .select('mention_count, recorded_at')
          .eq('card_id', card.id)
          .gte('recorded_at', new Date(ago30d).toISOString())
          .order('recorded_at', { ascending: false }),
      ]);

      const prices = (priceRes.data ?? []) as PriceRow[];
      const volumes = (volumeRes.data ?? []) as VolumeRow[];
      const mentions = (mentionRes.data ?? []) as MentionRow[];

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

      // Always log to score_history so weight tuning can be backtested.
      await admin.from('score_history').insert({
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
        const { error: updErr } = await admin
          .from('cards')
          .update({ heating_up_score: score, updated_at: new Date().toISOString() })
          .eq('id', card.id);
        if (updErr) {
          console.warn(`heating_up update failed for ${card.id}: ${updErr.message}`);
          continue;
        }
        updated++;
      } else {
        unchanged++;
      }
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
