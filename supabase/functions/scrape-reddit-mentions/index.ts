// Per-card Reddit mention counter. Pulls a batch of cards (oldest signal
// first), searches each in the relevant subreddit(s), writes counts to
// public.reddit_mentions.
//
// Brand → subreddit map keeps per-brand subreddits configurable in code
// rather than DB for now (small list, rarely changes).

import { adminClient } from '../_shared/auth.ts';
import { logApiRequest } from '../_shared/api-log.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { takeToken } from '../_shared/rate-limit.ts';
import { countMentions, isLive } from '../_shared/reddit.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'reddit';
const RATE_LIMIT_PER_HOUR = 60 * 60; // Reddit allows ~60/min OAuth'd
const BATCH_SIZE = 30;

const BRAND_SUBREDDITS: Record<string, string[]> = {
  pokemon: ['PokemonTCG'],
  bandai: ['onepiecetcg'],
  topps: ['sportscards'],
  // additional brands map here
};

Deno.serve(withSentry('scrape-reddit-mentions', async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const admin = adminClient();

  // Even in dev mode (no creds) we still write mention counts so the
  // popularity formula has a column to read from.
  const allowed = await takeToken(admin, SOURCE, RATE_LIMIT_PER_HOUR);
  if (!allowed) return jsonResponse({ ok: false, error: 'Rate limit hit' }, 429);

  // Pull cards to refresh — oldest reddit_mentions first, batched.
  // We need card.name for the search and brand_id to pick the subreddit.
  const { data: cards, error: cardErr } = await admin
    .from('cards')
    .select('id, name, brand_id')
    .order('updated_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (cardErr) return jsonResponse({ ok: false, error: cardErr.message }, 500);

  let inserted = 0;
  for (const card of cards ?? []) {
    const subs = BRAND_SUBREDDITS[card.brand_id] ?? [];
    for (const sub of subs) {
      try {
        const count = await countMentions(card.name, sub);
        const { error: insErr } = await admin.from('reddit_mentions').insert({
          card_id: card.id,
          subreddit: sub,
          mention_count: count,
        });
        if (insErr) {
          console.warn(`reddit_mentions insert failed: ${insErr.message}`);
          continue;
        }
        inserted++;
      } catch (e) {
        console.warn(`countMentions failed for ${card.name}/${sub}: ${(e as Error).message}`);
      }
    }
  }

  await logApiRequest(admin, {
    source: SOURCE,
    endpoint: isLive ? 'live:search' : 'dev:synthetic',
    statusCode: 200,
    costUnits: inserted,
  });

  return jsonResponse({
    ok: true,
    mode: isLive ? 'live' : 'dev',
    cards_processed: cards?.length ?? 0,
    rows_inserted: inserted,
  });
}));
