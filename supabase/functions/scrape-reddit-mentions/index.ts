// Per-card Reddit mention counter. Pulls a batch of cards (oldest signal
// first), searches each in the relevant subreddit(s), writes counts to
// public.reddit_mentions.
//
// Brand → subreddit map keeps per-brand subreddits configurable in code
// rather than DB for now (small list, rarely changes).
//
// 3-outcome model (matches the other 6 scrapers):
//   - success  ≥1 mention row inserted
//   - degraded creds missing (412), all attempts had 0 mentions, or no cards
//              in the brand→subreddit map
//   - failure  every Reddit call errored, or DB card-fetch failed
// recordOutcome fires Sentry on the SECOND consecutive failure for SOURCE.

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { takeToken } from '../_shared/rate-limit.ts';
import { countMentions, isLive } from '../_shared/reddit.ts';
import { recordOutcome, type ScrapeOutcome } from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'reddit';
const RATE_LIMIT_PER_HOUR = 60 * 60; // Reddit allows ~60/min OAuth'd
const BATCH_SIZE = 30;

// Spec subreddit list: r/PokemonTCG, r/sportscards, r/mtgfinance,
// r/onepiecetcg, r/PkmnTcgCollections.
const BRAND_SUBREDDITS: Record<string, string[]> = {
  pokemon: ['PokemonTCG', 'PkmnTcgCollections'],
  bandai: ['onepiecetcg'],
  // All sports brands surface in the same subreddit:
  topps: ['sportscards'],
  panini: ['sportscards'],
  bowman: ['sportscards'],
  upper_deck: ['sportscards'],
  leaf: ['sportscards'],
  fanatics: ['sportscards'],
  donruss: ['sportscards'],
  wild_card: ['sportscards'],
  // Magic when we seed the brand: ['mtgfinance']
};

const CREDS_HINT =
  'reddit credentials missing — set REDDIT_CLIENT_ID + REDDIT_CLIENT_SECRET in Edge Function secrets';

Deno.serve(
  withSentry('scrape-reddit-mentions', async (req) => {
    const pre = preflight(req);
    if (pre) return pre;

    const admin = adminClient();

    // Feature flag — match the eBay/PSA pattern. Without creds we record a
    // degraded outcome (so the dashboard surfaces the gap) and 412 the
    // caller. The previous "synthetic counts in dev mode" path produced
    // noise without signal — popularity scoring is fine without reddit
    // mentions until creds land.
    if (!isLive) {
      await recordOutcome(admin, SOURCE, {
        kind: 'degraded',
        statusCode: 412,
        reason: CREDS_HINT,
        url: 'https://oauth.reddit.com/api/v1/access_token',
      });
      return jsonResponse({ ok: false, hint: CREDS_HINT }, 412);
    }

    // Rate limit (internal flow control — not a scrape outcome).
    const allowed = await takeToken(admin, SOURCE, RATE_LIMIT_PER_HOUR);
    if (!allowed) return jsonResponse({ ok: false, error: 'Rate limit hit' }, 429);

    // Pull cards to refresh — oldest reddit_mentions first, batched.
    // We need card.name for the search and brand_id to pick the subreddit.
    const { data: cards, error: cardErr } = await admin
      .from('cards')
      .select('id, name, brand_id')
      .order('updated_at', { ascending: true })
      .limit(BATCH_SIZE);

    if (cardErr) {
      await recordOutcome(admin, SOURCE, {
        kind: 'failure',
        statusCode: 500,
        error: `card fetch failed: ${cardErr.message}`,
      });
      return jsonResponse({ ok: false, error: cardErr.message }, 500);
    }

    let inserted = 0;
    let attempted = 0;
    let errored = 0;

    for (const card of cards ?? []) {
      const subs = BRAND_SUBREDDITS[card.brand_id] ?? [];
      for (const sub of subs) {
        attempted++;
        try {
          const count = await countMentions(card.name, sub);
          const { error: insErr } = await admin.from('reddit_mentions').insert({
            card_id: card.id,
            subreddit: sub,
            mention_count: count,
          });
          if (insErr) {
            console.warn(`reddit_mentions insert failed: ${insErr.message}`);
            errored++;
            continue;
          }
          inserted++;
        } catch (e) {
          console.warn(`countMentions failed for ${card.name}/${sub}: ${(e as Error).message}`);
          errored++;
        }
      }
    }

    // Outcome classification — order matters: failure before degraded.
    let outcome: ScrapeOutcome;
    if (attempted > 0 && errored === attempted) {
      // Every Reddit call errored. Most likely cause: token endpoint down or
      // creds invalid. Failure → recordOutcome fires Sentry on 2nd consecutive.
      outcome = {
        kind: 'failure',
        statusCode: 502,
        error: `all ${attempted} reddit calls errored`,
      };
    } else if (attempted === 0) {
      // No card in the batch has a brand mapped to a subreddit. Could happen
      // if BRAND_SUBREDDITS gets out of sync with the brands table.
      outcome = {
        kind: 'degraded',
        statusCode: 200,
        reason: 'no cards in BRAND_SUBREDDITS map — check brand_id assignment',
        url: 'n/a',
      };
    } else if (inserted === 0) {
      // We tried, Reddit responded, but every search returned 0 mentions and
      // we still wrote zero rows. Worth surfacing — usually means the search
      // query strategy needs tweaking, not a system failure.
      outcome = {
        kind: 'degraded',
        statusCode: 200,
        reason: `0 mentions inserted across ${attempted} card×sub attempts`,
        url: 'https://oauth.reddit.com/search',
      };
    } else {
      outcome = { kind: 'success', statusCode: 200, scraped: inserted };
    }
    await recordOutcome(admin, SOURCE, outcome);

    return jsonResponse({
      ok: true,
      cards_processed: cards?.length ?? 0,
      rows_inserted: inserted,
      attempted,
      errored,
    });
  }),
);
