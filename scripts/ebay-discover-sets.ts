// P6 — eBay-driven sealed-box catalog discovery via major hobby retailers.
//
// One-off script (NOT an Edge Function). Pulls active sealed-box
// listings from `dacardworld` and `blowoutcards` (verified clean
// retailers — see Step 1 verification log), classifies each listing
// by detected manufacturer, extracts canonical set names, and proposes
// inserts to the sets table.
//
// USAGE
// =====
//   # Dry run (default — JSONL output to stdout, no DB writes):
//   tmpenv=$(mktemp)
//   cat supabase/functions/.env > "$tmpenv"
//   grep -E '^SUPABASE_URL=|^SUPABASE_SERVICE_ROLE_KEY=' .env.local >> "$tmpenv"
//   npx tsx --env-file="$tmpenv" scripts/ebay-discover-sets.ts > /tmp/p6.jsonl
//
//   # After review, insert Fanatics + Leaf only:
//   npx tsx --env-file="$tmpenv" scripts/ebay-discover-sets.ts --insert
//
// MANUFACTURER PRIORITY
// =====================
// Listings get classified by the FIRST manufacturer keyword found in
// title (Panini > Topps > Bowman > Upper Deck > Donruss > Leaf >
// Fanatics). Fanatics is lowest priority because "Fanatics" in card
// titles usually marks a Panini retail-exclusive (e.g., "PANINI PHOENIX
// FOOTBALL FANATICS BOX SET") rather than a standalone Fanatics
// product. Matching Panini first keeps these classified as Panini.
//
// INSERT POLICY (Phase 1 plan)
// ============================
// Only Fanatics + Leaf get insert_eligible=true (no existing entries
// on prod, no fuzzy-match conflicts). Topps, Panini, Bowman, Upper
// Deck, Donruss surface in the dry-run as REPORT-ONLY — eBay-discovery
// entries would conflict with yesterday's AI-research entries; that
// reconciliation is a future cleanup task.

const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing EBAY_CLIENT_ID / EBAY_CLIENT_SECRET');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_*_KEY');
  process.exit(1);
}

const INSERT_MODE = process.argv.includes('--insert');

// Optional --min-year=YYYY flag. Filters proposals (and inserts) to
// year >= MIN_YEAR. Used for "modern only" insert runs that drop
// vintage entries from the catalog. Default: no filter (include
// vintage in dry-run output).
const MIN_YEAR_ARG = process.argv.find((a) => a.startsWith('--min-year='));
const MIN_YEAR = MIN_YEAR_ARG ? parseInt(MIN_YEAR_ARG.split('=')[1], 10) : 0;

const RETAILERS = ['dacardworld', 'blowoutcards'];
const CATEGORY_SPORTS_BOXES = '213';
const PER_PAGE = 200;
const MAX_PER_RETAILER = 1000;

// Manufacturer priority — first match in title wins. Lowercase compare.
const MANUFACTURERS: Array<{ key: string; brand_id: string; aliases: string[] }> = [
  { key: 'Panini', brand_id: 'panini', aliases: ['panini'] },
  { key: 'Topps', brand_id: 'topps', aliases: ['topps'] },
  { key: 'Bowman', brand_id: 'bowman', aliases: ['bowman'] },
  { key: 'Upper Deck', brand_id: 'upper_deck', aliases: ['upper deck', 'upperdeck'] },
  { key: 'Donruss', brand_id: 'donruss', aliases: ['donruss'] },
  { key: 'Leaf', brand_id: 'leaf', aliases: ['leaf'] },
  { key: 'Fanatics', brand_id: 'fanatics', aliases: ['fanatics'] },
];

const INSERT_ELIGIBLE_BRANDS = new Set(['leaf', 'fanatics']);

// Product lines per manufacturer — longest-first within each list.
const PRODUCT_LINES: Record<string, string[]> = {
  panini: [
    'Donruss Optic', 'Rookies & Stars', 'National Treasures', 'Crown Royale',
    'Phoenix', 'Prizm', 'Mosaic', 'Select', 'Optic', 'Donruss', 'Contenders',
    'Immaculate', 'Flawless', 'Origins', 'Obsidian', 'Spectra', 'Absolute',
    'Limited', 'Playbook', 'Score', 'Chronicles', 'Certified',
  ],
  topps: [
    'Stadium Club', 'Allen & Ginter', 'Tier One', 'Triple Threads', 'Series 1',
    'Series 2', 'Garbage Pail Kids', 'Chrome', 'Heritage', 'Update', 'Finest',
    'Definitive', 'Dynasty', 'Pristine', 'Now',
  ],
  bowman: [
    'Chrome HTA', 'Draft', 'University', 'Sterling', 'Heritage', 'Platinum',
    'Mega Box', 'Best', '1st Edition', 'Chrome',
  ],
  upper_deck: [
    'SP Authentic', 'Series 1', 'Series 2', 'O-Pee-Chee', 'The Cup',
    'Black Diamond', 'Optichrome', 'Synergy', 'Trilogy', 'Premier', 'Skybox',
    'SPx', 'MVP',
  ],
  donruss: ['Optic', 'Elite', 'Rated Rookie'],
  leaf: [
    'Metal Draft', 'In The Game', 'Best of Boxing', 'Trinity', 'Metal',
    'Pearl', 'Maple', 'Ultimate', 'Origins', 'Valiant', 'Optichrome',
    'Nostalgia', 'Vibrance', 'Inscriptions', 'Immortal', 'Pro Set',
  ],
  fanatics: [],
};

// Sport detection — first match wins.
const SPORTS: Array<{ key: string; aliases: string[] }> = [
  { key: 'Football', aliases: ['football', 'nfl'] },
  { key: 'Basketball', aliases: ['basketball', 'nba', 'wnba'] },
  { key: 'Baseball', aliases: ['baseball', 'mlb', 'mlbpa'] },
  { key: 'Hockey', aliases: ['hockey', 'nhl'] },
  { key: 'Soccer', aliases: ['soccer', 'mls', 'fifa', 'uefa', 'premier league'] },
  { key: 'Wrestling', aliases: ['wrestling', 'wwe', 'aew'] },
  { key: 'UFC', aliases: ['ufc', 'mma'] },
  { key: 'Racing', aliases: ['racing', 'nascar', 'formula 1', 'f1'] },
  { key: 'Multi-sport', aliases: ['multi-sport', 'multisport'] },
];

const BOX_TYPE_PATTERNS: Array<{ pattern: RegExp; key: string }> = [
  { pattern: /\bhobby\s+box\b/i, key: 'hobby' },
  { pattern: /\bjumbo\s+box\b/i, key: 'jumbo' },
  { pattern: /\bmega\s+box\b/i, key: 'mega' },
  { pattern: /\bblaster(\s+box)?\b/i, key: 'blaster' },
  { pattern: /\bhanger\s+box\b/i, key: 'hanger' },
  { pattern: /\bcase\b/i, key: 'case' },
  { pattern: /\bbox\b/i, key: 'other' },
];

// ---------------------------------------------------------------------

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getOAuthToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body:
      'grant_type=client_credentials&scope=' +
      encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
  });
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000 * 0.9,
  };
  return cachedToken.value;
}

type EbayItem = {
  itemId: string;
  title: string;
  price: { value: string; currency: string };
};

async function fetchSellerListings(seller: string): Promise<EbayItem[]> {
  const token = await getOAuthToken();
  const items: EbayItem[] = [];
  let offset = 0;
  while (offset < MAX_PER_RETAILER) {
    const params = new URLSearchParams({
      category_ids: CATEGORY_SPORTS_BOXES,
      limit: String(PER_PAGE),
      offset: String(offset),
      filter: `sellers:{${seller}}`,
    });
    const res = await fetch(
      `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        },
      },
    );
    if (!res.ok) {
      console.error(`  ${seller} offset=${offset}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
      break;
    }
    const json = (await res.json()) as {
      total?: number;
      itemSummaries?: EbayItem[];
    };
    const page = json.itemSummaries ?? [];
    items.push(...page);
    process.stderr.write(`    ${seller} offset=${offset}: +${page.length} (running total ${items.length}, eBay total ${json.total ?? '?'})\n`);
    if (page.length < PER_PAGE) break;
    offset += PER_PAGE;
  }
  return items;
}

// Detect manufacturer using priority order. Returns null if no match.
function detectManufacturer(title: string): { key: string; brand_id: string } | null {
  const lower = title.toLowerCase();
  for (const m of MANUFACTURERS) {
    for (const a of m.aliases) {
      if (lower.includes(a)) return { key: m.key, brand_id: m.brand_id };
    }
  }
  return null;
}

function detectYear(title: string): number | null {
  // Match "2024", "2024-25", "2024/25" — take first year.
  const m = title.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

function detectSport(title: string): string | null {
  const lower = title.toLowerCase();
  for (const s of SPORTS) {
    for (const a of s.aliases) {
      // word boundary to avoid matching "ufc" inside other words
      const re = new RegExp(`\\b${a}\\b`);
      if (re.test(lower)) return s.key;
    }
  }
  return null;
}

function detectProductLine(title: string, brand_id: string): string | null {
  const lines = PRODUCT_LINES[brand_id] ?? [];
  const lower = title.toLowerCase();
  for (const line of lines) {
    if (lower.includes(line.toLowerCase())) return line;
  }
  return null;
}

function detectBoxType(title: string): { canonical_suffix: string; key: string } {
  for (const p of BOX_TYPE_PATTERNS) {
    if (p.pattern.test(title)) {
      const suffix = p.key === 'hobby' ? 'Hobby Box'
        : p.key === 'jumbo' ? 'Jumbo Box'
        : p.key === 'mega' ? 'Mega Box'
        : p.key === 'blaster' ? 'Blaster Box'
        : p.key === 'hanger' ? 'Hanger Box'
        : p.key === 'case' ? 'Case'
        : 'Box';
      return { canonical_suffix: suffix, key: p.key };
    }
  }
  return { canonical_suffix: 'Box', key: 'other' };
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

// ---------------------------------------------------------------------

type Bucket = {
  detected_manufacturer: string;
  brand_id: string;
  year: number;
  sport: string;
  canonical_name: string;
  box_type: string;
  retailers: Set<string>;
  prices: number[];
  sample_titles: string[];
  listings_count: number;
};

async function main() {
  console.error(`# eBay set discovery (retailer-based) — ${INSERT_MODE ? 'INSERT MODE' : 'DRY RUN'}`);
  console.error(`# Retailers: ${RETAILERS.join(', ')}`);
  console.error(`# Per-retailer cap: ${MAX_PER_RETAILER} listings`);
  console.error('');

  const buckets = new Map<string, Bucket>();
  const perRetailerCounts: Record<string, number> = {};
  const skipReasons: Record<string, number> = {};
  const skip = (reason: string) => {
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1;
  };

  for (const seller of RETAILERS) {
    console.error(`# Fetching from ${seller}...`);
    const items = await fetchSellerListings(seller);
    perRetailerCounts[seller] = items.length;
    console.error(`  ${seller} returned ${items.length} listings`);

    for (const item of items) {
      const title = item.title;
      const mfr = detectManufacturer(title);
      if (!mfr) {
        skip('no_manufacturer');
        continue;
      }
      const year = detectYear(title);
      if (!year) {
        skip('no_year');
        continue;
      }
      const sport = detectSport(title);
      if (!sport) {
        skip('no_sport');
        continue;
      }
      const boxType = detectBoxType(title);
      const productLine = detectProductLine(title, mfr.brand_id);

      // Build canonical name
      const parts: string[] = [String(year), mfr.key];
      if (productLine) parts.push(productLine);
      parts.push(sport);
      parts.push(boxType.canonical_suffix);
      const canonicalName = parts.join(' ');

      const key = `${mfr.brand_id}|${year}|${sport.toLowerCase()}|${canonicalName.toLowerCase()}|${boxType.key}`;
      let b = buckets.get(key);
      if (!b) {
        b = {
          detected_manufacturer: mfr.key,
          brand_id: mfr.brand_id,
          year,
          sport,
          canonical_name: canonicalName,
          box_type: boxType.key,
          retailers: new Set(),
          prices: [],
          sample_titles: [],
          listings_count: 0,
        };
        buckets.set(key, b);
      }
      b.retailers.add(seller);
      b.listings_count++;
      const price = parseFloat(item.price?.value ?? '');
      if (Number.isFinite(price) && price > 0) b.prices.push(price);
      if (b.sample_titles.length < 3) b.sample_titles.push(title);
    }
  }

  console.error('');
  console.error(`# Aggregation: ${buckets.size} canonical buckets formed from ${Object.values(perRetailerCounts).reduce((a, b) => a + b, 0)} total listings`);
  console.error('# Skip reasons:');
  for (const [r, n] of Object.entries(skipReasons)) {
    console.error(`    ${r}: ${n}`);
  }
  console.error('');

  // Build proposals
  type Proposal = {
    detected_manufacturer: string;
    brand_id: string;
    year: number;
    sport: string;
    canonical_name: string;
    box_type: string;
    listings_count: number;
    median_price: string;
    retailers: string[];
    insert_eligible: boolean;
    fuzzy_match_warning: string | null;
    sample_titles: string[];
  };

  const proposals: Proposal[] = [];
  for (const b of buckets.values()) {
    const med = median(b.prices);
    proposals.push({
      detected_manufacturer: b.detected_manufacturer,
      brand_id: b.brand_id,
      year: b.year,
      sport: b.sport,
      canonical_name: b.canonical_name,
      box_type: b.box_type,
      listings_count: b.listings_count,
      median_price: med != null ? `$${med.toFixed(2)}` : 'n/a',
      retailers: Array.from(b.retailers).sort(),
      insert_eligible: INSERT_ELIGIBLE_BRANDS.has(b.brand_id),
      fuzzy_match_warning: null, // computed below for fanatics+leaf
      sample_titles: b.sample_titles,
    });
  }

  // Fuzzy match insert-eligible proposals against existing same-brand sets
  const eligibleBrandIds = Array.from(new Set(proposals.filter((p) => p.insert_eligible).map((p) => p.brand_id)));
  if (eligibleBrandIds.length > 0) {
    const url = `${SUPABASE_URL}/rest/v1/sets?brand_id=in.(${eligibleBrandIds.join(',')})&select=id,name,brand_id&limit=2000`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    });
    if (res.ok) {
      const existing = (await res.json()) as Array<{ id: string; name: string; brand_id: string }>;
      console.error(`# Existing eligible-brand sets fetched: ${existing.length}`);
      for (const p of proposals) {
        if (!p.insert_eligible) continue;
        // Levenshtein-style fuzzy match
        const target = p.canonical_name.toLowerCase();
        let best: { name: string; distance: number } | null = null;
        for (const e of existing) {
          if (e.brand_id !== p.brand_id) continue;
          const dist = levenshtein(target, e.name.toLowerCase());
          if (best === null || dist < best.distance) {
            best = { name: e.name, distance: dist };
          }
        }
        if (best && best.distance < 3) {
          p.fuzzy_match_warning = `near-duplicate of existing "${best.name}" (distance ${best.distance})`;
        }
      }
    }
  }

  // Sort proposals: insert-eligible first, then by manufacturer/year/sport
  proposals.sort((a, b) => {
    if (a.insert_eligible !== b.insert_eligible) return a.insert_eligible ? -1 : 1;
    if (a.detected_manufacturer !== b.detected_manufacturer) return a.detected_manufacturer.localeCompare(b.detected_manufacturer);
    if (a.year !== b.year) return a.year - b.year;
    return a.sport.localeCompare(b.sport);
  });

  // Output JSONL
  for (const p of proposals) {
    process.stdout.write(JSON.stringify(p) + '\n');
  }

  // Summary to stderr
  console.error('');
  console.error('# Summary');
  console.error(`  Per retailer:`);
  for (const [r, n] of Object.entries(perRetailerCounts)) {
    console.error(`    ${r}: ${n} listings fetched`);
  }
  const byMfr: Record<string, number> = {};
  const byYear: Record<number, number> = {};
  const bySport: Record<string, number> = {};
  let eligible = 0;
  let reportOnly = 0;
  for (const p of proposals) {
    byMfr[p.detected_manufacturer] = (byMfr[p.detected_manufacturer] ?? 0) + 1;
    byYear[p.year] = (byYear[p.year] ?? 0) + 1;
    bySport[p.sport] = (bySport[p.sport] ?? 0) + 1;
    if (p.insert_eligible) eligible++;
    else reportOnly++;
  }
  console.error(`  Per manufacturer (proposals):`);
  for (const m of MANUFACTURERS) {
    const n = byMfr[m.key] ?? 0;
    if (n > 0) console.error(`    ${m.key}: ${n}`);
  }
  console.error(`  Per sport:`);
  for (const [s, n] of Object.entries(bySport).sort((a, b) => b[1] - a[1])) {
    console.error(`    ${s}: ${n}`);
  }
  console.error(`  Per year:`);
  for (const [y, n] of Object.entries(byYear).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.error(`    ${y}: ${n}`);
  }
  console.error(`  insert_eligible: ${eligible}    report_only: ${reportOnly}`);
  const fuzzyWarnings = proposals.filter((p) => p.insert_eligible && p.fuzzy_match_warning).length;
  if (fuzzyWarnings > 0) {
    console.error(`  Fuzzy-match warnings on eligible proposals: ${fuzzyWarnings}`);
  }

  if (!INSERT_MODE) {
    console.error('');
    console.error('# DRY RUN complete. Re-run with --insert to write Fanatics + Leaf proposals to sets table.');
    return;
  }

  // INSERT mode — only insert_eligible proposals (Fanatics + Leaf)
  console.error('');
  console.error(`# INSERT mode — writing eligible proposals to sets table${MIN_YEAR > 0 ? ` (year >= ${MIN_YEAR})` : ''}`);
  let inserted = 0;
  let skipped = 0;
  let filteredByYear = 0;
  for (const p of proposals) {
    if (!p.insert_eligible) continue;
    if (MIN_YEAR > 0 && p.year < MIN_YEAR) {
      filteredByYear++;
      continue;
    }
    if (p.fuzzy_match_warning) {
      skipped++;
      continue;
    }
    const sourceId = `${p.brand_id}|${p.year}|${p.sport.toLowerCase()}|${p.canonical_name.toLowerCase()}`;
    const row = {
      brand_id: p.brand_id,
      name: p.canonical_name,
      sport: p.sport.toLowerCase(),
      box_type: p.box_type === 'other' ? null : p.box_type,
      source: 'ebay_discovery',
      source_id: sourceId,
      confidence: 'medium',
      external_ids: {
        ebay_listing_count: p.listings_count,
        ebay_median_ask: p.median_price,
        ebay_retailers: p.retailers,
      },
    };
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sets`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (res.ok) {
      inserted++;
    } else {
      const text = await res.text();
      if (/duplicate key/.test(text)) {
        skipped++;
      } else {
        console.error(`  insert failed for "${p.canonical_name}": ${res.status} ${text.slice(0, 150)}`);
        skipped++;
      }
    }
  }
  console.error('');
  console.error(`# Inserted: ${inserted}`);
  console.error(`# Skipped (fuzzy/duplicate/error): ${skipped}`);
  if (filteredByYear > 0) {
    console.error(`# Filtered by --min-year=${MIN_YEAR}: ${filteredByYear}`);
  }
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp: number[] = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
