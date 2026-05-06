// Hourly scraper that pulls current prices from PriceCharting and writes them
// to public.price_history + updates public.cards.current_price.
//
// Day 6 status: scaffolded only. Without PRICECHARTING_API_KEY in
// supabase/functions/.env we skip cleanly and return ok. Real scraping wires
// up Week 2 once we have:
//   1) Ian's PriceCharting API key in env
//   2) external_ids.pricecharting_id mapped on each card (via search-and-link
//      pass that runs once per new card)

import { adminClient } from '../_shared/auth.ts';
import { logApiRequest } from '../_shared/api-log.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { takeToken } from '../_shared/rate-limit.ts';

const API_KEY = Deno.env.get('PRICECHARTING_API_KEY');
const SOURCE = 'pricecharting';
const RATE_LIMIT_PER_HOUR = 1000; // PriceCharting allows generous quota; tighten with their docs

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const admin = adminClient();

  if (!API_KEY) {
    console.log(`[${SOURCE}] no API key in env, skipping (dev mode)`);
    await logApiRequest(admin, {
      source: SOURCE,
      endpoint: 'skip:no-api-key',
      statusCode: 0,
    });
    return jsonResponse({ ok: true, mode: 'dev', skipped: 'no API key' });
  }

  const allowed = await takeToken(admin, SOURCE, RATE_LIMIT_PER_HOUR);
  if (!allowed) {
    return jsonResponse(
      { ok: false, error: 'Rate limit hit for this hour' },
      429,
    );
  }

  // Fetch cards that need a price refresh (oldest last_price_check_at first,
  // bounded so we don't try to do all 17k in a single invocation).
  const { data: cards, error: readErr } = await admin
    .from('cards')
    .select('id, name, external_ids, last_price_check_at')
    .order('last_price_check_at', { ascending: true, nullsFirst: true })
    .limit(200);
  if (readErr) {
    return jsonResponse({ ok: false, error: readErr.message }, 500);
  }

  let priced = 0;
  let skipped = 0;

  for (const card of cards ?? []) {
    const pcId = (card.external_ids as { pricecharting_id?: string } | null)
      ?.pricecharting_id;
    if (!pcId) {
      skipped++;
      continue;
    }

    // TODO Week 2: call /api/product?id=<pcId>&t=API_KEY, parse, write
    // price_history, update cards.current_price + last_price_check_at.
    priced++;
  }

  return jsonResponse({
    ok: true,
    mode: 'live',
    cards_considered: cards?.length ?? 0,
    cards_priced: priced,
    cards_skipped_no_id: skipped,
    note: 'Real scraping lands Week 2; this run is a no-op against live API.',
  });
});
