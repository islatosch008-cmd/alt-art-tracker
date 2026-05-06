// CardboardConnection.com release calendar — primary sports release source
// for Phase 1. Page format: per-year HTML <table> (TablePress) with two
// columns (Release Date | Set Name). Year is in a sibling <h2> with id
// "tablepress-N-name".
//
// Per Ian's spec:
//   - Daily 6:02 AM UTC (2-min offset from Leaf)
//   - User-Agent + 100ms delay (politeFetch handles both)
//   - robots.txt: /new-release-calender path is not in the disallow list
//     (verified once; we don't re-check every run — robots.txt rules
//     change rarely and we'd want a screaming-loud failure if blocked)
//   - article:modified_time → if >14 days stale, log warning row to
//     api_request_log so /admin/scrapers can surface it
//   - source_id = SHA-256(year|name|release_date) since CC has no per-row
//     stable URL slug
//   - TBA/TBD: skip with reason logged, no insert with null release_date
//   - source = 'cardboardconnection_scraper'
//   - HTML snapshot on parse-zero (handled by recordOutcome)

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import {
  hashSourceId,
  politeFetch,
  recordOutcome,
  type ScrapeOutcome,
  type ScrapedRelease,
  upsertScrapedReleases,
} from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'cardboardconnection_scraper';
const TARGET = 'https://www.cardboardconnection.com/new-release-calender';

// Process only this year's calendar +/- a year. Prevents us from re-ingesting
// 2018-2024 historical data on every run.
const YEAR_WINDOW_BACK = 1;
const YEAR_WINDOW_FWD = 1;

const MONTH_ABBRS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

const TBD_PREFIXES = /^(TBA|TBD|Mid|Late|Early|Q[1-4]|Spring|Summer|Fall|Autumn|Winter|Holiday)/i;

// Brand prefix → our brand_id. Order matters (most specific first).
const BRAND_PATTERNS: Array<[RegExp, string]> = [
  [/\bUpper Deck\b/i, 'upper_deck'],
  [/\bWild Card\b/i, 'wild_card'],
  [/\bFanatics\b/i, 'fanatics'],
  [/\bBowman\b/i, 'bowman'],
  [/\bDonruss\b/i, 'donruss'],
  [/\bPanini\b/i, 'panini'],
  [/\bTopps\b/i, 'topps'],
  [/\bLeaf\b/i, 'leaf'],
];

const SPORT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(MLB|Baseball)\b/i, 'baseball'],
  [/\b(NFL|Football)\b/i, 'football'],
  [/\b(NBA|WNBA|Basketball)\b/i, 'basketball'],
  [/\b(NHL|AHL|CHL|Hockey)\b/i, 'hockey'],
  [/\b(MLS|UCL|UEFA|Premier League|La Liga|Bundesliga|Serie A|Soccer)\b/i, 'soccer'],
  [/\b(WWE|AEW|Wrestl|NXT)\b/i, 'wrestling'],
  [/\b(NASCAR|F1|Formula One|IndyCar|Racing)\b/i, 'racing'],
  [/\b(UFC|MMA)\b/i, 'ufc'],
  [/\bGolf\b/i, 'golf'],
  [/\bTennis\b/i, 'tennis'],
  [/\bMulti[- ]?Sport\b/i, 'multi-sport'],
  [/\b(Marvel|Star Wars|Disney|Pop Century|Garbage Pail|Mars Attacks)\b/i, 'entertainment'],
];

const BOX_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\bHobby Box\b/i, 'hobby'],
  [/\bRetail\b/i, 'retail'],
  [/\bBlaster\b/i, 'blaster'],
  [/\bMega\b/i, 'mega'],
  [/\bJumbo\b/i, 'jumbo'],
  [/\bChoice\b/i, 'choice'],
  [/\bBreaker'?s? Delight\b/i, 'breakers_delight'],
  [/\bHobby\b/i, 'hobby'], // catch-all hobby last
];

function inferBrand(name: string): string | null {
  for (const [re, id] of BRAND_PATTERNS) if (re.test(name)) return id;
  return null;
}
function inferSport(name: string): string | null {
  for (const [re, id] of SPORT_PATTERNS) if (re.test(name)) return id;
  return null;
}
function inferBoxType(name: string): string | null {
  for (const [re, id] of BOX_TYPE_PATTERNS) if (re.test(name)) return id;
  return null;
}

// Parse "2-Jan", "1/3", or similar. Returns YYYY-MM-DD or null when the
// row is TBD-shaped (which the caller skips).
function parseCcDate(raw: string, year: number): string | null {
  const trim = raw.replace(/\s+/g, ' ').trim();
  if (!trim) return null;
  if (TBD_PREFIXES.test(trim)) return null;

  // "2-Jan", "20-Jan"
  const dashMatch = /^(\d{1,2})[-\s]([A-Za-z]+)/.exec(trim);
  if (dashMatch) {
    const day = parseInt(dashMatch[1], 10);
    const monthIdx = MONTH_ABBRS.indexOf(dashMatch[2].toLowerCase().slice(0, 3));
    if (monthIdx < 0 || day < 1 || day > 31) return null;
    return `${year}-${String(monthIdx + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  // "1/3", "1/14"
  const slashMatch = /^(\d{1,2})\/(\d{1,2})/.exec(trim);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10);
    const day = parseInt(slashMatch[2], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

// Strip leading year ("2024 ") and any "*" / "(TBA)" suffix marks the page
// adds to denote tentative releases.
function cleanSetName(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/^\s*\d{4}(?:[- ]\d{2,4})?\s+/, '') // drop "2024" or "2024-25" prefix
    .replace(/\s*\(TBA\)\s*$/i, '')
    .replace(/\s*\*+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pull article:modified_time meta tag. Returns ms since epoch or null.
function articleModifiedTime(html: string): number | null {
  const m = /<meta\s+property="article:modified_time"\s+content="([^"]+)"/i.exec(html);
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? t : null;
}

type YearTable = { year: number; tableHtml: string };

function findYearTables(html: string, currentYear: number): YearTable[] {
  // Grab all <h2 id="tablepress-N-name">YYYY ...</h2> + matching table.
  const out: YearTable[] = [];
  const headerRe = /<h2[^>]*id="tablepress-(\d+)-name"[^>]*>(\d{4})\b[^<]*<\/h2>/gi;
  let m: RegExpExecArray | null;
  const minYear = currentYear - YEAR_WINDOW_BACK;
  const maxYear = currentYear + YEAR_WINDOW_FWD;
  while ((m = headerRe.exec(html)) !== null) {
    const tableId = m[1];
    const year = parseInt(m[2], 10);
    if (year < minYear || year > maxYear) continue;
    // Find the <table id="tablepress-N">…</table>
    const tableRe = new RegExp(
      `<table[^>]*id="tablepress-${tableId}"[^>]*>([\\s\\S]*?)</table>`,
      'i',
    );
    const tm = tableRe.exec(html);
    if (!tm) continue;
    out.push({ year, tableHtml: tm[1] });
  }
  return out;
}

function parseRows(tableHtml: string): Array<{ date: string; name: string }> {
  const rows: Array<{ date: string; name: string }> = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let r: RegExpExecArray | null;
  while ((r = rowRe.exec(tableHtml)) !== null) {
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(r[1])) !== null) {
      cells.push(c[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    }
    if (cells.length < 2) continue;
    const date = cells[0];
    const name = cells[1];
    if (!date || !name || /^Release Date$/i.test(date)) continue; // header row
    rows.push({ date, name });
  }
  return rows;
}

Deno.serve(
  withSentry(SOURCE, async (req) => {
    const pre = preflight(req);
    if (pre) return pre;
    const admin = adminClient();

    let res: Response;
    try {
      res = await politeFetch(TARGET);
    } catch (err) {
      const outcome: ScrapeOutcome = {
        kind: 'failure',
        statusCode: 0,
        error: `fetch threw: ${(err as Error).message}`,
      };
      await recordOutcome(admin, SOURCE, outcome);
      return jsonResponse({ ok: false, ...outcome }, 502);
    }
    if (!res.ok) {
      const outcome: ScrapeOutcome = {
        kind: 'failure',
        statusCode: res.status,
        error: `HTTP ${res.status}`,
      };
      await recordOutcome(admin, SOURCE, outcome);
      return jsonResponse({ ok: false, ...outcome }, 502);
    }

    const html = await res.text();
    const currentYear = new Date().getUTCFullYear();
    const tables = findYearTables(html, currentYear);

    if (tables.length === 0) {
      const outcome: ScrapeOutcome = {
        kind: 'degraded',
        statusCode: res.status,
        reason: 'no_year_tables_in_window',
        url: TARGET,
        html,
      };
      await recordOutcome(admin, SOURCE, outcome);
      return jsonResponse({ ok: true, scraped: 0, reason: 'no_year_tables_in_window' });
    }

    // Staleness warning
    const modifiedMs = articleModifiedTime(html);
    const STALE_DAYS = 14;
    let staleWarning: { stale_days: number; modified_at: string } | null = null;
    if (modifiedMs) {
      const ageDays = Math.floor((Date.now() - modifiedMs) / 86_400_000);
      if (ageDays > STALE_DAYS) {
        staleWarning = {
          stale_days: ageDays,
          modified_at: new Date(modifiedMs).toISOString(),
        };
        await admin.from('api_request_log').insert({
          source: SOURCE,
          endpoint: 'stale_warning',
          status_code: 200,
          cost_units: ageDays,
        });
        console.warn(`[${SOURCE}] page is ${ageDays} days stale (modified ${staleWarning.modified_at})`);
      }
    }

    let scraped = 0;
    let skippedTbd = 0;
    let skippedUnknownBrand = 0;
    const releases: ScrapedRelease[] = [];

    for (const { year, tableHtml } of tables) {
      const rows = parseRows(tableHtml);
      for (const { date, name } of rows) {
        const releaseDate = parseCcDate(date, year);
        if (!releaseDate) {
          skippedTbd++;
          continue;
        }
        const cleanName = cleanSetName(name);
        const brandId = inferBrand(cleanName);
        if (!brandId) {
          skippedUnknownBrand++;
          continue;
        }
        releases.push({
          source_id: await hashSourceId('cc', String(year), cleanName, releaseDate),
          brand_id: brandId,
          name: cleanName,
          sport: inferSport(cleanName),
          box_type: inferBoxType(cleanName),
          release_date: releaseDate,
          external_ids: { cc_year: year, cc_raw_name: name },
        });
      }
      scraped += rows.length;
    }

    const counts =
      releases.length > 0
        ? await upsertScrapedReleases(admin, SOURCE, releases)
        : { inserted: 0, updated: 0, locked_skipped: 0 };

    if (releases.length === 0) {
      const outcome: ScrapeOutcome = {
        kind: 'degraded',
        statusCode: res.status,
        reason: 'all_rows_filtered',
        url: TARGET,
        html,
      };
      await recordOutcome(admin, SOURCE, outcome);
      return jsonResponse({
        ok: true,
        scraped: 0,
        reason: 'all_rows_filtered',
        rows_seen: scraped,
        skipped_tbd: skippedTbd,
        skipped_unknown_brand: skippedUnknownBrand,
        stale_warning: staleWarning,
      });
    }

    await recordOutcome(admin, SOURCE, {
      kind: 'success',
      statusCode: res.status,
      scraped: releases.length,
    });

    return jsonResponse({
      ok: true,
      scraped: releases.length,
      rows_seen: scraped,
      skipped_tbd: skippedTbd,
      skipped_unknown_brand: skippedUnknownBrand,
      stale_warning: staleWarning,
      ...counts,
    });
  }),
);
