// One-off eBay API probe — confirms credentials work and surfaces the
// real response shapes for Browse + Marketplace Insights so we can
// patch _shared/ebay.ts based on field-tested data rather than docs.
//
// Confirms:
//   1. OAuth client_credentials token fetch (basic + insights scopes)
//   2. Browse API search (active listings, always available)
//   3. Marketplace Insights search (sold listings, requires approval —
//      403 with "Insufficient permissions" is the "not approved yet"
//      signal)
//   4. Rate-limit / quota headers on each response
//
// Reads from process.env (loaded via tsx --env-file). Never logs the
// access token or client secret. Quotas + status + response shape
// only.
//
// Usage:
//   npx tsx --env-file=supabase/functions/.env scripts/ebay-probe.ts
//   npx tsx --env-file=supabase/functions/.env scripts/ebay-probe.ts "charizard ex"

const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
const ENV = process.env.EBAY_ENVIRONMENT ?? 'production';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing EBAY_CLIENT_ID and/or EBAY_CLIENT_SECRET in env');
  process.exit(1);
}

const QUERY = process.argv[2] ?? 'pokemon charizard ex';

const HOST = ENV === 'production' ? 'api.ebay.com' : 'api.sandbox.ebay.com';
const OAUTH_URL = `https://${HOST}/identity/v1/oauth2/token`;
const BROWSE_URL = `https://${HOST}/buy/browse/v1/item_summary/search`;
const INSIGHTS_URL = `https://${HOST}/buy/marketplace_insights/v1_beta/item_sales/search`;

const SCOPE_BROWSE = `https://${HOST.replace('api.', '')}/oauth/api_scope`;
// Note: even sandbox uses api.ebay.com host for the scope URL — but the
// helper in _shared/ebay.ts uses api.ebay.com regardless. Use the
// same convention here.
const ACTUAL_SCOPE_BROWSE = 'https://api.ebay.com/oauth/api_scope';
const ACTUAL_SCOPE_INSIGHTS =
  'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights';

console.log(`eBay probe — env=${ENV}  query="${QUERY}"\n`);

// Quota-related header pattern. eBay's Browse + Insights APIs sometimes
// return X-EBAY-C-* headers; OAuth returns nothing relevant. We capture
// any header matching this pattern so we don't miss new ones.
const QUOTA_HEADER_PATTERN = /^(x-ebay|x-ratelimit|retry-after|x-quota)/i;

function showQuotaHeaders(res: Response): void {
  const matched: [string, string][] = [];
  res.headers.forEach((v, k) => {
    if (QUOTA_HEADER_PATTERN.test(k)) matched.push([k, v]);
  });
  if (matched.length > 0) {
    console.log('  quota-relevant headers:');
    for (const [k, v] of matched) console.log(`    ${k}: ${v}`);
  } else {
    console.log('  (no quota-relevant headers in response)');
  }
}

async function probeOAuth(scope: string, label: string): Promise<string | null> {
  console.log(`──────────────────────────────────────────────`);
  console.log(`▶ OAuth token (${label})`);
  console.log(`  scope: ${scope}`);
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch(OAUTH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
  });
  console.log(`  HTTP ${res.status} ${res.statusText}`);
  showQuotaHeaders(res);
  const text = await res.text();
  if (!res.ok) {
    console.log(`  body (${text.length} bytes):`);
    console.log(text.slice(0, 1000));
    console.log('');
    return null;
  }
  // Don't log the token. Show shape only.
  try {
    const json = JSON.parse(text) as { token_type?: string; expires_in?: number };
    console.log(`  token_type: ${json.token_type ?? '(missing)'}`);
    console.log(`  expires_in: ${json.expires_in ?? '(missing)'} sec`);
  } catch {
    console.log('  (response not parseable JSON)');
  }
  console.log('');
  return JSON.parse(text).access_token as string;
}

async function probeBrowse(token: string): Promise<void> {
  console.log(`──────────────────────────────────────────────`);
  console.log(`▶ Browse API — active listings`);
  const params = new URLSearchParams({ q: QUERY, limit: '5' });
  const url = `${BROWSE_URL}?${params}`;
  console.log(`  GET ${url}`);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });
  console.log(`  HTTP ${res.status} ${res.statusText}`);
  showQuotaHeaders(res);
  const text = await res.text();
  if (!res.ok) {
    console.log(`  body (${text.length} bytes):`);
    console.log(text.slice(0, 1500));
    console.log('');
    return;
  }
  try {
    const json = JSON.parse(text) as {
      total?: number;
      itemSummaries?: Array<Record<string, unknown>>;
    };
    console.log(`  total: ${json.total ?? '(missing)'}`);
    console.log(`  itemSummaries.length: ${json.itemSummaries?.length ?? 0}`);
    if (json.itemSummaries && json.itemSummaries.length > 0) {
      console.log('  first item shape (keys):');
      console.log('    ' + Object.keys(json.itemSummaries[0]).join(', '));
      console.log('  first item (full, for shape inspection):');
      console.log(
        JSON.stringify(json.itemSummaries[0], null, 2)
          .split('\n')
          .map((l) => '    ' + l)
          .join('\n'),
      );
    }
  } catch (e) {
    console.log(`  parse failed: ${(e as Error).message}`);
    console.log(text.slice(0, 1000));
  }
  console.log('');
}

async function probeInsights(token: string): Promise<void> {
  console.log(`──────────────────────────────────────────────`);
  console.log(`▶ Marketplace Insights — sold listings`);
  const params = new URLSearchParams({ q: QUERY, limit: '5' });
  const url = `${INSIGHTS_URL}?${params}`;
  console.log(`  GET ${url}`);
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
    },
  });
  console.log(`  HTTP ${res.status} ${res.statusText}`);
  showQuotaHeaders(res);
  const text = await res.text();
  if (!res.ok) {
    console.log(`  body (${text.length} bytes):`);
    console.log(text.slice(0, 1500));
    if (res.status === 403 || res.status === 401) {
      console.log('');
      console.log(
        '  ❗ Likely "Marketplace Insights not approved" for this app —',
      );
      console.log(
        '     this is expected if you have not been granted access yet.',
      );
      console.log(
        '     Request access at developer.ebay.com → Application',
      );
      console.log(
        '     Access Request → Marketplace Insights API.',
      );
    }
    console.log('');
    return;
  }
  try {
    const json = JSON.parse(text) as {
      total?: number;
      itemSales?: Array<Record<string, unknown>>;
    };
    console.log(`  total: ${json.total ?? '(missing)'}`);
    console.log(`  itemSales.length: ${json.itemSales?.length ?? 0}`);
    if (json.itemSales && json.itemSales.length > 0) {
      console.log('  first sale shape (keys):');
      console.log('    ' + Object.keys(json.itemSales[0]).join(', '));
      console.log('  first sale (full):');
      console.log(
        JSON.stringify(json.itemSales[0], null, 2)
          .split('\n')
          .map((l) => '    ' + l)
          .join('\n'),
      );
    }
  } catch (e) {
    console.log(`  parse failed: ${(e as Error).message}`);
    console.log(text.slice(0, 1000));
  }
  console.log('');
}

async function main(): Promise<void> {
  const browseToken = await probeOAuth(ACTUAL_SCOPE_BROWSE, 'basic / Browse');
  if (browseToken) {
    await probeBrowse(browseToken);
  } else {
    console.log('  (skipping Browse probe — OAuth failed)\n');
  }

  // Try the insights scope — if eBay rejects it at OAuth, we know we
  // don't have approval. If it grants the token but Insights API
  // returns 403, that's a different signal.
  const insightsToken = await probeOAuth(
    ACTUAL_SCOPE_INSIGHTS,
    'insights / Marketplace Insights',
  );
  if (insightsToken) {
    await probeInsights(insightsToken);
  } else {
    console.log('  (skipping Insights probe — OAuth scope grant failed)\n');
  }

  console.log(`──────────────────────────────────────────────`);
  console.log('Probe done. Next: patch _shared/ebay.ts based on the shapes above');
  console.log('(or accept current shapes if they match).');
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
