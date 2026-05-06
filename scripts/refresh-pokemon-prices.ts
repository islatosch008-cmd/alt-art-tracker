// Refresh Pokemon card prices in the DB from the Pokemon TCG API.
//
// Real TCGplayer market prices come from each card's tcgplayer.prices.
// eBay stays estimated (TCG × 0.85–1.00) until we have eBay Browse API
// + Marketplace Insights credentials. current_price = avg of the two.
//
// Idempotent — run as often as you like. Safe to re-run; updates in place.
//
// Usage:
//   npm run refresh:prices               # all Pokemon sets present in DB
//   npm run refresh:prices -- --set sv8  # one set only

import { adminClient } from './_supabase.ts';
import { avgPrice, estimateEbayFromTcg, extractTcgPrice, round2 } from './_pokemon-price.ts';

const API_ROOT = 'https://api.pokemontcg.io/v2';
const PAGE_SIZE = 250;
const BRAND_ID = 'pokemon';
const UPDATE_CONCURRENCY = 25;

type ApiCard = {
  id: string;
  tcgplayer?: {
    prices?: Record<string, Record<string, number> | null>;
  };
};

function parseArgs(argv: string[]): { setFilter: string | null } {
  let setFilter: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--set') setFilter = argv[i + 1] ?? null;
  }
  return { setFilter };
}

async function fetchCardsForSet(setApiId: string): Promise<ApiCard[]> {
  const cards: ApiCard[] = [];
  let page = 1;
  while (true) {
    // No `&select=` — that param filters at the top level and drops nested
    // tcgplayer.prices entirely. Cheap to fetch the full card.
    const url = `${API_ROOT}/cards?q=set.id:${setApiId}&page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch ${res.status} for ${setApiId}: ${await res.text()}`);
    const json = (await res.json()) as { data: ApiCard[] };
    cards.push(...json.data);
    if (json.data.length < PAGE_SIZE) break;
    page++;
  }
  return cards;
}

// Supabase JS caps a single .select() at 1000 rows. Page through .range()
// to get the full table.
async function loadAllCardMappings(supabase: ReturnType<typeof adminClient>) {
  const map = new Map<string, string>();
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, external_ids')
      .eq('brand_id', BRAND_ID)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const apiId = (row.external_ids as { tcg_api_id?: string } | null)?.tcg_api_id;
      if (apiId) map.set(apiId, row.id);
    }
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

async function main() {
  const { setFilter } = parseArgs(process.argv.slice(2));
  const supabase = adminClient();
  const startedAt = new Date().toISOString();

  console.log(`> Loading Pokemon sets from DB`);
  const { data: setRows, error: setErr } = await supabase
    .from('sets')
    .select('external_ids')
    .eq('brand_id', BRAND_ID);
  if (setErr) throw setErr;

  const setApiIds = (setRows ?? [])
    .map((r) => (r.external_ids as { tcg_api_id?: string } | null)?.tcg_api_id)
    .filter((id): id is string => !!id)
    .filter((id) => !setFilter || id === setFilter);
  console.log(`  ${setApiIds.length} sets in scope`);

  console.log(`> Loading Pokemon cards from DB`);
  const apiIdToOurId = await loadAllCardMappings(supabase);
  console.log(`  ${apiIdToOurId.size} cards mappable`);

  let updated = 0;
  let withTcg = 0;
  let withoutTcg = 0;

  for (const setApiId of setApiIds) {
    const apiCards = await fetchCardsForSet(setApiId);

    // Build update operations.
    type Op = {
      ourId: string;
      tcg: number;
      ebay: number;
      avg: number;
    };
    const ops: Op[] = [];
    for (const c of apiCards) {
      const ourId = apiIdToOurId.get(c.id);
      if (!ourId) continue;
      const tcg = extractTcgPrice(c.tcgplayer);
      if (tcg == null) {
        withoutTcg++;
        continue;
      }
      const ebay = estimateEbayFromTcg(tcg);
      ops.push({
        ourId,
        tcg: round2(tcg),
        ebay: round2(ebay),
        avg: round2(avgPrice(tcg, ebay)),
      });
    }
    withTcg += ops.length;

    // Run updates with bounded concurrency so we don't open 250 sockets at once.
    for (let i = 0; i < ops.length; i += UPDATE_CONCURRENCY) {
      const slice = ops.slice(i, i + UPDATE_CONCURRENCY);
      await Promise.all(
        slice.map((op) =>
          supabase
            .from('cards')
            .update({
              tcgplayer_market_price: op.tcg,
              ebay_avg_price: op.ebay,
              current_price: op.avg,
              last_price_check_at: startedAt,
            })
            .eq('id', op.ourId),
        ),
      );
      updated += slice.length;
    }
    console.log(
      `  ${setApiId.padEnd(8)} ${apiCards.length.toString().padStart(3)} cards, ${ops.length} priced`,
    );
  }

  console.log(
    `\n> Done. updated ${updated} cards (${withTcg} had TCG data, ${withoutTcg} skipped — no TCG signal yet).`,
  );
}

main().catch((err) => {
  console.error('\nRefresh failed:', err.message ?? err);
  process.exit(1);
});
