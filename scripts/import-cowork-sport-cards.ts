// Cowork-collected sport-card sales import.
//
// Imports an 875-row JSONL of structured sport-card sales into:
//   - sets             (source='cowork_collection', confidence='medium')
//   - cards            (tier='sports', category='sports')
//   - price_history    (source='cowork_collection')
//
// Pipeline:
//   1. Parse + validate JSONL
//   2. Dedup by listing_url
//   3. Filter by --min-price (default $1, drops penny listings)
//   4. Build set candidates
//   5. Build card candidates
//   6. Fuzzy-resolve sets against existing rows
//   7. Plan card inserts
//   8. Plan price_history inserts
//   9. Print dry-run summary
//   10. (--commit) Insert in dependency order: sets → cards → price_history
//   11. Verify post-insert counts + spot-check 5 cards
//
// Usage:
//   SUPABASE_URL=$(grep '^SUPABASE_URL=' .env.local | cut -d= -f2-) \
//   SUPABASE_SERVICE_ROLE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-) \
//     npx tsx scripts/import-cowork-sport-cards.ts                  # dry-run
//   ... --commit                                                     # apply
//   ... --min-price=0                                                # disable price filter
//   ... --file=PATH                                                  # override default file
//   ... --limit=N                                                    # truncate input (testing)
//
// SECRETS: pass SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY via env. The
// script does NOT auto-load .env.local — use the secure grep+pipe pattern
// above to avoid dotenv-parser footguns.
//
// FAILURE RECOVERY: every inserted row is tagged with external_ids.import_run_id
// so a failed mid-pipeline run can be rolled back manually:
//   DELETE FROM price_history WHERE external_ids->>'import_run_id' = '<run_id>';
//   DELETE FROM cards         WHERE external_ids->>'import_run_id' = '<run_id>';
//   DELETE FROM sets          WHERE external_ids->>'import_run_id' = '<run_id>';
// (FK ON DELETE CASCADE on sets→cards and cards→price_history makes the
// first two deletes optional, but safer to be explicit.)

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { adminClient } from './_supabase.ts';

const ALLOWED_SPORTS = new Set([
  'Baseball',
  'Basketball',
  'Football',
  'Hockey',
  'Soccer',
  'Wrestling',
  'MMA',
  'Racing',
  'Multi-sport',
]);

const ALLOWED_MANUFACTURERS = new Set([
  'Panini',
  'Topps',
  'Bowman',
  'Upper Deck',
  'Donruss',
  'Leaf',
  'Fanatics',
]);

const SPORT_BRAND_IDS = [
  'panini',
  'topps',
  'bowman',
  'upper_deck',
  'donruss',
  'leaf',
  'fanatics',
];

const MIN_YEAR = 1980;
const MAX_YEAR = 2027;

const RARITY_SCORE: Record<string, number> = {
  Auto: 80,
  SSP: 80,
  Patch: 75,
  Numbered: 70,
  Refractor: 65,
  Parallel: 60,
  Insert: 55,
  Rookie: 50,
  Base: 40,
};
const DEFAULT_RARITY_SCORE = 40;

const COWORK_SESSION = '2026-05-09';

const DEFAULT_FILE = path.join(os.homedir(), 'Desktop', 'sport-cards-collected.jsonl');
const DEFAULT_MIN_PRICE = 1.0;

// Card-payload chunk: balances payload size against round-trips. Pokemon
// import uses 100; price_history rows are smaller so we can go higher.
const SET_CHUNK = 200;
const CARD_CHUNK = 100;
const PH_CHUNK = 500;

type Args = {
  file: string;
  minPrice: number;
  commit: boolean;
  limit: number | null;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    file: DEFAULT_FILE,
    minPrice: DEFAULT_MIN_PRICE,
    commit: false,
    limit: null,
  };
  for (const arg of argv) {
    if (arg === '--commit') out.commit = true;
    else if (arg.startsWith('--file=')) out.file = arg.slice('--file='.length);
    else if (arg.startsWith('--min-price=')) out.minPrice = parseFloat(arg.slice('--min-price='.length));
    else if (arg.startsWith('--limit=')) out.limit = parseInt(arg.slice('--limit='.length), 10);
  }
  if (Number.isNaN(out.minPrice) || out.minPrice < 0) {
    throw new Error(`invalid --min-price: ${out.minPrice}`);
  }
  return out;
}

type RawRow = {
  name: string;
  card_number: string | null;
  set_name: string;
  year: number;
  sport: string;
  manufacturer: string;
  rarity: string | null;
  psa_grade: string | null;
  sale_price: string;
  sale_date: string;
  listing_url: string;
  listing_title: string;
};

type ValidationResult = { ok: true; row: RawRow } | { ok: false; reason: string };

function validateRow(raw: any): ValidationResult {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'not an object' };
  if (typeof raw.name !== 'string' || !raw.name.trim()) return { ok: false, reason: 'missing/empty name' };
  if (typeof raw.set_name !== 'string' || !raw.set_name.trim()) return { ok: false, reason: 'missing/empty set_name' };
  if (typeof raw.year !== 'number' || raw.year < MIN_YEAR || raw.year > MAX_YEAR) {
    return { ok: false, reason: `year out of range: ${raw.year}` };
  }
  if (!ALLOWED_SPORTS.has(raw.sport)) return { ok: false, reason: `bad sport: ${raw.sport}` };
  if (!ALLOWED_MANUFACTURERS.has(raw.manufacturer)) {
    return { ok: false, reason: `bad manufacturer: ${raw.manufacturer}` };
  }
  if (typeof raw.sale_price !== 'string') return { ok: false, reason: 'sale_price not a string' };
  const price = parseFloat(raw.sale_price);
  if (!isFinite(price) || price <= 0) return { ok: false, reason: `bad sale_price: ${raw.sale_price}` };
  if (typeof raw.sale_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.sale_date)) {
    return { ok: false, reason: `bad sale_date format: ${raw.sale_date}` };
  }
  const d = new Date(raw.sale_date);
  if (Number.isNaN(d.getTime())) return { ok: false, reason: `unparseable sale_date: ${raw.sale_date}` };
  if (typeof raw.listing_url !== 'string' || !raw.listing_url.startsWith('http')) {
    return { ok: false, reason: `bad listing_url: ${raw.listing_url}` };
  }
  return {
    ok: true,
    row: {
      name: raw.name.trim(),
      card_number: typeof raw.card_number === 'string' && raw.card_number.trim() ? raw.card_number.trim() : null,
      set_name: raw.set_name.trim(),
      year: raw.year,
      sport: raw.sport,
      manufacturer: raw.manufacturer,
      rarity: typeof raw.rarity === 'string' && raw.rarity.trim() ? raw.rarity.trim() : null,
      psa_grade: typeof raw.psa_grade === 'string' && raw.psa_grade.trim() ? raw.psa_grade.trim() : null,
      sale_price: raw.sale_price,
      sale_date: raw.sale_date,
      listing_url: raw.listing_url,
      listing_title: typeof raw.listing_title === 'string' ? raw.listing_title : '',
    },
  };
}

function manufacturerToBrandId(m: string): string {
  return m.toLowerCase().replace(/ /g, '_');
}

function popularityFor(rarity: string | null): number {
  const base = rarity != null && RARITY_SCORE[rarity] != null ? RARITY_SCORE[rarity] : DEFAULT_RARITY_SCORE;
  // Slight jitter so equal-rarity cards don't tie exactly when ordered.
  return Math.round((base + Math.random() * 3) * 100) / 100;
}

// SetKey: brand_id|lower(name)|sport|year — the fuzzy-match key.
function setKey(brandId: string, name: string, sport: string, year: number): string {
  return `${brandId}|${name.toLowerCase().trim()}|${sport}|${year}`;
}

// CardKey: setKey + card_number + lower(name) — uniquely identifies a card
// candidate within a set.
function cardKey(sk: string, cardNumber: string | null, name: string): string {
  return `${sk}|${cardNumber ?? ''}|${name.toLowerCase().trim()}`;
}

// Pre-flight: ensure every YYYY-MM in salesByMonth has a corresponding
// price_history_YYYY_MM partition. Aborts with a clear error if any
// month is missing — prevents the "no partition of relation found"
// 23514 mid-pipeline failure that leaves orphan sets+cards in prod
// (incident: 2026-05-09 first --commit attempt).
//
// Catalog tables aren't reachable via supabase-js (PostgREST doesn't
// expose pg_catalog), so this shells out to `supabase db query` using
// SUPABASE_DB_URL from env. Required only for --commit; dry-run uses
// the distribution summary printed earlier.
async function assertPartitionsExist(salesByMonth: Map<string, number>): Promise<void> {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error(
      '! SUPABASE_DB_URL must be set for --commit (used by partition pre-flight).\n' +
        '  Build with the secure grep pattern, e.g.:\n' +
        '    PW=$(grep \'^SUPABASE_DB_PASSWORD=\' .env.local | cut -d= -f2-)\n' +
        '    SUPABASE_DB_URL="postgresql://postgres.<ref>:${PW}@<region>.pooler.supabase.com:5432/postgres"',
    );
    process.exit(1);
  }

  const { execSync } = await import('node:child_process');
  const sql =
    "SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid " +
    "WHERE i.inhparent='public.price_history'::regclass";

  let stdout: string;
  try {
    stdout = execSync(
      `supabase db query --db-url=${JSON.stringify(dbUrl)} --output csv ${JSON.stringify(sql)}`,
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (e) {
    throw new Error(`pre-flight: supabase db query failed: ${(e as Error).message}`);
  }

  const partitionNames = stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l !== 'relname' && l.startsWith('price_history_'));

  const existingMonths = new Set<string>();
  for (const name of partitionNames) {
    const m = name.match(/^price_history_(\d{4})_(\d{2})$/);
    if (m) existingMonths.add(`${m[1]}-${m[2]}`);
  }

  const missing: Array<{ month: string; count: number }> = [];
  for (const [month, count] of salesByMonth) {
    if (!existingMonths.has(month)) missing.push({ month, count });
  }

  if (missing.length > 0) {
    console.error(`! Pre-flight check FAILED: missing partitions for these months:`);
    for (const m of missing.sort((a, b) => a.month.localeCompare(b.month))) {
      console.error(`    ${m.month} (${m.count} sales would have failed)`);
    }
    console.error(`  Add partitions via migration before re-running --commit.`);
    process.exit(1);
  }

  console.log(
    `Partition coverage: ${existingMonths.size} existing, ` +
      `all ${salesByMonth.size} sale months covered.`,
  );
}

function pickRandom<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`> file:       ${args.file}`);
  console.log(`> min-price:  $${args.minPrice}`);
  console.log(`> commit:     ${args.commit}`);
  if (args.limit != null) console.log(`> limit:      ${args.limit}`);

  if (!fs.existsSync(args.file)) {
    console.error(`! file not found: ${args.file}`);
    process.exit(1);
  }

  // Bail early if env vars aren't set so we don't accidentally hit local
  // stack via supabase status fallback.
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      '! SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env.\n' +
        '  Use the secure grep pattern documented at top of this file.',
    );
    process.exit(1);
  }

  const supabase = adminClient();

  // -------------------------------------------------------------------------
  // Step 1: parse + validate
  // -------------------------------------------------------------------------
  const raw = fs.readFileSync(args.file, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const truncated = args.limit != null ? lines.slice(0, args.limit) : lines;

  let parseErrors = 0;
  let validationRejects = 0;
  const rejects: Array<{ line: number; reason: string }> = [];
  const valid: RawRow[] = [];

  for (let i = 0; i < truncated.length; i++) {
    let parsed: any;
    try {
      parsed = JSON.parse(truncated[i]);
    } catch (e) {
      parseErrors++;
      const reason = `parse_error: ${(e as Error).message}`;
      rejects.push({ line: i + 1, reason });
      console.error(`reject line ${i + 1}: ${reason}`);
      continue;
    }
    const v = validateRow(parsed);
    if (!v.ok) {
      validationRejects++;
      rejects.push({ line: i + 1, reason: v.reason });
      console.error(`reject line ${i + 1}: ${v.reason}`);
      continue;
    }
    valid.push(v.row);
  }

  // -------------------------------------------------------------------------
  // Step 2: dedup by listing_url
  // -------------------------------------------------------------------------
  const seenUrls = new Set<string>();
  const dedup: RawRow[] = [];
  for (const r of valid) {
    if (seenUrls.has(r.listing_url)) continue;
    seenUrls.add(r.listing_url);
    dedup.push(r);
  }
  const dupesDropped = valid.length - dedup.length;

  // -------------------------------------------------------------------------
  // Step 3: filter by --min-price
  // -------------------------------------------------------------------------
  const filtered = dedup.filter((r) => parseFloat(r.sale_price) >= args.minPrice);
  const priceDropped = dedup.length - filtered.length;

  // -------------------------------------------------------------------------
  // Step 3.5: sale-date distribution (used by pre-flight partition check
  // in --commit, surfaced in dry-run for visibility)
  // -------------------------------------------------------------------------
  const salesByMonth = new Map<string, number>();
  let earliest: string | null = null;
  let latest: string | null = null;
  for (const r of filtered) {
    const month = r.sale_date.slice(0, 7);
    salesByMonth.set(month, (salesByMonth.get(month) ?? 0) + 1);
    if (earliest == null || r.sale_date < earliest) earliest = r.sale_date;
    if (latest == null || r.sale_date > latest) latest = r.sale_date;
  }

  // -------------------------------------------------------------------------
  // Step 4: build set candidates
  // -------------------------------------------------------------------------
  type SetCandidate = {
    key: string;
    brand_id: string;
    name: string;
    year: number;
    sport: string;
    sample_title: string;
    sale_count: number;
  };
  const setMap = new Map<string, SetCandidate>();
  for (const r of filtered) {
    const brandId = manufacturerToBrandId(r.manufacturer);
    const k = setKey(brandId, r.set_name, r.sport, r.year);
    let c = setMap.get(k);
    if (!c) {
      c = {
        key: k,
        brand_id: brandId,
        name: r.set_name,
        year: r.year,
        sport: r.sport,
        sample_title: r.listing_title,
        sale_count: 0,
      };
      setMap.set(k, c);
    }
    c.sale_count++;
  }

  // -------------------------------------------------------------------------
  // Step 5: build card candidates
  // -------------------------------------------------------------------------
  type CardCandidate = {
    key: string;
    setKey: string;
    brand_id: string;
    name: string;
    card_number: string | null;
    rarities: string[]; // observed, in order
    psa_grades: Set<string>;
    listing_urls: string[];
    sales: RawRow[];
  };
  const cardMap = new Map<string, CardCandidate>();
  for (const r of filtered) {
    const brandId = manufacturerToBrandId(r.manufacturer);
    const sk = setKey(brandId, r.set_name, r.sport, r.year);
    const ck = cardKey(sk, r.card_number, r.name);
    let c = cardMap.get(ck);
    if (!c) {
      c = {
        key: ck,
        setKey: sk,
        brand_id: brandId,
        name: r.name,
        card_number: r.card_number,
        rarities: [],
        psa_grades: new Set(),
        listing_urls: [],
        sales: [],
      };
      cardMap.set(ck, c);
    }
    if (r.rarity && !c.rarities.includes(r.rarity)) c.rarities.push(r.rarity);
    if (r.psa_grade) c.psa_grades.add(r.psa_grade);
    c.listing_urls.push(r.listing_url);
    c.sales.push(r);
  }

  // -------------------------------------------------------------------------
  // Step 6: resolve sets against existing
  // -------------------------------------------------------------------------
  const { data: existingSets, error: setReadErr } = await supabase
    .from('sets')
    .select('id, brand_id, name, sport, release_date')
    .in('brand_id', SPORT_BRAND_IDS);
  if (setReadErr) throw setReadErr;

  const existingByKey = new Map<string, string>();
  let unmatchableExisting = 0;
  for (const s of existingSets ?? []) {
    if (!s.brand_id || !s.name || !s.sport || !s.release_date) {
      unmatchableExisting++;
      continue;
    }
    const year = new Date(s.release_date).getUTCFullYear();
    existingByKey.set(setKey(s.brand_id, s.name, s.sport, year), s.id);
  }

  const setsToCreate: SetCandidate[] = [];
  const setKeyToId = new Map<string, string>();
  for (const [k, cand] of setMap) {
    const existingId = existingByKey.get(k);
    if (existingId) {
      setKeyToId.set(k, existingId);
    } else {
      setsToCreate.push(cand);
    }
  }

  // -------------------------------------------------------------------------
  // Step 9: dry-run summary
  // -------------------------------------------------------------------------
  console.log(`\n=== PARSE / FILTER ===`);
  console.log(`Total lines:           ${truncated.length}`);
  console.log(`Parse errors:          ${parseErrors}`);
  console.log(`Validation rejects:    ${validationRejects}`);
  console.log(`Valid:                 ${valid.length}`);
  console.log(`After dedup:           ${dedup.length}  (dropped ${dupesDropped} dupe URL)`);
  console.log(`After min-price:       ${filtered.length}  (dropped ${priceDropped} below $${args.minPrice})`);

  if (rejects.length > 0) {
    console.log(`  (${rejects.length} reject line numbers logged to stderr)`);
  }

  console.log(`\n=== SALE DATE DISTRIBUTION ===`);
  console.log(`Earliest:               ${earliest ?? '(none)'}`);
  console.log(`Latest:                 ${latest ?? '(none)'}`);
  console.log(`Unique YYYY-MM values:  ${salesByMonth.size}`);
  console.log(`Per month:`);
  const sortedMonths = [...salesByMonth.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [m, c] of sortedMonths) {
    console.log(`  ${m}: ${c}`);
  }

  console.log(`\n=== PLAN ===`);
  console.log(`Set candidates:        ${setMap.size}`);
  console.log(`  matched existing:    ${setKeyToId.size}`);
  console.log(`  to create:           ${setsToCreate.length}`);
  console.log(`  (existing rows scanned: ${existingSets?.length ?? 0}, ${unmatchableExisting} skipped due to missing sport/release_date)`);
  console.log(`Card candidates:       ${cardMap.size}`);
  console.log(`Sale records:          ${filtered.length}`);

  // Sample previews
  console.log(`\n=== SAMPLE: 5 random sets to create ===`);
  const sampleSets = pickRandom(setsToCreate, 5);
  const now = new Date().toISOString();
  for (const s of sampleSets) {
    const row = {
      brand_id: s.brand_id,
      name: s.name,
      sport: s.sport,
      release_date: `${s.year}-01-01`,
      source: 'cowork_collection',
      confidence: 'medium',
      external_ids: {
        first_seen_at: now,
        cowork_session: COWORK_SESSION,
      },
      _meta: { sale_count: s.sale_count, sample_title: s.sample_title },
    };
    console.log(JSON.stringify(row, null, 2));
  }

  console.log(`\n=== SAMPLE: 5 random cards to insert ===`);
  const sampleCards = pickRandom([...cardMap.values()], 5);
  for (const c of sampleCards) {
    const rarity = c.rarities[0] ?? null;
    const row = {
      set_key: c.setKey,
      brand_id: c.brand_id,
      category: 'sports',
      name: c.name,
      card_number: c.card_number,
      rarity,
      tier: 'sports',
      popularity_score: popularityFor(rarity),
      heating_up_score: 0,
      last_price_check_at: null,
      external_ids: {
        cowork_listing_url: c.listing_urls[0],
        observed_psa_grades: [...c.psa_grades],
      },
      _meta: { rarities_observed: c.rarities, sale_count: c.sales.length },
    };
    console.log(JSON.stringify(row, null, 2));
  }

  console.log(`\n=== SAMPLE: 5 random sales ===`);
  const sampleSales = pickRandom(filtered, 5);
  for (const r of sampleSales) {
    const truncTitle = r.listing_title.length > 200 ? r.listing_title.slice(0, 200) : r.listing_title;
    const row = {
      price: parseFloat(r.sale_price),
      source: 'cowork_collection',
      condition: r.psa_grade ? 'graded' : 'raw',
      recorded_at: `${r.sale_date}T00:00:00Z`,
      external_ids: {
        listing_url: r.listing_url,
        psa_grade: r.psa_grade,
        listing_title: truncTitle,
      },
      _meta: { card: r.name, set: r.set_name, year: r.year },
    };
    console.log(JSON.stringify(row, null, 2));
  }

  if (!args.commit) {
    console.log(`\n[dry-run] no writes performed. Re-run with --commit to apply.`);
    return;
  }

  // -------------------------------------------------------------------------
  // Step 10: --commit mode
  // -------------------------------------------------------------------------
  const RUN_ID = `cowork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  console.log(`\n=== COMMIT (run_id=${RUN_ID}) ===`);
  console.log(`Cleanup query if anything fails:`);
  console.log(`  DELETE FROM price_history WHERE external_ids->>'import_run_id' = '${RUN_ID}';`);
  console.log(`  DELETE FROM cards         WHERE external_ids->>'import_run_id' = '${RUN_ID}';`);
  console.log(`  DELETE FROM sets          WHERE external_ids->>'import_run_id' = '${RUN_ID}';`);

  // Pre-flight: confirm every sale month has a price_history partition
  // BEFORE we start inserting anything. Cheaper to fail here than to
  // discover the gap mid-pipeline and orphan sets+cards in prod.
  console.log(`\n=== PRE-FLIGHT ===`);
  await assertPartitionsExist(salesByMonth);

  // 10a: insert new sets
  const newSetRows = setsToCreate.map((s) => ({
    brand_id: s.brand_id,
    name: s.name,
    sport: s.sport,
    release_date: `${s.year}-01-01`,
    source: 'cowork_collection',
    confidence: 'medium',
    external_ids: {
      first_seen_at: now,
      cowork_session: COWORK_SESSION,
      import_run_id: RUN_ID,
    },
  }));

  let setsInserted = 0;
  for (let i = 0; i < newSetRows.length; i += SET_CHUNK) {
    const chunk = newSetRows.slice(i, i + SET_CHUNK);
    const { data, error } = await supabase
      .from('sets')
      .insert(chunk)
      .select('id, brand_id, name, sport, release_date');
    if (error) {
      console.error(`! sets insert chunk @${i} failed:`, error);
      process.exit(1);
    }
    for (const r of data ?? []) {
      const year = new Date(r.release_date).getUTCFullYear();
      const k = setKey(r.brand_id, r.name, r.sport!, year);
      setKeyToId.set(k, r.id);
      setsInserted++;
    }
  }
  console.log(`  inserted ${setsInserted} new sets`);

  // 10b: insert cards
  const cardCandidates = [...cardMap.values()];
  const cardRows = cardCandidates.map((c) => {
    const rarity = c.rarities[0] ?? null;
    const setId = setKeyToId.get(c.setKey);
    if (!setId) throw new Error(`no set_id resolved for card key: ${c.key}`);
    return {
      set_id: setId,
      brand_id: c.brand_id,
      category: 'sports',
      name: c.name,
      card_number: c.card_number,
      rarity,
      tier: 'sports',
      popularity_score: popularityFor(rarity),
      heating_up_score: 0,
      last_price_check_at: null,
      external_ids: {
        cowork_listing_url: c.listing_urls[0],
        observed_psa_grades: [...c.psa_grades],
        import_run_id: RUN_ID,
      },
    };
  });

  const cardKeyToId = new Map<string, string>();
  let cardsInserted = 0;
  for (let i = 0; i < cardRows.length; i += CARD_CHUNK) {
    const chunk = cardRows.slice(i, i + CARD_CHUNK);
    const { data, error } = await supabase.from('cards').insert(chunk).select('id');
    if (error) {
      console.error(`! cards insert chunk @${i} failed:`, error);
      console.error(`  Run cleanup queries above to roll back.`);
      process.exit(1);
    }
    const returned = data ?? [];
    if (returned.length !== chunk.length) {
      console.error(`! cards insert chunk @${i}: expected ${chunk.length}, got ${returned.length}`);
      process.exit(1);
    }
    for (let j = 0; j < returned.length; j++) {
      cardKeyToId.set(cardCandidates[i + j].key, returned[j].id);
      cardsInserted++;
    }
  }
  console.log(`  inserted ${cardsInserted} new cards`);

  // 10c: insert price_history
  const phRows = filtered.map((r) => {
    const brandId = manufacturerToBrandId(r.manufacturer);
    const sk = setKey(brandId, r.set_name, r.sport, r.year);
    const ck = cardKey(sk, r.card_number, r.name);
    const cardId = cardKeyToId.get(ck);
    if (!cardId) throw new Error(`no card_id resolved for sale: ${ck}`);
    const truncTitle = r.listing_title.length > 200 ? r.listing_title.slice(0, 200) : r.listing_title;
    return {
      card_id: cardId,
      price: parseFloat(r.sale_price),
      source: 'cowork_collection',
      condition: r.psa_grade ? 'graded' : 'raw',
      recorded_at: `${r.sale_date}T00:00:00Z`,
      external_ids: {
        listing_url: r.listing_url,
        psa_grade: r.psa_grade,
        listing_title: truncTitle,
        import_run_id: RUN_ID,
      },
    };
  });

  let phInserted = 0;
  for (let i = 0; i < phRows.length; i += PH_CHUNK) {
    const chunk = phRows.slice(i, i + PH_CHUNK);
    const { error } = await supabase.from('price_history').insert(chunk);
    if (error) {
      console.error(`! price_history insert chunk @${i} failed:`, error);
      console.error(`  Run cleanup queries above to roll back.`);
      process.exit(1);
    }
    phInserted += chunk.length;
  }
  console.log(`  inserted ${phInserted} price_history rows`);

  // -------------------------------------------------------------------------
  // Step 11: verify + spot-check
  // -------------------------------------------------------------------------
  console.log(`\n=== VERIFICATION ===`);
  const { count: setsCowork } = await supabase
    .from('sets')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'cowork_collection');
  const { count: cardsSports } = await supabase
    .from('cards')
    .select('id', { count: 'exact', head: true })
    .eq('tier', 'sports');
  const { count: phCowork } = await supabase
    .from('price_history')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'cowork_collection');

  console.log(`sets   source='cowork_collection':            ${setsCowork}  (expected ${setsInserted})`);
  console.log(`cards  tier='sports':                         ${cardsSports}  (expected ${cardsInserted})`);
  console.log(`price_history source='cowork_collection':     ${phCowork}  (expected ${phInserted})`);

  if (setsCowork !== setsInserted || cardsSports !== cardsInserted || phCowork !== phInserted) {
    console.error(`! count mismatch — investigate before treating import as successful`);
  }

  console.log(`\n=== SPOT CHECK (5 random cards) ===`);
  const cardIdSample = pickRandom([...cardKeyToId.values()], 5);
  const { data: spot, error: spotErr } = await supabase
    .from('cards')
    .select('id, name, card_number, rarity, tier, category, popularity_score, set_id, external_ids, brand_id')
    .in('id', cardIdSample);
  if (spotErr) console.error(`! spot-check query failed:`, spotErr);
  else console.log(JSON.stringify(spot, null, 2));

  console.log(`\n> done. run_id=${RUN_ID}`);
}

main().catch((err) => {
  console.error('\nImport failed:', err.message ?? err);
  process.exit(1);
});
