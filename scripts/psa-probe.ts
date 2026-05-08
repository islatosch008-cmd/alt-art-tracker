// One-off PSA Public API probe — confirms the real endpoint paths and
// response shapes for pop reports + recent sales against a known
// public spec_id. Output drives the corrections to _shared/psa.ts.
//
// Confirmed results from initial run (2026-05-08, spec_id=8105805):
//   ✅ POP REPORT  /pop/GetPSASpecPopulation/{specID}  HTTP 200
//        Returns flat object: { SpecID, Description,
//          PSAPop: { Total, Auth, GradeN, GradeN_5, GradeNQ, ... } }
//   ❌ All /spec/* and /aprs/* candidate paths   HTTP 404
//        Recent sales (APRs) endpoint is unknown — likely behind a
//        separate API tier than the standard Public API token.
//   ⚠️ Quota headers   none returned
//        PSA does NOT expose x-ratelimit-*, x-quota-*, or retry-after
//        headers on 200 responses. Quota observation must be via PSA's
//        developer dashboard, not response inspection.
//
// Why this script exists:
//   _shared/psa.ts has TODO comments on two endpoints because PSA's
//   Public API URL surface differs by tier and by endpoint family. The
//   helpers' guessed paths (getPopReport → /pop/GetPSASpecPopulation,
//   getRecentSales → /aprs/GetByPSASpec) need field validation before
//   we deploy real scrapers.
//
// What it does:
//   For a single spec_id (default 8105805, publicly listed at
//   psacard.com/spec/psa/8105805), hit each candidate endpoint path
//   for pop reports and recent sales. Capture status, quota-relevant
//   headers, and full response body. Print so we can eyeball the
//   correct shape and pick the canonical endpoint.
//
// Usage:
//   npx tsx --env-file=supabase/functions/.env scripts/psa-probe.ts
//   npx tsx --env-file=supabase/functions/.env scripts/psa-probe.ts 8105805
//
// Quota note: each endpoint family gets ONE call, not N×M. Worst case
// is ~6 quota units if every probe path is independently tracked.

const TOKEN = process.env.PSA_API_TOKEN;
const BASE = 'https://api.psacard.com/publicapi';

if (!TOKEN) {
  console.error('Missing PSA_API_TOKEN in env');
  process.exit(1);
}

const specId = process.argv[2] ?? '8105805';
console.log(`PSA probe — spec_id=${specId}\n`);

// Headers that surface quota / rate-limit info on PSA responses.
// Names guessed from common API conventions; print whatever's there.
const QUOTA_HEADER_PATTERNS = /^(x-ratelimit|x-quota|x-call|retry-after)/i;

async function probe(label: string, path: string): Promise<void> {
  const url = `${BASE}${path}`;
  console.log(`──────────────────────────────────────────────`);
  console.log(`▶ ${label}`);
  console.log(`  GET ${url}`);
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/json',
      },
    });
    console.log(`  HTTP ${res.status} ${res.statusText}`);
    // Surface quota headers if present.
    const matchedHeaders: [string, string][] = [];
    res.headers.forEach((v, k) => {
      if (QUOTA_HEADER_PATTERNS.test(k)) matchedHeaders.push([k, v]);
    });
    if (matchedHeaders.length > 0) {
      console.log('  quota-relevant headers:');
      for (const [k, v] of matchedHeaders) {
        console.log(`    ${k}: ${v}`);
      }
    } else {
      console.log('  (no quota-relevant headers found in response)');
    }
    const text = await res.text();
    if (text.length === 0) {
      console.log('  body: (empty)');
    } else if (text.length > 4000) {
      console.log(`  body (first 4000 of ${text.length} chars):`);
      console.log(text.slice(0, 4000));
      console.log('  ... [truncated]');
    } else {
      console.log('  body:');
      console.log(text);
    }
  } catch (e) {
    console.log(`  THREW: ${(e as Error).message}`);
  }
  console.log('');
}

async function main(): Promise<void> {
  // Pop report candidates — try most likely first (matches helper's guess),
  // then fall back to common alternates. PSA's docs show variants by tier.
  await probe(
    'POP REPORT — current helper guess',
    `/pop/GetPSASpecPopulation/${encodeURIComponent(specId)}`,
  );
  await probe(
    'POP REPORT — alt 1',
    `/pop/GetSpecPopBySpecID/${encodeURIComponent(specId)}`,
  );
  await probe(
    'POP REPORT — alt 2',
    `/pop/GetSpecPopulationBySpecID/${encodeURIComponent(specId)}`,
  );

  // Spec lookup — useful for confirming the spec_id is valid before
  // attributing failures to wrong endpoints.
  await probe(
    'SPEC LOOKUP — confirm spec_id is valid',
    `/spec/GetBySpecID/${encodeURIComponent(specId)}`,
  );

  // Recent sales (Auction Prices Realized) candidates.
  await probe(
    'RECENT SALES — current helper guess',
    `/aprs/GetByPSASpec/${encodeURIComponent(specId)}`,
  );
  await probe(
    'RECENT SALES — alt 1 (count param)',
    `/aprs/GetByPSASpec/${encodeURIComponent(specId)}/10`,
  );
  await probe(
    'RECENT SALES — alt 2',
    `/aprs/GetBySpecID/${encodeURIComponent(specId)}`,
  );

  console.log('──────────────────────────────────────────────');
  console.log('Done. Use the 200 OK responses above to confirm canonical paths.');
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
