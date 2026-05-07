// Weekly AI research agent. Asks Claude (with web_search) to find sports
// card releases in the next 90 days, validates the JSON, inserts new rows
// with source='ai_research', and writes per-field disagreements with
// existing scraper data into set_conflicts for admin review.
//
// Per spec:
// - Sunday 9 AM UTC weekly (cron schedule in another migration)
// - Model: claude-sonnet-4-5 (via ANTHROPIC_MODEL env)
// - Tool: web_search_20250305 (Anthropic built-in)
// - Confidence: high=2+ sources agree, medium=single source, low=inferred
// - Skip already-released items, skip non-sports
// - Cost cap: $5/week. Pre-flight check on api_request_log; exit cleanly
//   with Sentry warning if projected total would exceed.
// - Three-outcome model: success | degraded (0 returned) | failure (API err)
// - Feature flag: ANTHROPIC_API_KEY missing → 412 with clear message,
//   doesn't break other systems.

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
const WEEKLY_COST_CAP_USD = 5;

const TARGET_BRANDS_HUMAN = [
  'Topps', 'Panini', 'Bowman', 'Upper Deck', 'Leaf',
  'Fanatics Collect', 'Wild Card', 'Onyx', 'Donruss',
];

const PREFERRED_SOURCES = [
  'cardlines.com',
  'sportscardinvestor.com',
  'beckett.com',
  'blowoutbuzz.com',
  'prnewswire.com',
  'businesswire.com',
];

// Map Claude's "brand" field to our brand_id. Anything else → null and skip.
const BRAND_MAP: Record<string, string> = {
  topps: 'topps',
  panini: 'panini',
  bowman: 'bowman',
  'upper deck': 'upper_deck',
  upperdeck: 'upper_deck',
  leaf: 'leaf',
  'fanatics collect': 'fanatics',
  fanatics: 'fanatics',
  'wild card': 'wild_card',
  wildcard: 'wild_card',
  donruss: 'donruss',
  // 'onyx', 'other' → unmapped → skipped with note
};

// Match Claude's enums; box_type 'unknown' becomes null.
const ALLOWED_SPORTS = new Set([
  'basketball', 'baseball', 'football', 'hockey', 'soccer',
  'wrestling', 'racing', 'ufc', 'golf', 'tennis', 'multi-sport', 'other',
]);
const ALLOWED_BOX_TYPES = new Set([
  'hobby', 'retail', 'blaster', 'mega', 'jumbo', 'choice', 'breakers_delight', 'other',
]);
const ALLOWED_CONFIDENCE = new Set(['high', 'medium', 'low']);

type AgentRelease = {
  name: string;
  brand: string;
  sport: string;
  box_type: string;
  release_date: string | null;
  pre_order_opens_at: string | null;
  msrp_box: number | null;
  msrp_pack: number | null;
  confidence: string;
  sources: string[];
};

type ValidatedRelease = AgentRelease & { brand_id: string; source_id: string };

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
    const sport = String(raw.sport ?? '').toLowerCase();
    if (!ALLOWED_SPORTS.has(sport)) {
      reasons.push(`bad sport: ${raw.sport}`);
      continue;
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
      sport,
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

function daysBetween(a: string, b: string): number {
  return Math.abs(
    Math.round((new Date(a).getTime() - new Date(b).getTime()) / 86_400_000),
  );
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
    msrp_box: number | null;
    msrp_pack: number | null;
    sport: string | null;
    box_type: string | null;
    confidence: string | null;
    locked_fields: string[];
  } | null;
  matchKind: 'source_id' | 'fuzzy' | null;
}> {
  // 1. Exact source_id match (same source, re-run)
  const { data: bySid } = await admin
    .from('sets')
    .select('id, source, name, release_date, msrp_box, msrp_pack, sport, box_type, confidence, locked_fields')
    .eq('source', SOURCE)
    .eq('source_id', rel.source_id)
    .maybeSingle();
  if (bySid) return { row: bySid, matchKind: 'source_id' };

  // 2. Fuzzy: same brand, name match (normalized), within 7 days of release_date.
  // Pull candidates by brand + ±14d window then filter normalized in JS.
  const lo = new Date(rel.release_date);
  lo.setUTCDate(lo.getUTCDate() - FUZZY_DATE_WINDOW_DAYS);
  const hi = new Date(rel.release_date);
  hi.setUTCDate(hi.getUTCDate() + FUZZY_DATE_WINDOW_DAYS);
  const { data: candidates } = await admin
    .from('sets')
    .select('id, source, name, release_date, msrp_box, msrp_pack, sport, box_type, confidence, locked_fields')
    .eq('brand_id', rel.brand_id)
    .gte('release_date', lo.toISOString().slice(0, 10))
    .lte('release_date', hi.toISOString().slice(0, 10));
  const target = normalizeName(rel.name);
  const fuzzy = (candidates ?? []).find((c) => normalizeName(c.name) === target);
  return { row: fuzzy ?? null, matchKind: fuzzy ? 'fuzzy' : null };
}

// Per-field comparison; produces conflict rows for any disagreement.
async function recordConflicts(
  // deno-lint-ignore no-explicit-any
  admin: any,
  setId: string,
  existingSource: string,
  existing: Record<string, unknown>,
  agent: ValidatedRelease,
  existingConfidence: string | null,
): Promise<number> {
  const fields: Array<[string, unknown, unknown]> = [
    ['release_date', existing.release_date, agent.release_date],
    ['msrp_box', existing.msrp_box, agent.msrp_box],
    ['msrp_pack', existing.msrp_pack, agent.msrp_pack],
    ['sport', existing.sport, agent.sport],
    ['box_type', existing.box_type, agent.box_type === 'unknown' ? null : agent.box_type],
  ];
  let inserted = 0;
  for (const [field, valueA, valueB] of fields) {
    if (valueA == null && valueB == null) continue;
    if (String(valueA ?? '') === String(valueB ?? '')) continue;
    const { error } = await admin.from('set_conflicts').insert({
      set_id: setId,
      source_a: existingSource,
      source_b: SOURCE,
      field_name: field,
      value_a: valueA == null ? null : String(valueA),
      value_b: valueB == null ? null : String(valueB),
      confidence_a: existingConfidence,
      confidence_b: agent.confidence,
    });
    // Unique constraint on (set_id, source_a, source_b, field_name) — already
    // logged this conflict, ignore.
    if (error && !/duplicate key/i.test(error.message)) {
      console.warn(`set_conflicts insert: ${error.message}`);
      continue;
    }
    if (!error) inserted++;
  }
  return inserted;
}

function buildPrompts(): { system: string; user: string } {
  const today = new Date().toISOString().slice(0, 10);
  const ninetyDaysOut = new Date(Date.now() + 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const system = `You are a sports card release researcher.

Your job: find upcoming hobby + retail product releases from these manufacturers — ${TARGET_BRANDS_HUMAN.join(', ')} — across all sports (MLB, NFL, NBA/WNBA, NHL, MLS/UEFA/Premier League, WWE/AEW, NASCAR/F1, UFC, golf, tennis, multi-sport).

Use the web_search tool to consult, in order of preference:
${PREFERRED_SOURCES.map((s) => `  - ${s}`).join('\n')}
Manufacturer press releases on prnewswire.com or businesswire.com count as primary sources. Avoid forums, Reddit, eBay, marketplace listings.

Output discipline:
- Return ONE JSON object only. No prose. No markdown fences. No commentary.
- Top-level shape: { "releases": [ … ] }.
- Each release object MUST have these keys exactly:
    name (string), brand (one of: Topps, Panini, Bowman, Upper Deck, Leaf, Fanatics Collect, Wild Card, Onyx, Donruss, other),
    sport (one of: basketball, baseball, football, hockey, soccer, wrestling, racing, ufc, golf, tennis, multi-sport, other),
    box_type (one of: hobby, retail, blaster, mega, jumbo, choice, breakers_delight, other, unknown),
    release_date ("YYYY-MM-DD" or null),
    pre_order_opens_at ("YYYY-MM-DD" or null),
    msrp_box (number or null),
    msrp_pack (number or null),
    confidence ("high" | "medium" | "low"),
    sources (array of URLs you actually consulted).
- confidence rules:
    high — 2+ independent sources from the preferred list agree on the date
    medium — single source, or sources disagree by < 7 days
    low — inferred from manufacturer release patterns (e.g. "Topps Series 1 historically drops mid-Jan")
- Skip releases that have already shipped (release_date < today).
- Skip Pokemon, Magic, Yu-Gi-Oh, Lorcana, One Piece, Digimon, Dragon Ball — those are covered elsewhere.
- If you can't confirm a release_date with at least low confidence, omit the entry entirely.
- Aim for 20–60 entries. Quality over quantity.`;

  const user = `Today is ${today}. Find sports card hobby + retail releases scheduled between today and ${ninetyDaysOut}.

Return only the JSON object. Do not narrate the search process.`;

  return { system, user };
}

async function projectedWeeklyCost(
  // deno-lint-ignore no-explicit-any
  admin: any,
): Promise<number> {
  // Sum of cost_units stored as USD-cents-as-int? No — we store cost_units
  // as numeric and write USD directly. Pre-cap is "is sum of last 7 days
  // already >= cap?" — simple guard.
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

    // Cost cap pre-flight
    const spentLast7d = await projectedWeeklyCost(admin);
    if (spentLast7d >= WEEKLY_COST_CAP_USD) {
      captureWarning('cost_cap_exceeded', SOURCE, {
        spent_last_7d_usd: spentLast7d,
        cap_usd: WEEKLY_COST_CAP_USD,
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
        spent_last_7d_usd: spentLast7d,
        cap_usd: WEEKLY_COST_CAP_USD,
      });
    }

    const { system, user } = buildPrompts();

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
    let conflictRows = 0;
    let skippedDueToConflict = 0;

    const now = new Date().toISOString();
    for (const rel of valid) {
      const { row, matchKind } = await findExisting(admin, rel);

      if (matchKind === 'source_id' && row) {
        // Same source re-run: just refresh last_synced_at (don't overwrite — admin may have edited)
        await admin.from('sets').update({ last_synced_at: now }).eq('id', row.id);
        continue;
      }

      if (matchKind === 'fuzzy' && row) {
        // Disagreement with another source → log conflicts, do NOT insert duplicate
        const c = await recordConflicts(
          admin,
          row.id,
          row.source,
          row,
          rel,
          row.confidence,
        );
        conflictRows += c;
        skippedDueToConflict++;
        continue;
      }

      // No match → insert as a new ai_research row.
      const { error: insErr } = await admin.from('sets').insert({
        brand_id: rel.brand_id,
        name: rel.name,
        sport: rel.sport,
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

    return jsonResponse({
      ok: true,
      candidates: valid.length,
      inserted,
      conflicts_logged: conflictRows,
      skipped_due_to_conflict: skippedDueToConflict,
      rejected,
      cost_usd: cost,
      model: MODEL,
      usage: response.usage,
    });
  }),
);
