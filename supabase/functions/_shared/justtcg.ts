// JustTCG API client. Powers the Trending tab's price-momentum signal.
//
// JustTCG returns CURRENT PRICE ONLY — no sales volume, no historical
// trend. Price momentum is computed by US from snapshots taken over time
// (see fetch-justtcg + compute-trending). This client is just the
// transport layer.
//
// Modeled on _shared/ebay.ts: without JUSTTCG_API_KEY the helper is in
// dev mode — every network call throws JustTcgKeyMissingError so callers
// short-circuit to a 412 feature-flag response. No network calls made.
//
// Endpoints (base https://api.justtcg.com/v1, auth header x-api-key):
//   GET  /games   — list of supported games
//   GET  /sets    — sets, filterable by game
//   POST /cards   — BATCH card lookup, up to 200 cards/request
//   GET  /cards   — single card lookup (not used here; batch covers it)
//
// Free-tier rate limits: 1,000 requests/month, 100/day, 10/min. The
// daily ceiling is enforced by callers (fetch-justtcg counts today's
// calls in api_request_log). This client handles the per-minute limit:
// HTTP 429 → throw JustTcgRateLimitedError so the caller backs off and
// STOPS the run cleanly rather than hammering the API.

const API_KEY = Deno.env.get('JUSTTCG_API_KEY');

export const JUSTTCG_KEY_PRESENT = Boolean(API_KEY);

const BASE_URL = 'https://api.justtcg.com/v1';

// Batch size for POST /cards. The API accepts up to 200, but we default
// conservative at 20 — the free tier is only 1,000 calls/month, so
// smaller batches give finer-grained budget control and a gentler
// blast radius if a single request fails. Bump toward 200 only if the
// monthly budget comfortably allows it.
export const JUSTTCG_BATCH_SIZE = 20;

export class JustTcgKeyMissingError extends Error {
  constructor() {
    super('JUSTTCG_API_KEY is not set in the Edge Function env');
    this.name = 'JustTcgKeyMissingError';
  }
}

export class JustTcgRateLimitedError extends Error {
  constructor(public retryAfterMs: number) {
    super(`JustTCG rate limited; retry after ${retryAfterMs}ms`);
    this.name = 'JustTcgRateLimitedError';
  }
}

// ---------------------------------------------------------------------------
// Response shapes (per the official JustTCG docs).
// Every response is { data, meta, _metadata }.
// ---------------------------------------------------------------------------

export type JustTcgVariant = {
  id: string;
  printing: string | null;
  condition: string | null;
  price: number;
  lastUpdated: number; // unix timestamp (seconds)
};

export type JustTcgCard = {
  id: string;
  name: string;
  game: string;
  set: string;
  set_name: string;
  number: string | null;
  tcgplayerId: string | null;
  mtgjsonId: string | null;
  scryfallId: string | null;
  rarity: string | null;
  details: string | null;
  variants: JustTcgVariant[];
};

export type JustTcgGame = { id: string; name: string };
export type JustTcgSet = { id: string; name: string; game: string };

type JustTcgEnvelope<T> = { data: T; meta?: unknown; _metadata?: unknown };

// ---------------------------------------------------------------------------
// Internal request helper. Adds the x-api-key header, maps 429 → typed
// rate-limit error so callers can stop the run cleanly.
// ---------------------------------------------------------------------------

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<JustTcgEnvelope<T>> {
  if (!API_KEY) throw new JustTcgKeyMissingError();

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'x-api-key': API_KEY,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 429) {
    // Free tier resets the minute-limit after 60s. Honor Retry-After if
    // present, otherwise assume a full minute.
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '60', 10);
    throw new JustTcgRateLimitedError(
      (Number.isFinite(retryAfter) ? retryAfter : 60) * 1000,
    );
  }
  if (!res.ok) {
    throw new Error(`JustTCG ${path} ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as JustTcgEnvelope<T>;
}

// ---------------------------------------------------------------------------
// Public API. Each network call counts as ONE request against the free
// tier — callers must budget accordingly.
// ---------------------------------------------------------------------------

// GET /games — supported games. One request.
export async function getGames(): Promise<JustTcgGame[]> {
  const env = await request<JustTcgGame[]>('/games');
  return env.data ?? [];
}

// GET /sets — sets, optionally filtered by game id. One request.
export async function getSets(game?: string): Promise<JustTcgSet[]> {
  const qs = game ? `?game=${encodeURIComponent(game)}` : '';
  const env = await request<JustTcgSet[]>(`/sets${qs}`);
  return env.data ?? [];
}

// A single identifier in a POST /cards batch query. JustTCG matches on
// whichever identifier is provided — tcgplayerId is the most reliable
// for our catalog (tcgcsv-imported cards carry it).
export type CardQuery =
  | { tcgplayerId: string }
  | { cardId: string }
  | { game: string; set: string; number: string };

// POST /cards — BATCH card lookup. `queries` must be <= 200 entries
// (caller should chunk by JUSTTCG_BATCH_SIZE). One request regardless of
// batch size. Returns the matched cards with their current-price
// variants; unmatched queries are simply absent from the response.
//
// REQUEST BODY SHAPE — UNVERIFIED. The body below is sent as
// { cards: [...] }. This is the ASSUMED/EXPECTED shape; it has NOT been
// confirmed against the live JustTCG API. Confirm against a real
// response before the first production run and adjust if JustTCG
// expects a different key/structure.
export async function getCardsBatch(
  queries: CardQuery[],
): Promise<JustTcgCard[]> {
  if (queries.length === 0) return [];
  if (queries.length > 200) {
    throw new Error(
      `getCardsBatch: ${queries.length} queries exceeds the 200-card API limit`,
    );
  }
  const env = await request<JustTcgCard[]>('/cards', {
    method: 'POST',
    // TODO: verify POST /cards request body shape ({ cards: [...] }) against the live JustTCG API before first production run.
    body: JSON.stringify({ cards: queries }),
  });
  return env.data ?? [];
}
