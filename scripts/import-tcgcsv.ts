// TCGCSV ingest. Two modes per brand:
//
//   PRICE-ONLY (Pokemon today): metadata is owned by another source (Pokemon
//   TCG API). We don't insert sets or cards — we match TCGCSV products to
//   existing rows by (set name normalized + card_number) and update prices.
//
//   FULL CATALOG (Bandai, Lorcana, etc.): no other metadata source, so we
//   create sets + cards from TCGCSV. source='tcgcsv', source_id=String(id),
//   external_ids.tcgplayer_product_id stored on each card.
//
// Usage:
//   npm run tcgcsv:refresh                       # all brands
//   npm run tcgcsv:refresh -- --brand bandai     # one brand
//   npm run tcgcsv:refresh -- --brand pokemon --prices-only  # explicit

import type { SupabaseClient } from '@supabase/supabase-js';

import { adminClient } from './_supabase.ts';
import { captureException, flushSentry, initSentry } from './_sentry.ts';
import {
  bestPrice,
  fetchGroups,
  fetchPrices,
  fetchProducts,
  getExtended,
  isSealedProduct,
  type Group,
  type Price,
  type Product,
  resolveCategoriesForBrand,
} from './_tcgcsv.ts';

initSentry('import-tcgcsv');

// Hardcoded brand → category names. Names are stable; IDs are not (per Ian:
// resolve IDs at runtime).
const BRAND_CATEGORIES: Record<string, string[]> = {
  pokemon: ['Pokemon'],
  bandai: [
    'One Piece Card Game',
    'Digimon Card Game',
    'Dragon Ball Super Fusion World',
  ],
};

// Brands whose metadata is owned by another source. For these we never
// insert sets or cards, only update prices on existing rows.
const PRICE_ONLY_BRANDS = new Set(['pokemon']);

const BATCH_SIZE = 25;

function parseArgs(argv: string[]): { brand: string | null; pricesOnly: boolean } {
  let brand: string | null = null;
  let pricesOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--brand') brand = argv[i + 1] ?? null;
    if (argv[i] === '--prices-only') pricesOnly = true;
  }
  return { brand, pricesOnly };
}

function normalizeSetName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// In-memory cache: which prices belong to which productId.
function indexPricesByProduct(prices: Price[]): Map<number, Price[]> {
  const m = new Map<number, Price[]>();
  for (const p of prices) {
    const arr = m.get(p.productId) ?? [];
    arr.push(p);
    m.set(p.productId, arr);
  }
  return m;
}

// PRICE-ONLY path: match TCGCSV product → existing card by (set_id,
// card_number). We accept ambiguous matches (same name appearing in
// multiple sets) by scoping to one set at a time.
async function priceOnlyForGroup(
  supabase: SupabaseClient,
  brandId: string,
  group: Group,
  products: Product[],
  pricesByProduct: Map<number, Price[]>,
): Promise<{ matched: number; updated: number }> {
  // Match TCGCSV group → our set in this priority:
  //   1. abbreviation (group.abbreviation == sets.external_ids.ptcgo_code)
  //   2. our set name appears as a suffix of group.name ("Perfect Order"
  //      ⊆ "ME03: Perfect Order")
  //   3. exact normalized equality
  const { data: sets } = await supabase
    .from('sets')
    .select('id, name, external_ids')
    .eq('brand_id', brandId);

  let setRow:
    | { id: string; name: string; external_ids: Record<string, unknown> | null }
    | undefined;
  const groupNorm = normalizeSetName(group.name);

  if (group.abbreviation) {
    setRow = (sets ?? []).find(
      (s) =>
        (s.external_ids as { ptcgo_code?: string } | null)?.ptcgo_code ===
        group.abbreviation,
    );
  }
  if (!setRow) {
    setRow = (sets ?? []).find((s) => {
      const n = normalizeSetName(s.name);
      return groupNorm === n || groupNorm.endsWith(' ' + n);
    });
  }
  if (!setRow) return { matched: 0, updated: 0 };

  // Pull all cards in that set so we can index by card_number locally.
  const { data: cards } = await supabase
    .from('cards')
    .select('id, card_number')
    .eq('set_id', setRow.id);
  const byNumber = new Map<string, string>();
  for (const c of cards ?? []) {
    if (c.card_number) byNumber.set(c.card_number, c.id);
  }

  const updates: { id: string; price: number }[] = [];
  for (const product of products) {
    const num = getExtended(product, 'Number');
    if (!num) continue;
    // Card numbers in TCGCSV often look "238/091" — split and match prefix.
    const numKey = num.split('/')[0].replace(/^0+/, '') || num;
    const cardId =
      byNumber.get(num) ??
      byNumber.get(numKey) ??
      byNumber.get(num.split('/')[0]);
    if (!cardId) continue;
    const price = bestPrice(pricesByProduct.get(product.productId) ?? []);
    if (price == null) continue;
    updates.push({ id: cardId, price: round2(price) });
  }

  // Bounded-concurrency UPDATEs.
  let updated = 0;
  const now = new Date().toISOString();
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const slice = updates.slice(i, i + BATCH_SIZE);
    await Promise.all(
      slice.map((u) =>
        supabase
          .from('cards')
          .update({ tcgplayer_market_price: u.price, last_price_check_at: now })
          .eq('id', u.id),
      ),
    );
    updated += slice.length;
  }
  return { matched: updates.length, updated };
}

// FULL-CATALOG path: upsert a set per group, upsert one card per product,
// update prices. source='tcgcsv', source_id=String(groupId/productId).
async function fullCatalogForGroup(
  supabase: SupabaseClient,
  brandId: string,
  group: Group,
  products: Product[],
  pricesByProduct: Map<number, Price[]>,
): Promise<{ setUpserted: number; cardsUpserted: number }> {
  // Upsert set.
  const releaseDate = group.publishedOn ? group.publishedOn.slice(0, 10) : null;
  const { data: existingSet } = await supabase
    .from('sets')
    .select('id, locked_fields')
    .eq('source', 'tcgcsv')
    .eq('source_id', String(group.groupId))
    .maybeSingle();

  let setId: string;
  if (existingSet) {
    setId = existingSet.id;
    const locked = new Set((existingSet.locked_fields ?? []) as string[]);
    const patch: Record<string, unknown> = { last_synced_at: new Date().toISOString() };
    if (!locked.has('name')) patch.name = group.name;
    if (!locked.has('release_date') && releaseDate) patch.release_date = releaseDate;
    await supabase.from('sets').update(patch).eq('id', setId);
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('sets')
      .insert({
        brand_id: brandId,
        name: group.name,
        release_date: releaseDate,
        source: 'tcgcsv',
        source_id: String(group.groupId),
        last_synced_at: new Date().toISOString(),
        external_ids: {
          tcgplayer_group_id: group.groupId,
          abbreviation: group.abbreviation,
        },
      })
      .select('id')
      .single();
    if (insErr) throw insErr;
    setId = inserted!.id;
  }

  // Pull existing cards for this set so we can match by tcgplayer_product_id.
  const { data: existingCards } = await supabase
    .from('cards')
    .select('id, external_ids')
    .eq('set_id', setId);
  const productIdToCardId = new Map<string, string>();
  for (const row of existingCards ?? []) {
    const pid = (row.external_ids as { tcgplayer_product_id?: number } | null)
      ?.tcgplayer_product_id;
    if (pid != null) productIdToCardId.set(String(pid), row.id);
  }

  let cardsUpserted = 0;
  // Process in batches, mixing inserts and updates.
  const inserts: Record<string, unknown>[] = [];
  const updates: { id: string; patch: Record<string, unknown> }[] = [];
  const now = new Date().toISOString();

  for (const product of products) {
    const sealed = isSealedProduct(product);
    const number = getExtended(product, 'Number');
    const rarity = getExtended(product, 'Rarity');
    const price = bestPrice(pricesByProduct.get(product.productId) ?? []);
    const existingCardId = productIdToCardId.get(String(product.productId));

    if (existingCardId) {
      const patch: Record<string, unknown> = { updated_at: now };
      if (price != null) {
        patch.tcgplayer_market_price = round2(price);
        patch.last_price_check_at = now;
      }
      updates.push({ id: existingCardId, patch });
    } else {
      inserts.push({
        set_id: setId,
        brand_id: brandId,
        category: 'tcg',
        name: product.name,
        card_number: number,
        rarity,
        is_sealed: sealed,
        image_url: product.imageUrl ?? null,
        external_ids: { tcgplayer_product_id: product.productId },
        tcgplayer_market_price: price != null ? round2(price) : null,
        last_price_check_at: price != null ? now : null,
      });
    }
  }

  // Insert in chunks.
  for (let i = 0; i < inserts.length; i += 100) {
    const chunk = inserts.slice(i, i + 100);
    const { error } = await supabase.from('cards').insert(chunk);
    if (error) {
      console.warn(`insert batch failed: ${error.message}`);
      continue;
    }
    cardsUpserted += chunk.length;
  }

  // Update with bounded concurrency.
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const slice = updates.slice(i, i + BATCH_SIZE);
    await Promise.all(
      slice.map((u) =>
        supabase.from('cards').update(u.patch).eq('id', u.id),
      ),
    );
    cardsUpserted += slice.length;
  }

  return { setUpserted: 1, cardsUpserted };
}

async function processBrand(
  supabase: SupabaseClient,
  brandId: string,
  pricesOnlyForce: boolean,
) {
  const candidateNames = BRAND_CATEGORIES[brandId];
  if (!candidateNames) {
    console.warn(`No TCGCSV category mapping for brand "${brandId}"`);
    return;
  }
  const pricesOnly = pricesOnlyForce || PRICE_ONLY_BRANDS.has(brandId);

  console.log(`> Resolving categories for brand=${brandId}`);
  const categories = await resolveCategoriesForBrand(supabase, brandId, candidateNames);
  console.log(`  ${categories.length} categories: ${categories.map((c) => c.name).join(', ')}`);

  for (const cat of categories) {
    console.log(`> [${brandId}/${cat.name}] groups`);
    const groups = await fetchGroups(cat.categoryId);
    console.log(`  ${groups.length} groups`);

    let totalSets = 0;
    let totalCards = 0;
    let totalPrices = 0;
    let groupsProcessed = 0;

    for (const group of groups) {
      groupsProcessed++;
      try {
        const [products, prices] = await Promise.all([
          fetchProducts(cat.categoryId, group.groupId),
          fetchPrices(cat.categoryId, group.groupId),
        ]);
        const pricesByProduct = indexPricesByProduct(prices);

        if (pricesOnly) {
          const { matched, updated } = await priceOnlyForGroup(
            supabase,
            brandId,
            group,
            products,
            pricesByProduct,
          );
          totalPrices += updated;
          if (updated > 0) {
            console.log(
              `    ${group.name.padEnd(38)} ${products.length.toString().padStart(4)} prod, ${matched} matched, ${updated} priced`,
            );
          }
        } else {
          const { setUpserted, cardsUpserted } = await fullCatalogForGroup(
            supabase,
            brandId,
            group,
            products,
            pricesByProduct,
          );
          totalSets += setUpserted;
          totalCards += cardsUpserted;
          console.log(
            `    ${group.name.padEnd(38)} ${products.length.toString().padStart(4)} prod, +${cardsUpserted} cards`,
          );
        }
      } catch (err) {
        console.warn(`    ! ${group.name}: ${(err as Error).message}`);
      }
    }
    console.log(
      `  [${brandId}/${cat.name}] ${groupsProcessed} groups; sets +${totalSets}, cards +${totalCards}, prices ${totalPrices}`,
    );
  }
}

async function main() {
  const supabase = adminClient();
  const { brand, pricesOnly } = parseArgs(process.argv.slice(2));

  if (brand) {
    await processBrand(supabase, brand, pricesOnly);
  } else {
    for (const b of Object.keys(BRAND_CATEGORIES)) {
      await processBrand(supabase, b, false);
    }
  }
  console.log('\n> Done.');
}

main().catch(async (err) => {
  console.error('\nTCGCSV refresh failed:', err.message ?? err);
  captureException(err, { script: 'import-tcgcsv' });
  await flushSentry();
  process.exit(1);
});
