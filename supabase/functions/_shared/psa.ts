// PSA Public API client.
//
// Auth: bearer token in Authorization header.
// Base URL: https://api.psacard.com/publicapi
// Rate limit: PSA enforces a daily quota — exact number depends on tier.
// We treat 429 as a hard signal to back off and surface as a failure.
//
// Without PSA_API_TOKEN, every call throws PsaTokenMissingError so callers
// can short-circuit to a 412 feature-flag response.
//
// Endpoint URLs are TBD: the Public API surface differs by tier. The
// scrapers below treat each endpoint as a first-class function so when we
// confirm the actual paths via field test, only one place needs editing.

const TOKEN = Deno.env.get('PSA_API_TOKEN');
export const PSA_TOKEN_PRESENT = Boolean(TOKEN);

const BASE_URL = 'https://api.psacard.com/publicapi';

export class PsaTokenMissingError extends Error {
  constructor() {
    super('PSA_API_TOKEN not set in env');
    this.name = 'PsaTokenMissingError';
  }
}

export class PsaRateLimitedError extends Error {
  constructor(public retryAfterMs: number) {
    super(`PSA rate limited; retry after ${retryAfterMs}ms`);
    this.name = 'PsaRateLimitedError';
  }
}

// Generic GET to any PSA Public API path. `path` includes leading slash.
// Returns parsed JSON; throws on non-2xx.
export async function fetchPsa<T>(path: string): Promise<T> {
  if (!TOKEN) throw new PsaTokenMissingError();
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/json',
    },
  });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10);
    throw new PsaRateLimitedError(retryAfter * 1000);
  }
  if (!res.ok) {
    throw new Error(`PSA API ${res.status} on ${path}: ${await res.text()}`);
  }
  return (await res.json()) as T;
}

// --- Endpoint helpers (URL paths confirmed live in scrape-* functions
// below; tweak there until validated) -------------------------------

export type PopReportRow = {
  grade: string;
  count: number;
};

// Get pop report for a PSA spec. URL path TBD — most likely:
//   GET /pop/GetPSASpecPopulation/{specId}
//   GET /pop/GetSpecPopulationBySpecID/{specId}
// First field test will confirm. Returns rows of (grade, count).
export async function getPopReport(specId: string): Promise<PopReportRow[]> {
  // TODO: confirm path against PSA Public API docs once Ian validates
  const data = await fetchPsa<{ PSAPopulation?: PopReportRow[] }>(
    `/pop/GetPSASpecPopulation/${encodeURIComponent(specId)}`,
  );
  return data.PSAPopulation ?? [];
}

export type GradedSaleRow = {
  certNumber: string;
  grade: string;
  salePrice: number;
  soldAt: string; // ISO
  sourceUrl?: string;
};

// Recent graded sales for a spec. URL path TBD — likely:
//   GET /aprs/GetByPSASpec/{specId}    (Auction Prices Realized)
// Returns up to N most-recent sales.
export async function getRecentSales(specId: string): Promise<GradedSaleRow[]> {
  // TODO: confirm path against PSA Public API docs once Ian validates
  const data = await fetchPsa<{ Sales?: GradedSaleRow[] }>(
    `/aprs/GetByPSASpec/${encodeURIComponent(specId)}`,
  );
  return data.Sales ?? [];
}
