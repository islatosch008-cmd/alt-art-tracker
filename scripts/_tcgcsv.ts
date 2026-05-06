// TCGCSV client. JSON endpoints (no .csv suffix despite the name); the
// project republishes TCGplayer's catalog + prices daily. Free, no auth.
// https://tcgcsv.com/

import type { SupabaseClient } from '@supabase/supabase-js';

const BASE = 'https://tcgcsv.com/tcgplayer';
const HEADERS = {
  'User-Agent': 'AltArtTracker/0.1.0 (contact: hello@altarttracker.com)',
};
const REVERIFY_DAYS = 7;

export type Category = { categoryId: number; name: string };

export type Group = {
  groupId: number;
  name: string;
  abbreviation: string | null;
  isSupplemental: boolean;
  publishedOn: string | null; // ISO date
  modifiedOn: string;
  categoryId: number;
};

export type ExtendedDataItem = {
  displayName: string;
  name: string;
  value: string;
};

export type Product = {
  productId: number;
  name: string;
  cleanName?: string;
  imageUrl?: string;
  categoryId: number;
  groupId: number;
  url?: string;
  modifiedOn: string;
  imageCount?: number;
  presaleInfo?: { isPresale: boolean; note?: string; releasedOn?: string | null };
  extendedData?: ExtendedDataItem[];
};

export type Price = {
  productId: number;
  subTypeName: string; // 'Holofoil' | 'Reverse Holofoil' | 'Normal' | …
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  marketPrice: number | null;
  directLowPrice: number | null;
};

type Envelope<T> = { totalItems?: number; success?: boolean; errors?: unknown[]; results: T[] };

async function fetchJson<T>(path: string): Promise<T[]> {
  const res = await fetch(`${BASE}/${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`TCGCSV ${path} ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as Envelope<T>;
  return json.results ?? [];
}

export const fetchCategories = () => fetchJson<Category>('categories');
export const fetchGroups = (categoryId: number) => fetchJson<Group>(`${categoryId}/groups`);
export const fetchProducts = (categoryId: number, groupId: number) =>
  fetchJson<Product>(`${categoryId}/${groupId}/products`);
export const fetchPrices = (categoryId: number, groupId: number) =>
  fetchJson<Price>(`${categoryId}/${groupId}/prices`);

// Case-insensitive substring match. The Ian-spec is "look up by category name"
// — exact equality is too brittle (TCGplayer adds/edits suffixes), substring
// is forgiving.
export function findCategoryByName(
  categories: Category[],
  needle: string,
): Category | null {
  const lower = needle.toLowerCase();
  return (
    categories.find((c) => c.name.toLowerCase() === lower) ??
    categories.find((c) => c.name.toLowerCase().includes(lower)) ??
    null
  );
}

// Resolve TCGCSV categories for one of our brand IDs, using the
// tcgcsv_category_map cache. Re-verifies from /categories if any cached
// row is older than REVERIFY_DAYS (defaults to weekly).
export async function resolveCategoriesForBrand(
  supabase: SupabaseClient,
  brandId: string,
  candidateNames: string[],
): Promise<Category[]> {
  const { data: cached } = await supabase
    .from('tcgcsv_category_map')
    .select('category_id, category_name, resolved_at')
    .eq('brand_id', brandId);

  const now = Date.now();
  const allFresh =
    cached &&
    cached.length === candidateNames.length &&
    cached.every(
      (r) =>
        r.resolved_at &&
        now - new Date(r.resolved_at).getTime() < REVERIFY_DAYS * 86_400_000,
    );

  if (allFresh) {
    return cached.map((r) => ({ categoryId: r.category_id, name: r.category_name }));
  }

  console.log(`  cache stale or missing for ${brandId} — refetching /categories`);
  const all = await fetchCategories();
  const resolved: Category[] = [];
  for (const name of candidateNames) {
    const cat = findCategoryByName(all, name);
    if (!cat) {
      console.warn(`  ! no TCGCSV category match for "${name}"`);
      continue;
    }
    resolved.push(cat);
    await supabase.from('tcgcsv_category_map').upsert(
      {
        brand_id: brandId,
        category_id: cat.categoryId,
        category_name: cat.name,
        resolved_at: new Date().toISOString(),
      },
      { onConflict: 'brand_id,category_id' },
    );
  }
  return resolved;
}

// Pick the most-representative market price from a product's variant rows.
// Foil variants prioritize over normal because they're what most collectors
// price-track; market preferred over mid; mid preferred over nothing.
const VARIANT_ORDER = [
  'Holofoil',
  'Reverse Holofoil',
  '1st Edition Holofoil',
  'Unlimited Holofoil',
  'Normal',
  '1st Edition',
  'Unlimited',
];

export function bestPrice(rows: Price[]): number | null {
  for (const variant of VARIANT_ORDER) {
    const r = rows.find((p) => p.subTypeName === variant);
    if (!r) continue;
    if (r.marketPrice && r.marketPrice > 0) return r.marketPrice;
    if (r.midPrice && r.midPrice > 0) return r.midPrice;
  }
  // Fallback: any usable price.
  for (const r of rows) {
    if (r.marketPrice && r.marketPrice > 0) return r.marketPrice;
    if (r.midPrice && r.midPrice > 0) return r.midPrice;
  }
  return null;
}

// Pull a named field out of a product's extendedData array.
// extendedData = [{displayName, name, value}, …]
export function getExtended(p: Product, name: string): string | null {
  const row = p.extendedData?.find((e) => e.name === name);
  return row?.value ?? null;
}

export function isSealedProduct(p: Product): boolean {
  // Heuristic: real cards have a Number in extendedData. Sealed product
  // (Booster Box, Elite Trainer Box, Bundle, Tin, etc.) typically don't.
  const num = getExtended(p, 'Number');
  return num == null || num === '';
}
