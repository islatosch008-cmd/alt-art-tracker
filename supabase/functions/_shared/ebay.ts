// eBay client. Two endpoint families:
//
//   Browse API (always available with basic creds):
//     /buy/browse/v1/item_summary/search
//     ACTIVE listings only — useful as a "current asking price" signal
//     and (rough) volume proxy.
//
//   Marketplace Insights API (RESTRICTED — separate eBay approval):
//     /buy/marketplace_insights/v1_beta/item_sales/search
//     Recently SOLD listings — the real signal we want for price_history
//     and volume_history. eBay restricts this to approved partners; flag
//     EBAY_USE_MARKETPLACE_INSIGHTS=true once approval lands.
//
// Without EBAY_CLIENT_ID + EBAY_CLIENT_SECRET, helper is in dev mode:
// every call throws EbayKeyMissingError so callers can short-circuit
// to a 412 feature-flag response. No network calls made.

const CLIENT_ID = Deno.env.get('EBAY_CLIENT_ID');
const CLIENT_SECRET = Deno.env.get('EBAY_CLIENT_SECRET');
const USE_INSIGHTS = Deno.env.get('EBAY_USE_MARKETPLACE_INSIGHTS') === 'true';

export const EBAY_KEYS_PRESENT = Boolean(CLIENT_ID && CLIENT_SECRET);
export const EBAY_USES_INSIGHTS = USE_INSIGHTS;

const OAUTH_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';
const INSIGHTS_URL =
  'https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search';

const SCOPE_BROWSE = 'https://api.ebay.com/oauth/api_scope';
const SCOPE_INSIGHTS = 'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights';

export class EbayKeyMissingError extends Error {
  constructor() {
    super('EBAY_CLIENT_ID and/or EBAY_CLIENT_SECRET not set in env');
    this.name = 'EbayKeyMissingError';
  }
}

export class EbayRateLimitedError extends Error {
  constructor(public retryAfterMs: number) {
    super(`eBay rate limited; retry after ${retryAfterMs}ms`);
    this.name = 'EbayRateLimitedError';
  }
}

let cachedToken: { value: string; expiresAt: number; scope: string } | null = null;

async function fetchToken(scope: string): Promise<string> {
  if (!CLIENT_ID || !CLIENT_SECRET) throw new EbayKeyMissingError();

  // Cache for 90% of expires_in (eBay tokens default 2h). Re-use if scope
  // matches; force re-fetch on scope change so we don't pass the wrong one.
  if (
    cachedToken &&
    cachedToken.scope === scope &&
    cachedToken.expiresAt > Date.now() + 60_000
  ) {
    return cachedToken.value;
  }

  const auth = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay OAuth ${res.status}: ${text}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000 * 0.9,
    scope,
  };
  return cachedToken.value;
}

export type ActiveItem = {
  itemId: string;
  title: string;
  price: { value: string; currency: string };
  itemWebUrl: string;
  condition?: string;
};

// Hit Browse API for active listings matching `q`. Returns up to `limit`
// (eBay max 200). Throws EbayKeyMissingError if creds aren't set.
export async function searchActive(
  q: string,
  limit = 50,
): Promise<ActiveItem[]> {
  const token = await fetchToken(SCOPE_BROWSE);
  const params = new URLSearchParams({
    q,
    limit: String(Math.min(limit, 200)),
    filter: 'buyingOptions:{FIXED_PRICE}',
    sort: 'price',
  });
  const res = await fetch(`${BROWSE_URL}?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10);
    throw new EbayRateLimitedError(retryAfter * 1000);
  }
  if (!res.ok) {
    throw new Error(`Browse API ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { itemSummaries?: ActiveItem[] };
  return json.itemSummaries ?? [];
}

export type SoldItem = {
  itemId: string;
  title: string;
  lastSoldPrice: { value: string; currency: string };
  lastSoldDate: string; // ISO timestamp
  condition?: string;
};

// Hit Marketplace Insights for SOLD listings. Requires the use-insights
// env flag AND eBay approval for the insights scope. Throws if not enabled.
export async function searchSold(q: string, limit = 50): Promise<SoldItem[]> {
  if (!USE_INSIGHTS) {
    throw new Error(
      'Marketplace Insights API not enabled (EBAY_USE_MARKETPLACE_INSIGHTS != "true")',
    );
  }
  const token = await fetchToken(SCOPE_INSIGHTS);
  const params = new URLSearchParams({
    q,
    limit: String(Math.min(limit, 200)),
  });
  const res = await fetch(`${INSIGHTS_URL}?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10);
    throw new EbayRateLimitedError(retryAfter * 1000);
  }
  if (!res.ok) {
    throw new Error(`Marketplace Insights ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { itemSales?: SoldItem[] };
  return json.itemSales ?? [];
}

// Median of an array of numbers. Returns null on empty input.
export function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

// Build the search query for a card: name + set + card_number narrows the
// result set. "pokemon" / category appended would help but eBay's categoryId
// filtering requires another lookup; query string is good enough for v1.
export function buildSearchQuery(args: {
  name: string;
  setName?: string | null;
  cardNumber?: string | null;
  brand?: string | null;
}): string {
  const parts = [args.name];
  if (args.setName) parts.push(args.setName);
  if (args.cardNumber) parts.push(`#${args.cardNumber}`);
  return parts.join(' ');
}
