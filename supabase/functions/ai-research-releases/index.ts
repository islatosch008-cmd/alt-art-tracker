// Biweekly AI research agent. Asks Claude (with web_search) to find upcoming
// card releases — across BOTH trading card games (TCG) AND sports cards —
// in the next ~90 days, validates the JSON, and inserts new rows into `sets`
// directly with source='ai_research'.
//
// Per spec (2.0 rebuild — Phase 3, widened to TCG + sports):
// - Runs on the cron schedule defined in a migration.
// - Model: claude-sonnet-4-5 (via ANTHROPIC_MODEL env)
// - Tool: web_search_20250305 (Anthropic built-in)
// - Confidence: high=2+ sources agree, medium=single source, low=inferred
// - Skip already-released items (forward mode)
// - Coverage: BOTH TCG and sports cards. TCG is the priority (the bigger
//   earner) and gets slightly deeper coverage, but major sports card
//   releases are included too — each vertical has a dedicated partner.
//     TCG:    Pokemon, Magic, Bandai TCGs (One Piece / Dragon Ball / Digimon
//             / Union Arena / Gundam).
//     Sports: Topps, Panini, Bowman, Upper Deck, Donruss, Leaf, Fanatics.
// - Cost cap: $5/run-window. Pre-flight check on api_request_log; exit
//   cleanly with Sentry warning if projected total would exceed.
// - Three-outcome model: success | degraded (0 returned) | failure (API err)
// - Feature flag: ANTHROPIC_API_KEY missing → 412 with clear message,
//   doesn't break other systems.
// - Dedup: exact source_id (re-run) or fuzzy name+date match. On a fuzzy
//   match against an existing row we skip (no duplicate insert); the old
//   set_conflicts per-field disagreement queue was removed in the 2.0 strip.
// - Self-prune: after the insert/refresh pass, deletes ai_research rows whose
//   release_date is already in the past. Clears the ~194 stale v1 sports rows
//   on the next run and keeps the calendar to actionable upcoming releases.
//   Scoped to source='ai_research' AND release_date < today (UTC) so catalog
//   sets (tcgcsv / pokemon_tcg_api) are never touched.

import {
  AnthropicKeyMissingError,
  ANTHROPIC_KEY_PRESENT,
  callMessages,
  computeCost,
  extractJsonBlock,
  finalText,
  MODEL,
  WEB_SEARCH_TOOL,
} from '../_shared/anthropic.ts';
import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import {
  hashSourceId,
  recordOutcome,
  type ScrapeOutcome,
} from '../_shared/scraper.ts';
import { captureWarning, withSentry } from '../_shared/sentry.ts';

const SOURCE = 'ai_research';
// Cost cap for the rolling pre-flight window. The agent now runs monthly
// rather than weekly; the $5 envelope and the rolling-window pre-flight
// still work fine for a once-a-month cadence (a single run is the only
// thing inside the window in practice).
const MONTHLY_COST_CAP_USD = 5;
// Hard-cap pre-flight: the original "skip when spent >= cap" let one over-cap
// run through (we'd permit a $1.20 run at $4.50 spend, ending at $5.70). We
// now skip when spent + estimated >= cap, where estimated tracks observed
// per-run cost (~$1.20 ± in practice). Tune this if the agent's prompt or
// search budget changes the per-run cost materially.
const ESTIMATED_RUN_COST_USD = 1.5;

// Coverage spans BOTH TCG and sports. TCG is listed first and is the
// priority (slightly deeper coverage in the prompt); sports follows.
const TARGET_BRANDS_HUMAN = [
  // --- Trading card games (priority) ---
  'Pokemon TCG',
  'Magic: The Gathering',
  'One Piece Card Game',
  'Dragon Ball Super Card Game / Fusion World',
  'Digimon Card Game',
  'Union Arena',
  'Gundam Card Game',
  // --- Sports cards ---
  'Topps',
  'Panini',
  'Bowman',
  'Upper Deck',
  'Donruss',
  'Leaf',
  'Fanatics',
];

const PREFERRED_SOURCES = [
  // --- TCG sources (priority) ---
  'pokemon.com',
  'pokebeach.com',
  'magic.wizards.com',
  'mtg.wiki',
  'mtg.fandom.com',
  'bandai-tcg-plus.com',
  'onepiece-cardgame.com',
  'dbs-cardgame.com',
  'digimoncard.com',
  'unionarena-tcg.com',
  'gundam-gcg.com',
  // --- Sports card sources ---
  'cardboardconnection.com',
  'cardlines.com',
  'sportscardinvestor.com',
  'beckett.com',
  'blowoutbuzz.com',
];

// Map Claude's "brand" field to our brand_id. Anything else → unmapped → skip
// (the unknown-brand skip in validateAndNormalize keeps us from FK-failing).
//
// TCG:    Pokemon → pokemon, Magic → magic, all Bandai games → bandai.
// Sports: Topps → topps, Panini → panini, Bowman → bowman,
//         Upper Deck → upper_deck, Donruss → donruss, Leaf → leaf,
//         Fanatics → fanatics.
//
// Every brand_id below is already seeded in public.brands:
//   pokemon / bandai / topps           — 20260506042944_seed_brands_and_owner_invite.sql
//   panini / bowman / upper_deck /
//   leaf / fanatics / donruss          — 20260506191322_scraper_infrastructure.sql
//   magic                              — 20260512100000_seed_magic_brand.sql
// No new brand-seed migration is needed.
const BRAND_MAP: Record<string, string> = {
  // --- TCG ---
  pokemon: 'pokemon',
  'pokemon tcg': 'pokemon',
  'pokémon': 'pokemon',
  'pokémon tcg': 'pokemon',
  magic: 'magic',
  'magic: the gathering': 'magic',
  'magic the gathering': 'magic',
  mtg: 'magic',
  // All Bandai-published card games map to brand_id=bandai. Collectors and
  // our catalog treat Bandai as one brand; the specific game lands in the
  // per-release `game` field.
  bandai: 'bandai',
  'one piece': 'bandai',
  'one piece card game': 'bandai',
  'dragon ball': 'bandai',
  'dragon ball super': 'bandai',
  'dragon ball super card game': 'bandai',
  'dragon ball super card game fusion world': 'bandai',
  'fusion world': 'bandai',
  digimon: 'bandai',
  'digimon card game': 'bandai',
  'union arena': 'bandai',
  gundam: 'bandai',
  'gundam card game': 'bandai',
  // --- Sports ---
  topps: 'topps',
  panini: 'panini',
  bowman: 'bowman',
  'upper deck': 'upper_deck',
  upper_deck: 'upper_deck',
  upperdeck: 'upper_deck',
  donruss: 'donruss',
  leaf: 'leaf',
  'leaf trading cards': 'leaf',
  fanatics: 'fanatics',
};

// The category a release belongs to. Stored in the `sets.sport` column
// (free-text) so downstream consumers that read `sport` keep working. For TCG
// this carries the game (pokemon / magic / …); for sports it carries the sport
// (basketball / baseball / football / …). Both verticals share this column.
const ALLOWED_GAMES = new Set([
  // TCG games
  'pokemon',
  'magic',
  'one piece',
  'dragon ball super',
  'digimon',
  'union arena',
  'gundam',
  // Sports
  'basketball',
  'baseball',
  'football',
  'hockey',
  'soccer',
  'racing',
  'wrestling',
  'multi-sport',
  'other',
]);

// Normalize the agent's free-text game/sport label to one of ALLOWED_GAMES.
// TCG game labels resolve first (priority); sports labels resolve next. If the
// label is unrecognized but the release's brand is a sports brand, the caller
// falls back to 'multi-sport' rather than rejecting the row.
function normalizeGame(raw: string): string | null {
  const g = raw.toLowerCase().trim();
  // --- TCG games ---
  if (g.includes('pok')) return 'pokemon';
  if (g.includes('magic') || g === 'mtg') return 'magic';
  if (g.includes('one piece')) return 'one piece';
  if (g.includes('dragon ball') || g.includes('fusion world')) {
    return 'dragon ball super';
  }
  if (g.includes('digimon')) return 'digimon';
  if (g.includes('union arena')) return 'union arena';
  if (g.includes('gundam')) return 'gundam';
  // --- Sports ---
  if (g.includes('basketball') || g.includes('nba')) return 'basketball';
  if (g.includes('baseball') || g.includes('mlb')) return 'baseball';
  if (g.includes('football') || g.includes('nfl')) return 'football';
  if (g.includes('hockey') || g.includes('nhl')) return 'hockey';
  if (g.includes('soccer') || g.includes('futbol') || g.includes('football club')) {
    return 'soccer';
  }
  if (g.includes('racing') || g.includes('f1') || g.includes('formula')) return 'racing';
  if (g.includes('wrestling') || g.includes('wwe') || g.includes('ufc') || g.includes('mma')) {
    return 'wrestling';
  }
  if (g.includes('multi') || g.includes('mixed')) return 'multi-sport';
  if (ALLOWED_GAMES.has(g)) return g;
  return null;
}

// brand_ids that belong to the sports vertical. Used as a fallback so a sports
// release with an unrecognized `game` label still lands as 'multi-sport'
// instead of being dropped on a "bad game" rejection.
const SPORTS_BRAND_IDS = new Set([
  'topps',
  'panini',
  'bowman',
  'upper_deck',
  'donruss',
  'leaf',
  'fanatics',
]);

// Match Claude's enums; box_type 'unknown' becomes null.
const ALLOWED_BOX_TYPES = new Set([
  'booster_box',
  'elite_trainer_box',
  'booster_bundle',
  'starter_deck',
  'structure_deck',
  'collection_box',
  'blister',
  'other',
]);
const ALLOWED_CONFIDENCE = new Set(['high', 'medium', 'low']);

type AgentRelease = {
  name: string;
  brand: string;
  game: string;
  box_type: string;
  release_date: string | null;
  pre_order_opens_at: string | null;
  msrp_box: number | null;
  msrp_pack: number | null;
  confidence: string;
  sources: string[];
};

type ValidatedRelease = AgentRelease & {
  brand_id: string;
  source_id: string;
  game: string;
};

function isYmd(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

async function validateAndNormalize(
  releases: unknown,
): Promise<{ valid: ValidatedRelease[]; rejected: number; reasons: string[] }> {
  if (!Array.isArray(releases)) {
    return { valid: [], rejected: 0, reasons: ['top-level "releases" not an array'] };
  }
  const reasons: string[] = [];
  const valid: ValidatedRelease[] = [];
  for (const raw of releases as AgentRelease[]) {
    if (typeof raw?.name !== 'string' || raw.name.trim().length === 0) {
      reasons.push('missing name');
      continue;
    }
    const brandKey = String(raw.brand ?? '').toLowerCase().trim();
    const brand_id = BRAND_MAP[brandKey];
    if (!brand_id) {
      reasons.push(`unknown brand: ${raw.brand}`);
      continue;
    }
    // Resolve the category. For sports brands, an unrecognized label falls
    // back to 'multi-sport' so we don't drop an otherwise-valid sports release
    // just because the agent labeled the sport oddly.
    let game = normalizeGame(String(raw.game ?? ''));
    if (!game) {
      if (SPORTS_BRAND_IDS.has(brand_id)) {
        game = 'multi-sport';
      } else {
        reasons.push(`bad game: ${raw.game}`);
        continue;
      }
    }
    const release_date = isYmd(raw.release_date) ? raw.release_date : null;
    if (!release_date) {
      // Skip rows without a release_date — agent can return null but we
      // can't compute source_id or schedule release alerts on them.
      reasons.push(`no release_date: ${raw.name}`);
      continue;
    }
    const confidence = String(raw.confidence ?? '').toLowerCase();
    if (!ALLOWED_CONFIDENCE.has(confidence)) {
      reasons.push(`bad confidence: ${raw.confidence}`);
      continue;
    }
    const box_type_raw = String(raw.box_type ?? 'unknown').toLowerCase();
    const box_type = ALLOWED_BOX_TYPES.has(box_type_raw)
      ? box_type_raw === 'unknown'
        ? null
        : box_type_raw
      : null;

    const source_id = await hashSourceId('ai', raw.name.trim(), brand_id, release_date);

    valid.push({
      ...raw,
      box_type: box_type ?? 'unknown',
      brand_id,
      source_id,
      game,
      confidence,
      release_date,
    });
  }
  return { valid, rejected: reasons.length, reasons };
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const FUZZY_DATE_WINDOW_DAYS = 7;

// Find an existing set that this AI release matches: either source_id exact
// match (re-running the agent) OR fuzzy name + within 7 days. Returns the
// matched row + whether it's same-source.
async function findExisting(
  // deno-lint-ignore no-explicit-any
  admin: any,
  rel: ValidatedRelease,
): Promise<{
  row: {
    id: string;
    source: string;
    name: string;
    release_date: string | null;
  } | null;
  matchKind: 'source_id' | 'fuzzy' | null;
}> {
  // 1. Exact source_id match (same source, re-run)
  const { data: bySid } = await admin
    .from('sets')
    .select('id, source, name, release_date')
    .eq('source', SOURCE)
    .eq('source_id', rel.source_id)
    .maybeSingle();
  if (bySid) return { row: bySid, matchKind: 'source_id' };

  // 2. Fuzzy: same brand, name match (normalized), within 7 days of release_date.
  // Pull candidates by brand + ±7d window then filter normalized in JS.
  const lo = new Date(rel.release_date);
  lo.setUTCDate(lo.getUTCDate() - FUZZY_DATE_WINDOW_DAYS);
  const hi = new Date(rel.release_date);
  hi.setUTCDate(hi.getUTCDate() + FUZZY_DATE_WINDOW_DAYS);
  const { data: candidates } = await admin
    .from('sets')
    .select('id, source, name, release_date')
    .eq('brand_id', rel.brand_id)
    .gte('release_date', lo.toISOString().slice(0, 10))
    .lte('release_date', hi.toISOString().slice(0, 10));
  const target = normalizeName(rel.name);
  const fuzzy = (candidates ?? []).find((c) => normalizeName(c.name) === target);
  return { row: fuzzy ?? null, matchKind: fuzzy ? 'fuzzy' : null };
}

type RunOptions = {
  // Inclusive YYYY-MM-DD bounds. Defaults: today → today+90d (forward
  // mode for the monthly cron). Override for catalog backfill.
  date_start?: string;
  date_end?: string;
  // Aim-for entry count for the prompt (lower bound). Defaults to "20-60".
  target_count?: number;
  // Skip the cost-cap pre-flight check. For explicit operator-triggered
  // runs (e.g. catalog backfill); keeps the cron protected.
  bypass_cost_cap?: boolean;
};

function buildPrompts(opts: RunOptions = {}): { system: string; user: string } {
  const today = new Date().toISOString().slice(0, 10);
  const dateStart = opts.date_start ?? today;
  const dateEnd =
    opts.date_end ??
    new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);

  const focusBrands = TARGET_BRANDS_HUMAN.join(', ');

  // Backfill mode: when date_start is in the past, allow released sets.
  const allowReleased = dateStart < today;
  const releaseFilterClause = allowReleased
    ? `Include both upcoming AND already-released sets in the date window — this is a catalog backfill. Do NOT filter out releases that have already shipped.`
    : `Skip releases that have already shipped (release_date < ${today}).`;

  const targetClause = opts.target_count
    ? `Target ${opts.target_count}+ entries. Comprehensive coverage of every game's set/expansion lineup is more valuable than caution — include every distinct release you can confirm. Quality matters but lean toward inclusion when confidence is at least "low".`
    : `Aim for 20–60 entries. Quality over quantity.`;

  const system = `You are a collectible card release researcher covering BOTH trading card games (TCG) AND sports cards.

Your job: find upcoming card releases for these brands: ${focusBrands}.

Two verticals:
- TCG (Pokemon, Magic: The Gathering, and the Bandai games — One Piece, Dragon Ball Super / Fusion World, Digimon, Union Arena, Gundam): collectible card games — find their named expansions, sets, booster series, starter/structure decks, elite trainer boxes, collection boxes, and other sealed product releases.
- Sports cards (Topps, Panini, Bowman, Upper Deck, Donruss, Leaf, Fanatics): find named card products / sets across basketball, baseball, football, hockey, soccer, racing, wrestling, etc. — hobby boxes, blasters, hangers, and other sealed product releases.

PRIORITY — TCG first. TCG is the priority and the bigger focus: give it thorough, slightly-deeper coverage and include every distinct TCG release you can confirm. ALSO include the major sports card releases in the window — do not skip sports — but it's acceptable for sports coverage to be a notch less exhaustive than TCG (focus on the flagship / well-known sports products rather than every regional parallel).

Use the web_search tool to consult, in order of preference:
${PREFERRED_SOURCES.map((s) => `  - ${s}`).join('\n')}
For TCG, the publisher's own site (pokemon.com, magic.wizards.com, bandai-tcg-plus.com and the official One Piece / Dragon Ball Super / Digimon / Union Arena / Gundam card game sites) is a primary source; reputable TCG news (pokebeach.com) and well-maintained wikis (mtg.wiki, mtg.fandom.com) are secondary. For sports, the manufacturer site and reputable sports-card release calendars / news (cardboardconnection.com, cardlines.com, sportscardinvestor.com, beckett.com, blowoutbuzz.com) are the primary sources. Avoid forums, Reddit, eBay, and marketplace listings.

Output discipline:
- Return ONE JSON object only. No prose. No markdown fences. No commentary.
- Top-level shape: { "releases": [ … ] }.
- Each release object MUST have these keys exactly:
    name (string — the set/product name, e.g. "Scarlet & Violet—Prismatic Evolutions" or "2026 Topps Series 1 Baseball"),
    brand (one of: Pokemon TCG, Magic: The Gathering, One Piece Card Game, Dragon Ball Super Card Game, Digimon Card Game, Union Arena, Gundam Card Game, Topps, Panini, Bowman, Upper Deck, Donruss, Leaf, Fanatics, other),
    game (for TCG one of: pokemon, magic, one piece, dragon ball super, digimon, union arena, gundam; for sports the sport, one of: basketball, baseball, football, hockey, soccer, racing, wrestling, multi-sport; or other),
    box_type (one of: booster_box, elite_trainer_box, booster_bundle, starter_deck, structure_deck, collection_box, blister, other, unknown),
    release_date ("YYYY-MM-DD" or null),
    pre_order_opens_at ("YYYY-MM-DD" or null),
    msrp_box (number or null),
    msrp_pack (number or null),
    confidence ("high" | "medium" | "low"),
    sources (array of URLs you actually consulted).
- confidence rules:
    high — 2+ independent sources from the preferred list agree on the date
    medium — single source, or sources disagree by < 7 days
    low — inferred from publisher release patterns (e.g. "Pokemon historically drops a new main set roughly quarterly", "Topps Series 1 Baseball lands early each year")
- ${releaseFilterClause}
- If you can't confirm a release_date with at least low confidence, omit the entry entirely.
- ${targetClause}`;

  const user = `Today is ${today}. Find upcoming card releases — across BOTH trading card games AND sports cards — for ${focusBrands} with release_date between ${dateStart} and ${dateEnd}. Prioritize TCG (deeper coverage), but include the major sports card releases too.

Return only the JSON object. Do not narrate the search process.`;

  return { system, user };
}

async function projectedWindowCost(
  // deno-lint-ignore no-explicit-any
  admin: any,
): Promise<number> {
  // Sum of cost_units stored as numeric USD over the rolling window. Pre-cap
  // is "is sum already >= cap?" — simple guard. Window kept at 7 days; the
  // monthly cadence means a single run is normally the only thing in it.
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data } = await admin
    .from('api_request_log')
    .select('cost_units')
    .eq('source', SOURCE)
    .eq('endpoint', 'success')
    .gte('requested_at', since);
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_units ?? 0), 0);
}

Deno.serve(
  withSentry(SOURCE, async (req) => {
    const pre = preflight(req);
    if (pre) return pre;
    const admin = adminClient();

    // Feature flag: clear error when key missing, doesn't fail loudly to Sentry.
    if (!ANTHROPIC_KEY_PRESENT) {
      return jsonResponse(
        {
          ok: false,
          error: 'ANTHROPIC_API_KEY not set',
          hint: 'Add to supabase/functions/.env and restart functions serve. The agent is fully scaffolded; this is just the feature flag.',
        },
        412, // Precondition Failed
      );
    }

    // Parse optional request body for steerable params. Empty/missing
    // body = default behavior (preserves the monthly cron contract).
    let opts: RunOptions = {};
    if (req.method === 'POST') {
      try {
        const body = (await req.json()) as RunOptions;
        if (body && typeof body === 'object') opts = body;
      } catch {
        // Empty / non-JSON body — cron sends nothing, that's fine.
      }
    }

    // Cost cap pre-flight (hard cap — accounts for projected run cost so we
    // don't authorize a run that would land us over cap). Bypass available
    // for explicit operator-triggered backfill runs; the cron never sets
    // this so the $5 envelope stays intact.
    const spentInWindow = await projectedWindowCost(admin);
    const projected = spentInWindow + ESTIMATED_RUN_COST_USD;
    if (projected >= MONTHLY_COST_CAP_USD && !opts.bypass_cost_cap) {
      captureWarning('cost_cap_exceeded', SOURCE, {
        spent_in_window_usd: spentInWindow,
        estimated_run_cost_usd: ESTIMATED_RUN_COST_USD,
        projected_usd: projected,
        cap_usd: MONTHLY_COST_CAP_USD,
      });
      await admin.from('api_request_log').insert({
        source: SOURCE,
        endpoint: 'cost_cap_exceeded',
        status_code: 200,
        cost_units: 0,
      });
      return jsonResponse({
        ok: true,
        skipped: 'cost_cap_exceeded',
        spent_in_window_usd: spentInWindow,
        estimated_run_cost_usd: ESTIMATED_RUN_COST_USD,
        projected_usd: projected,
        cap_usd: MONTHLY_COST_CAP_USD,
      });
    }

    const { system, user } = buildPrompts(opts);

    // Backfill mode = an explicit past date_start. In that mode the agent is
    // asked for already-released rows, so we must NOT run the past-entry prune
    // (it would delete exactly what was just backfilled). Mirror the same
    // condition buildPrompts uses for its release filter.
    const todayForMode = new Date().toISOString().slice(0, 10);
    const allowReleasedMode = (opts.date_start ?? todayForMode) < todayForMode;

    let response;
    try {
      response = await callMessages({
        system,
        user,
        tools: [WEB_SEARCH_TOOL],
        // 16K tokens fits ~120 release objects (each ~125 tokens). Empirically
        // 8K truncated mid-array on first real run, leaving JSON unparseable.
        maxTokens: 16000,
        temperature: 0,
      });
    } catch (err) {
      if (err instanceof AnthropicKeyMissingError) {
        // Shouldn't reach here (feature flag above), but defense in depth.
        return jsonResponse({ ok: false, error: err.message }, 412);
      }
      const outcome: ScrapeOutcome = {
        kind: 'failure',
        statusCode: 0,
        error: `Anthropic call failed: ${(err as Error).message}`,
      };
      await recordOutcome(admin, SOURCE, outcome);
      return jsonResponse({ ok: false, ...outcome }, 502);
    }

    const cost = computeCost(response.usage);

    // Always log cost (success or degraded) so the next run's pre-flight is accurate.
    const text = extractJsonBlock(finalText(response));

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const outcome: ScrapeOutcome = {
        kind: 'degraded',
        statusCode: 200,
        reason: `JSON parse failed: ${(e as Error).message}`,
        url: 'anthropic',
        html: text.slice(0, 50_000),
      };
      await recordOutcome(admin, SOURCE, outcome);
      // Still record cost so cap math is right.
      await admin.from('api_request_log').insert({
        source: SOURCE,
        endpoint: 'success',
        status_code: 200,
        cost_units: cost,
      });
      return jsonResponse({ ok: true, scraped: 0, reason: 'json_parse_failed', cost_usd: cost });
    }

    const releasesField = (parsed as { releases?: unknown }).releases;
    const { valid, rejected, reasons } = await validateAndNormalize(releasesField);

    if (valid.length === 0) {
      const outcome: ScrapeOutcome = {
        kind: 'degraded',
        statusCode: 200,
        reason: 'no_valid_releases',
        url: 'anthropic',
        html: text.slice(0, 50_000),
      };
      await recordOutcome(admin, SOURCE, outcome);
      await admin.from('api_request_log').insert({
        source: SOURCE,
        endpoint: 'success',
        status_code: 200,
        cost_units: cost,
      });
      return jsonResponse({
        ok: true,
        scraped: 0,
        rejected,
        reasons: reasons.slice(0, 20),
        cost_usd: cost,
        model: MODEL,
        usage: response.usage,
      });
    }

    let inserted = 0;
    let refreshed = 0;
    let skippedExisting = 0;

    const now = new Date().toISOString();
    for (const rel of valid) {
      const { row, matchKind } = await findExisting(admin, rel);

      if (matchKind === 'source_id' && row) {
        // Same source re-run: just refresh last_synced_at (don't overwrite — admin may have edited)
        await admin.from('sets').update({ last_synced_at: now }).eq('id', row.id);
        refreshed++;
        continue;
      }

      if (matchKind === 'fuzzy' && row) {
        // Already covered by another source (e.g. a manual entry). Skip the
        // duplicate insert. The old per-field set_conflicts queue was
        // removed in the 2.0 strip — we no longer record disagreements.
        skippedExisting++;
        continue;
      }

      // No match → insert as a new ai_research row.
      const { error: insErr } = await admin.from('sets').insert({
        brand_id: rel.brand_id,
        name: rel.name,
        // `sport` column carries the category for ai_research rows: the TCG
        // game (pokemon / magic / …) for TCG, or the sport (basketball / …)
        // for sports cards.
        sport: rel.game,
        box_type: rel.box_type === 'unknown' ? null : rel.box_type,
        release_date: rel.release_date,
        pre_order_opens_at: rel.pre_order_opens_at,
        msrp_box: rel.msrp_box,
        msrp_pack: rel.msrp_pack,
        source: SOURCE,
        source_id: rel.source_id,
        confidence: rel.confidence,
        last_synced_at: now,
        external_ids: { sources: rel.sources },
      });
      if (insErr) {
        console.warn(`insert ai_research set failed: ${insErr.message}`);
        continue;
      }
      inserted++;
    }

    await recordOutcome(admin, SOURCE, {
      kind: 'success',
      statusCode: 200,
      scraped: valid.length,
    });
    // Override cost_units on the just-written success row so cost cap math is accurate.
    // (recordOutcome wrote cost_units = scraped count; we want USD.)
    await admin
      .from('api_request_log')
      .update({ cost_units: cost })
      .eq('source', SOURCE)
      .eq('endpoint', 'success')
      .order('requested_at', { ascending: false })
      .limit(1);

    // ------------------------------------------------------------------
    // Self-prune: clear stale past ai_research calendar entries.
    //
    // Scope is deliberately tight: source='ai_research' AND release_date <
    // today (UTC). This removes the ~194 stale v1 sports rows on the next
    // forward run and keeps the calendar to actionable upcoming releases.
    // It never touches catalog sets (source tcgcsv / pokemon_tcg_api / the
    // manufacturer scrapers) — those have a different `source` value.
    //
    // Skipped in backfill mode (date_start in the past) because that mode
    // intentionally inserts already-released rows; pruning there would delete
    // exactly what was just backfilled. The cron path runs forward, so this
    // prunes on every scheduled run.
    //
    // FK cascade safety: deleting a `sets` row cascades to cards,
    // release_alerts_sent, and drop_alerts_sent (set_conflicts was dropped in
    // the v2 strip). ai_research rows are release-calendar entries with no
    // card catalog attached (cards come from catalog sources), so the cards
    // cascade is a no-op. The alert-dedup rows that might cascade only track
    // alerts already sent for a now-past release, so nothing future depends on
    // them. The delete is safe.
    let prunedPast = 0;
    const todayUtc = new Date().toISOString().slice(0, 10);
    if (!allowReleasedMode) {
      const { data: pruned, error: pruneErr } = await admin
        .from('sets')
        .delete()
        .eq('source', SOURCE)
        .lt('release_date', todayUtc)
        .select('id');
      if (pruneErr) {
        console.warn(`prune past ai_research sets failed: ${pruneErr.message}`);
      } else {
        prunedPast = (pruned ?? []).length;
      }
    }

    return jsonResponse({
      ok: true,
      date_window: { start: opts.date_start ?? '(today)', end: opts.date_end ?? '(today+90)' },
      candidates: valid.length,
      inserted,
      refreshed,
      skipped_existing: skippedExisting,
      rejected,
      pruned_past: prunedPast,
      cost_usd: cost,
      model: MODEL,
      usage: response.usage,
    });
  }),
);
