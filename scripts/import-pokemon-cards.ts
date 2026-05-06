// Pokemon TCG API -> public.sets + public.cards
//
// Idempotent: select existing rows by external_ids->>'tcg_api_id' first, then
// only insert what's new. Re-running is safe and quick.
//
// Usage:
//   npm run import:pokemon                     # imports recent sets (>= 2024-01-01)
//   npm run import:pokemon -- --since 2023-01  # custom cutoff
//   npm run import:pokemon -- --all            # everything (~17k cards, slow)
//
// Pokemon TCG API:
//   https://api.pokemontcg.io/v2 — free, no key needed for low volume.

import { adminClient } from './_supabase.ts';
import { avgPrice, estimateEbayFromTcg, extractTcgPrice, round2 } from './_pokemon-price.ts';

const API_ROOT = 'https://api.pokemontcg.io/v2';
const PAGE_SIZE = 250; // API max
const BRAND_ID = 'pokemon';

type ApiSet = {
  id: string;
  name: string;
  series: string;
  releaseDate: string; // "YYYY/MM/DD"
  ptcgoCode?: string;
  total?: number;
  printedTotal?: number;
};

type ApiCard = {
  id: string;
  name: string;
  number?: string;
  rarity?: string;
  set: { id: string };
  images?: { small?: string; large?: string };
  tcgplayer?: {
    url?: string;
    updatedAt?: string;
    prices?: Record<string, Record<string, number> | null>;
  };
};

function parseArgs(argv: string[]): { since: string; all: boolean } {
  let since = '2024-01-01';
  let all = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--since') since = argv[i + 1] ?? since;
    if (argv[i] === '--all') all = true;
  }
  return { since, all };
}

function isoDate(slashes: string | undefined): string | null {
  if (!slashes) return null;
  const [y, m, d] = slashes.split('/');
  if (!y || !m || !d) return null;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

async function fetchAllSets(): Promise<ApiSet[]> {
  const sets: ApiSet[] = [];
  let page = 1;
  while (true) {
    const url = `${API_ROOT}/sets?orderBy=-releaseDate&page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Sets fetch ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as { data: ApiSet[] };
    sets.push(...json.data);
    if (json.data.length < PAGE_SIZE) break;
    page++;
  }
  return sets;
}

async function fetchCardsForSet(setId: string): Promise<ApiCard[]> {
  const cards: ApiCard[] = [];
  let page = 1;
  while (true) {
    const url = `${API_ROOT}/cards?q=set.id:${setId}&page=${page}&pageSize=${PAGE_SIZE}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Cards fetch ${res.status} for ${setId}: ${await res.text()}`);
    const json = (await res.json()) as { data: ApiCard[] };
    cards.push(...json.data);
    if (json.data.length < PAGE_SIZE) break;
    page++;
  }
  return cards;
}

async function main() {
  const { since, all } = parseArgs(process.argv.slice(2));
  const supabase = adminClient();

  console.log(`> Fetching Pokemon TCG sets`);
  const allSets = await fetchAllSets();
  console.log(`  ${allSets.length} sets returned`);

  const filtered = all
    ? allSets
    : allSets.filter((s) => {
        const iso = isoDate(s.releaseDate);
        return iso ? iso >= since : false;
      });
  console.log(`  ${filtered.length} sets in scope (cutoff ${all ? 'none' : since})`);

  // 1) Sync sets ----------------------------------------------------------
  console.log(`> Loading existing sets from DB`);
  const { data: existingSets, error: setReadErr } = await supabase
    .from('sets')
    .select('id, external_ids')
    .eq('brand_id', BRAND_ID);
  if (setReadErr) throw setReadErr;

  const setApiIdToUuid = new Map<string, string>();
  for (const row of existingSets ?? []) {
    const apiId = (row.external_ids as { tcg_api_id?: string } | null)?.tcg_api_id;
    if (apiId) setApiIdToUuid.set(apiId, row.id);
  }

  const newSetRows = filtered
    .filter((s) => !setApiIdToUuid.has(s.id))
    .map((s) => ({
      brand_id: BRAND_ID,
      name: s.name,
      release_date: isoDate(s.releaseDate),
      external_ids: {
        tcg_api_id: s.id,
        ptcgo_code: s.ptcgoCode ?? null,
        series: s.series,
        printed_total: s.printedTotal ?? null,
        total: s.total ?? null,
      },
    }));

  if (newSetRows.length > 0) {
    console.log(`  inserting ${newSetRows.length} new sets`);
    const { data: inserted, error: insErr } = await supabase
      .from('sets')
      .insert(newSetRows)
      .select('id, external_ids');
    if (insErr) throw insErr;
    for (const row of inserted ?? []) {
      const apiId = (row.external_ids as { tcg_api_id?: string } | null)?.tcg_api_id;
      if (apiId) setApiIdToUuid.set(apiId, row.id);
    }
  } else {
    console.log(`  no new sets`);
  }

  // 2) Sync cards per set -------------------------------------------------
  console.log(`> Loading existing cards from DB`);
  const { data: existingCards, error: cardReadErr } = await supabase
    .from('cards')
    .select('external_ids')
    .eq('brand_id', BRAND_ID);
  if (cardReadErr) throw cardReadErr;

  const existingCardIds = new Set<string>();
  for (const row of existingCards ?? []) {
    const apiId = (row.external_ids as { tcg_api_id?: string } | null)?.tcg_api_id;
    if (apiId) existingCardIds.add(apiId);
  }
  console.log(`  ${existingCardIds.size} cards already in DB`);

  let totalInserted = 0;
  for (const set of filtered) {
    const setUuid = setApiIdToUuid.get(set.id);
    if (!setUuid) continue;

    const apiCards = await fetchCardsForSet(set.id);
    const now = new Date().toISOString();
    const newRows = apiCards
      .filter((c) => !existingCardIds.has(c.id))
      .map((c) => {
        const tcg = extractTcgPrice(c.tcgplayer);
        const ebay = tcg != null ? estimateEbayFromTcg(tcg) : null;
        const avg = tcg != null && ebay != null ? avgPrice(tcg, ebay) : null;
        return {
          set_id: setUuid,
          brand_id: BRAND_ID,
          category: 'tcg',
          name: c.name,
          card_number: c.number ?? null,
          rarity: c.rarity ?? null,
          is_sealed: false,
          image_url: c.images?.large ?? c.images?.small ?? null,
          external_ids: { tcg_api_id: c.id },
          tcgplayer_market_price: tcg != null ? round2(tcg) : null,
          ebay_avg_price: ebay != null ? round2(ebay) : null,
          current_price: avg != null ? round2(avg) : null,
          last_price_check_at: tcg != null ? now : null,
        };
      });

    if (newRows.length === 0) {
      console.log(`  ${set.name.padEnd(30)} ${apiCards.length} cards, 0 new`);
      continue;
    }

    // Insert in chunks to keep the request payload reasonable.
    const CHUNK = 100;
    for (let i = 0; i < newRows.length; i += CHUNK) {
      const chunk = newRows.slice(i, i + CHUNK);
      const { error: cardInsErr } = await supabase.from('cards').insert(chunk);
      if (cardInsErr) {
        console.error(`  ! ${set.name} chunk ${i}: ${cardInsErr.message}`);
        throw cardInsErr;
      }
      for (const row of chunk) {
        existingCardIds.add(row.external_ids.tcg_api_id);
      }
    }
    totalInserted += newRows.length;
    console.log(
      `  ${set.name.padEnd(30)} ${apiCards.length} cards, +${newRows.length} new`,
    );
  }

  // 3) Summary ------------------------------------------------------------
  const { count: totalCards } = await supabase
    .from('cards')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', BRAND_ID);

  console.log(`\n> Done. inserted ${totalInserted} new cards. total Pokemon cards: ${totalCards}`);
}

main().catch((err) => {
  console.error('\nImport failed:', err.message ?? err);
  process.exit(1);
});
