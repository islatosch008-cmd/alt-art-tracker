// DIAGNOSTIC SCRIPT (not part of normal cron / function flow).
//
// One-off probe: figure out which OAuth scope authorizes eBay's
// notification public-key endpoint. Use when the webhook starts
// returning 401/403 from the public-key fetch (suggests scope drift
// after eBay API changes).
//
//   npx tsx --env-file=supabase/functions/.env \
//     scripts/diagnostics/ebay-publickey-probe.ts
//
//
// Background: ebay-deletion-webhook's POST handler fetched a public
// key with SCOPE_BROWSE='https://api.ebay.com/oauth/api_scope' and
// got a non-200 response, surfacing as 500 "Verification infra error"
// for real eBay POSTs. Either the scope is wrong, the token format
// is wrong, or the endpoint URL is wrong.
//
// This script tries multiple scopes against eBay's token endpoint
// and the public-key endpoint, reporting which one works. We don't
// need a real kid — we use a placeholder; eBay should return 404 if
// the kid doesn't exist, 401/403 if scope/auth is wrong.

const CLIENT_ID = process.env.EBAY_CLIENT_ID;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing EBAY_CLIENT_ID / EBAY_CLIENT_SECRET');
  process.exit(1);
}

const SCOPES_TO_TRY = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/commerce.notification.subscription',
  'https://api.ebay.com/oauth/api_scope/commerce.notification.subscription.readonly',
];

async function getToken(scope: string): Promise<{ status: number; body: string }> {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
  });
  return { status: res.status, body: await res.text() };
}

async function tryFetchPubKey(token: string, kid = 'placeholder_kid_for_probe'): Promise<{ status: number; body: string }> {
  const res = await fetch(
    `https://api.ebay.com/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  return { status: res.status, body: (await res.text()).slice(0, 400) };
}

async function main() {
  for (const scope of SCOPES_TO_TRY) {
    console.log('──────────────────────────────────────────────');
    console.log(`▶ scope=${scope}`);
    const tokenResp = await getToken(scope);
    console.log(`  token endpoint: HTTP ${tokenResp.status}`);
    if (tokenResp.status !== 200) {
      console.log(`  body: ${tokenResp.body.slice(0, 300)}`);
      continue;
    }
    let token: string;
    try {
      token = (JSON.parse(tokenResp.body) as { access_token: string }).access_token;
      console.log(`  got token (length ${token.length})`);
    } catch {
      console.log(`  could not parse token from body`);
      continue;
    }
    const keyResp = await tryFetchPubKey(token);
    console.log(`  public_key endpoint: HTTP ${keyResp.status}`);
    console.log(`  body: ${keyResp.body}`);
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
