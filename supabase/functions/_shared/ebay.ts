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

export const SCOPE_BROWSE = 'https://api.ebay.com/oauth/api_scope';
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

// Module-level OAuth token cache. Persists across function invocations
// while the Edge Function instance stays warm — eBay's client_credentials
// grant has a SEPARATE 1,000 mints/24h rate limit, so per-request token
// minting would burn it fast. Tokens TTL 7,200s (2h); we cache for 90%
// of that with a 60s safety buffer.
let cachedToken: { value: string; expiresAt: number; scope: string } | null = null;

// Force the next fetchToken() call to mint a fresh token. Callers should
// invoke this when an eBay endpoint returns 401 — typically means our
// cached token was rotated out (rare, but possible during incident
// recovery). Don't call on 4xx other than 401 — those are about the
// request, not the token.
export function invalidateTokenCache(): void {
  cachedToken = null;
}

export async function fetchToken(scope: string): Promise<string> {
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

// TODO P10: wire eBay Developer Analytics getRateLimits endpoint into
// /admin/scrapers dashboard for real-time quota visibility. Endpoint:
// https://api.ebay.com/developer/analytics/v1_beta/rate_limit/
//
// Confirmed 2026-05-09: Browse API responses do NOT carry rate-limit
// headers. Probed a real /item_summary/search response and the only
// non-standard headers were rlogid, x-ebay-svc-tracking-data, and
// x-ebay-pop-id (load-balancer / tracking metadata). No
// X-EBAY-C-RATELIMIT-*, no X-Quota-*, no Retry-After. Confirms the
// only path to quota visibility is the getRateLimits Analytics
// endpoint (P10 above).

export type ActiveItem = {
  itemId: string;
  title: string;
  price: { value: string; currency: string };
  itemWebUrl: string;
  condition?: string;
};

export type ActiveSearchResult = {
  items: ActiveItem[];
  // eBay's `total` field — the COUNT of active listings matching the
  // query, not the COUNT of items returned. We use this as the supply
  // signal for compute-heating-up-scores (fewer total = scarcer supply).
  total: number;
};

export type ActiveSearchOptions = {
  // Optional eBay categoryId filter. e.g. '183454' = Trading Card Singles
  // (under Collectible Card Games). Narrows results to single-card
  // listings, excludes boxes/lots/sealed product.
  categoryIds?: string[];
  // Optional conditionId filter. e.g. '2750' = Graded. Restricts to
  // graded slabs which are more price-comparable across sellers.
  conditionIds?: string[];
};

// Hit Browse API for active listings matching `q`. Returns items + total
// (eBay's match count, separate from page size). Throws EbayKeyMissingError
// if creds aren't set; throws EbayRateLimitedError on 429.
//
// Default sort is price ASC so items[0] is the lowest-priced match.
export async function searchActive(
  q: string,
  limit = 50,
  options: ActiveSearchOptions = {},
): Promise<ActiveSearchResult> {
  const token = await fetchToken(SCOPE_BROWSE);
  const params = new URLSearchParams({
    q,
    limit: String(Math.min(limit, 200)),
    sort: 'price', // ASC — lowest first
  });
  // eBay's filter param is a single string with comma-separated clauses.
  const filterClauses: string[] = [];
  if (options.conditionIds?.length) {
    filterClauses.push(`conditionIds:{${options.conditionIds.join('|')}}`);
  }
  if (filterClauses.length > 0) params.set('filter', filterClauses.join(','));
  if (options.categoryIds?.length) {
    params.set('category_ids', options.categoryIds.join(','));
  }

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
  const json = (await res.json()) as {
    total?: number;
    itemSummaries?: ActiveItem[];
  };
  return {
    items: json.itemSummaries ?? [],
    total: json.total ?? 0,
  };
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
