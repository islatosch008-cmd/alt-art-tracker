// compute-trending — recalculate cards.trending_score for the Trending tab.
//
// REPLACES v1's compute-popularity-scores. v1's weighted popularity
// formula AND the heating-up algorithm are SCRAPPED (per the project
// owner). Trending is rebuilt fresh from two signals we actually have
// data for:
//
//   (a) PRICE MOMENTUM — percent price change derived from
//       justtcg_price_snapshots over a ~7-day window. JustTCG returns
//       current price only, so momentum is computed by US from the
//       snapshot history fetch-justtcg accumulates.
//
//   (b) eBAY ACTIVE-LISTING VOLUME — how many listings a card actually
//       has live on eBay, read from price_history.total_active on the
//       card's source='ebay_active' rows. scrape-ebay-active records
//       eBay's real match count per scrape; we take the most recent
//       non-null value within a recent window. (Earlier this signal
//       counted the NUMBER of ebay_active rows, which only measured
//       scrape frequency — total_active is the genuine supply count.)
//
// FORMULA  (deliberately simple, fully documented here)
// =====================================================
// Per card:
//
//   momentum_pct = (newest_price - oldest_price) / oldest_price
//                  averaged across the card's variants that have >= 2
//                  snapshots in the window. Cards with too few snapshots
//                  get a NEUTRAL momentum of 0 (no crash, no penalty).
//
//   momentum_signal = clamp(momentum_pct, -0.5, +0.5) normalized to 0..1
//                   = (clamp(momentum_pct, -0.5, 0.5) + 0.5)        // 0..1
//     A flat card (0% change) -> 0.5. A +50%-or-more card -> 1.0.
//     A -50%-or-worse card -> 0.0. Caps keep one volatile card from
//     dominating.
//
//   volume_signal = min(log10(total_active + 1) / 3.3, 1)            // 0..1
//     total_active is eBay's real listing count for the card (0 to
//     thousands), taken from the most recent non-null ebay_active
//     price_history row in the window. Log10 scale so a card with
//     thousands of listings doesn't swamp the rest, and a card with no
//     usable total_active gets a neutral 0. Divisor 3.3 ~= log10(2000),
//     so ~2,000 live listings maps to ~1.0; ~50 -> ~0.52, ~5 -> ~0.24.
//     A genuine listing count is a far better supply proxy than the old
//     row-count, which only reflected how often the scraper ran.
//
//   raw = W_MOMENTUM * momentum_signal + W_VOLUME * volume_signal
//   trending_score = round(raw * 100, 2)                             // 0..100
//
// Both signals are normalized to a comparable 0..1 range BEFORE combining
// and the weights sum to 1.0, so trending_score is a clean 0..100.
//
// THIRD-INPUT SEAM
// ================
// A third signal — true eBay SOLD counts via Marketplace Insights — is
// pending eBay approval. The seam is marked `THIRD SIGNAL SEAM` below:
// add W_SOLD, compute sold_signal, fold it into `raw`, and renormalize
// the weights. No schema change needed — scrape-ebay-sold already writes
// to volume_history (source='ebay').

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { recordOutcome } from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'compute-trending';

// How many cards to score per run. Trending only needs the top ~50 in
// the UI; scoring 500/run with stale-first ordering keeps the whole
// catalog's scores fresh over a few runs without a 60s-ceiling risk.
const BATCH_SIZE = 500;

// Momentum window. fetch-justtcg snapshots accumulate over time; ~7 days
// is enough to capture a real price move while staying recent.
const MOMENTUM_WINDOW_DAYS = 7;

// eBay active-listing window — read the most recent non-null
// total_active from source='ebay_active' price_history rows captured in
// this window as the volume signal.
const VOLUME_WINDOW_DAYS = 7;

// Signal weights — sum to 1.0.
const W_MOMENTUM = 0.6; // price momentum is the primary trend signal
const W_VOLUME = 0.4;   // eBay active-listing volume is the supply/interest signal
// THIRD SIGNAL SEAM: const W_SOLD = 0.x; — re-balance the three to sum 1.0
// when eBay Marketplace Insights (true sold counts) is approved.

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

type SnapshotRow = {
  card_id: string;
  variant_id: string;
  price: number;
  captured_at: string;
};

// Average per-variant percent price change over the window. A variant
// contributes only if it has >= 2 snapshots; a card with no qualifying
// variant returns a neutral 0 (handled by the caller as momentum_signal
// 0.5). Never throws.
function cardMomentumPct(rows: SnapshotRow[]): number {
  const byVariant = new Map<string, SnapshotRow[]>();
  for (const r of rows) {
    const arr = byVariant.get(r.variant_id) ?? [];
    arr.push(r);
    byVariant.set(r.variant_id, arr);
  }
  const pcts: number[] = [];
  for (const variantRows of byVariant.values()) {
    if (variantRows.length < 2) continue; // too few snapshots — skip
    const sorted = [...variantRows].sort(
      (a, b) =>
        new Date(a.captured_at).getTime() - new Date(b.captured_at).getTime(),
    );
    const oldest = sorted[0].price;
    const newest = sorted[sorted.length - 1].price;
    if (!Number.isFinite(oldest) || oldest === 0) continue;
    pcts.push((newest - oldest) / oldest);
  }
  if (pcts.length === 0) return 0; // neutral — no usable history
  return pcts.reduce((s, p) => s + p, 0) / pcts.length;
}

Deno.serve(
  withSentry(SOURCE, async (req) => {
    const pre = preflight(req);
    if (pre) return pre;
    const admin = adminClient();

    // --- SELECT CARDS TO SCORE -------------------------------------------
    // Stale-first by updated_at so the whole catalog cycles through.
    const { data: cards, error: cardErr } = await admin
      .from('cards')
      .select('id')
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

    const cardIds = (cards ?? []).map((c) => c.id);
    if (cardIds.length === 0) {
      await recordOutcome(admin, SOURCE, {
        kind: 'success',
        statusCode: 200,
        scraped: 0,
      });
      return jsonResponse({ ok: true, cards_processed: 0, cards_updated: 0 });
    }

    const now = Date.now();
    const momentumCutoff = new Date(
      now - MOMENTUM_WINDOW_DAYS * 86_400_000,
    ).toISOString();
    const volumeCutoff = new Date(
      now - VOLUME_WINDOW_DAYS * 86_400_000,
    ).toISOString();

    // --- BATCHED SIGNAL READS (2 round-trips for the whole batch) --------
    const [snapRes, activeRes] = await Promise.all([
      admin
        .from('justtcg_price_snapshots')
        .select('card_id, variant_id, price, captured_at')
        .in('card_id', cardIds)
        .gte('captured_at', momentumCutoff),
      admin
        .from('price_history')
        .select('card_id, total_active, recorded_at')
        .in('card_id', cardIds)
        .eq('source', 'ebay_active')
        .gte('recorded_at', volumeCutoff)
        .order('recorded_at', { ascending: false }),
    ]);
    if (snapRes.error) {
      await recordOutcome(admin, SOURCE, {
        kind: 'failure',
        statusCode: 500,
        error: `snapshots read: ${snapRes.error.message}`,
      });
      return jsonResponse({ ok: false, error: snapRes.error.message }, 500);
    }
    if (activeRes.error) {
      await recordOutcome(admin, SOURCE, {
        kind: 'failure',
        statusCode: 500,
        error: `price_history read: ${activeRes.error.message}`,
      });
      return jsonResponse({ ok: false, error: activeRes.error.message }, 500);
    }

    // Group snapshots by card.
    const snapsByCard = new Map<string, SnapshotRow[]>();
    for (const r of (snapRes.data ?? []) as SnapshotRow[]) {
      const arr = snapsByCard.get(r.card_id) ?? [];
      arr.push(r);
      snapsByCard.set(r.card_id, arr);
    }
    // Most recent non-null total_active per card. The query is ordered
    // recorded_at DESC, so the first non-null value seen for a card is
    // the freshest one. Cards with no usable total_active are absent
    // from the map and fall back to a neutral 0 volume signal.
    const totalActiveByCard = new Map<string, number>();
    for (
      const r of (activeRes.data ?? []) as {
        card_id: string;
        total_active: number | null;
        recorded_at: string;
      }[]
    ) {
      if (totalActiveByCard.has(r.card_id)) continue; // already have a fresher row
      if (typeof r.total_active === 'number' && Number.isFinite(r.total_active)) {
        totalActiveByCard.set(r.card_id, r.total_active);
      }
    }

    // --- SCORE EACH CARD (in-memory, no I/O) -----------------------------
    type Update = { id: string; trending_score: number };
    const updates: Update[] = [];
    for (const id of cardIds) {
      const snaps = snapsByCard.get(id) ?? [];
      // (a) price momentum — neutral 0 when too few snapshots.
      const momentumPct = cardMomentumPct(snaps);
      const momentumSignal = clamp(momentumPct, -0.5, 0.5) + 0.5; // 0..1

      // (b) eBay active-listing volume — log-scaled real listing count.
      // Neutral 0 when no usable total_active in the window.
      const totalActive = totalActiveByCard.get(id) ?? 0;
      const volumeSignal = Math.min(
        Math.log10(totalActive + 1) / 3.3,
        1,
      ); // 0..1 — divisor 3.3 ~= log10(2000); see header comment.

      // THIRD SIGNAL SEAM:
      //   const soldSignal = ...;  // from volume_history source='ebay'
      //   raw += W_SOLD * soldSignal;

      const raw = W_MOMENTUM * momentumSignal + W_VOLUME * volumeSignal;
      const score = Math.round(raw * 100 * 100) / 100; // 0..100, 2dp
      updates.push({ id, trending_score: score });
    }

    // --- BATCHED WRITES --------------------------------------------------
    // Fan out partial-column UPDATEs. Same rationale as v1: a bulk upsert
    // would re-INSERT the full row and trip NOT NULL constraints.
    let updated = 0;
    const results = await Promise.all(
      updates.map((u) =>
        admin
          .from('cards')
          .update({
            trending_score: u.trending_score,
            updated_at: new Date().toISOString(),
          })
          .eq('id', u.id),
      ),
    );
    const errors = results.filter((r) => r.error).map((r) => r.error?.message);
    if (errors.length > 0) {
      console.warn(
        `cards updates: ${errors.length}/${results.length} failed; first: ${errors[0] ?? 'unknown'}`,
      );
    }
    updated = results.length - errors.length;

    await recordOutcome(admin, SOURCE, {
      kind: 'success',
      statusCode: 200,
      scraped: updated,
    });

    return jsonResponse({
      ok: true,
      cards_processed: cardIds.length,
      cards_updated: updated,
      cards_with_momentum: [...snapsByCard.keys()].length,
      cards_with_active_volume: [...totalActiveByCard.keys()].length,
    });
  }),
);
