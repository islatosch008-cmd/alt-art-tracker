// PSA Public API client.
//
// Auth: bearer token in Authorization header.
// Base URL: https://api.psacard.com/publicapi
// Rate limit: PSA enforces a daily quota — exact number depends on tier.
//   Quota is NOT exposed in response headers (verified via psa-probe.ts
//   on 2026-05-08 — no x-ratelimit-*, x-quota-*, or retry-after headers
//   present on 200 responses). Quota observation is via PSA's developer
//   dashboard. We treat 429 as a hard signal to back off via the
//   PsaRateLimitedError exception.
//
// Without PSA_API_TOKEN, every call throws PsaTokenMissingError so callers
// can short-circuit to a 412 feature-flag response.
//
// Endpoint validation status (confirmed via scripts/psa-probe.ts):
//   - /pop/GetPSASpecPopulation/{specID}  ✅ 200 — pop report (this file)
//        Verified end-to-end on 2026-05-08:
//          probe → corrections → scrape-psa-pop-reports against prod →
//          10 rows in psa_pop_reports matching PSA's raw response
//          exactly (Total=100 across grades 1–10). 1 quota unit per card.
//   - recent sales (APRs)                  ❓ unknown — every candidate
//                                             path probed returned 404.
//                                             May be a separate-tier API
//                                             not included with this token.
//        scrape-psa-recent-sales short-circuits with 501 + degraded
//        outcome and burns no quota until a canonical path is confirmed.

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

export class PsaEndpointNotValidatedError extends Error {
  constructor(endpointName: string) {
    super(
      `${endpointName} endpoint path not validated against PSA Public API. ` +
        `Run scripts/psa-probe.ts to confirm the canonical path before invoking.`,
    );
    this.name = 'PsaEndpointNotValidatedError';
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

// --- Pop reports -------------------------------------------------------

// Raw response shape from /pop/GetPSASpecPopulation/{specID}.
// Confirmed against spec_id 8105805 on 2026-05-08:
//   {
//     "SpecID": 8105805,
//     "Description": "1996 AMADA POKEMON ...",
//     "PSAPop": {
//       "Total": 100, "Auth": 0,
//       "Grade1": 1, "Grade1Q": 0,
//       "Grade1_5": 0, "Grade1_5Q": 0,
//       "Grade2": 1, "Grade2Q": 0,
//       ...
//       "Grade10": 1
//     }
//   }
//
// Numeric grades use "Grade{N}" or "Grade{N}_5" (half grades). Qualifier
// variants append "Q" (e.g. "Grade8Q"). Total is a sum; Auth is "graded
// authentic, no quality grade". Zero-count grades are present in the
// response — we filter to non-zero rows in normalizePop().
export type PSAPopResponse = {
  SpecID: number;
  Description: string;
  PSAPop: Record<string, number>;
};

// Output shape for downstream storage (psa_pop_reports.grade is text).
export type PopReportRow = {
  grade: string; // e.g. "10", "9", "8.5", "8Q", "Auth"
  count: number;
};

// Convert a flat PSAPop key like "Grade8" / "Grade8_5" / "Grade8Q" /
// "Grade8_5Q" / "Auth" into the human-readable grade label that gets
// stored in psa_pop_reports.grade. Returns null for "Total" (a sum) and
// any unrecognized key.
function popKeyToGrade(key: string): string | null {
  if (key === 'Total') return null;
  if (key === 'Auth') return 'Auth';
  // Grade<N> | Grade<N>Q | Grade<N>_5 | Grade<N>_5Q
  const m = key.match(/^Grade(\d+)(_5)?(Q)?$/);
  if (!m) return null;
  const whole = m[1];
  const half = m[2] ? '.5' : '';
  const qualifier = m[3] ?? '';
  return `${whole}${half}${qualifier}`;
}

// Flatten a raw PSA pop response into [{grade, count}, ...] rows, dropping
// zero-count grades and the "Total" sum.
export function normalizePop(raw: PSAPopResponse): PopReportRow[] {
  const rows: PopReportRow[] = [];
  for (const [key, count] of Object.entries(raw.PSAPop ?? {})) {
    if (typeof count !== 'number' || count <= 0) continue;
    const grade = popKeyToGrade(key);
    if (grade === null) continue;
    rows.push({ grade, count });
  }
  return rows;
}

// Get pop report for a PSA spec. Returns one row per non-zero grade.
// Throws PsaTokenMissingError | PsaRateLimitedError | Error per fetchPsa.
export async function getPopReport(specId: string): Promise<PopReportRow[]> {
  const data = await fetchPsa<PSAPopResponse>(
    `/pop/GetPSASpecPopulation/${encodeURIComponent(specId)}`,
  );
  return normalizePop(data);
}

// --- Recent graded sales (APRs) ---------------------------------------
// Endpoint path is unknown — every candidate probed on 2026-05-08
// returned 404 (see scripts/psa-probe.ts output). PSA's Auction Prices
// Realized data may live behind a separate API tier. Until we confirm
// the canonical path, this throws so the scraper degrades cleanly.

export type GradedSaleRow = {
  certNumber: string;
  grade: string;
  salePrice: number;
  soldAt: string; // ISO
  sourceUrl?: string;
};

export async function getRecentSales(_specId: string): Promise<GradedSaleRow[]> {
  throw new PsaEndpointNotValidatedError('Recent graded sales');
}
