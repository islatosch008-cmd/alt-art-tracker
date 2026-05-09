// DIAGNOSTIC SCRIPT (not part of normal cron / function flow).
//
// WHEN TO USE
// ===========
// If ebay-deletion-webhook starts failing verify again (412 spike or
// Sentry "consecutive failure" alerts), pull the most recent
// diagnostic snapshot from prod:
//
//   select html_content
//   from public.scraper_html_snapshots
//   where source = 'ebay_deletion'
//     and reason = 'verify_returned_false'
//   order by fetched_at desc
//   limit 1;
//
// The snapshot has body_full, signature_full, parsed_kid, parsed_alg.
// Paste them into the constants below and run:
//
//   npx tsx --env-file=supabase/functions/.env \
//     scripts/diagnostics/ebay-verify-replay.ts
//
// The script fetches the matching public key from eBay and brute-forces
// SHA-1 / SHA-256 / SHA-384 / SHA-512 to find which hash verifies.
// Originally caught the SHA-1 issue on 2026-05-09 — eBay uses SHA-1
// for both RSA and ECDSA, contrary to the "ECDSA → SHA-256 by
// convention" assumption.

import { createPublicKey, createVerify } from 'node:crypto';

const CLIENT_ID = process.env.EBAY_CLIENT_ID!;
const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET!;

// Captured 2026-05-09T15:33ish from real eBay POST 412-path diagnostic.
const KID = '694fde55-7004-450e-ba7a-683f65ebbd9f';
const SIGNATURE_B64 =
  'MEYCIQDXFvEetsPLObq8TaK6zVqvnsROf1CvTUwgVLVL7QBbIAIhAL52nUVG1piugewnr+QFFxEqph6EnZCP7Y27Lz7qNAOC';
const BODY = '{"metadata":{"topic":"MARKETPLACE_ACCOUNT_DELETION","schemaVersion":"1.0","deprecated":false},"notification":{"notificationId":"93804709-3cb5-466e-9572-62150791cde1_44bc53bd-edf1-4c77-876b-eab3f03de39a","eventDate":"2026-05-09T15:17:41.454Z","publishDate":"2026-05-09T15:34:21.455Z","publishAttemptCount":3,"data":{"username":"daiscabana-0","userId":"xq9HyOsmTmG","eiasToken":"nY+sHZ2PrBmdj6wVnY+sEZ2PrA2dj6AClIWoCpKEpAmdj6x9nY+seQ=="}}}';

async function getOAuthToken(): Promise<string> {
  const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=' + encodeURIComponent('https://api.ebay.com/oauth/api_scope'),
  });
  if (!res.ok) throw new Error(`OAuth ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

async function fetchPubKey(token: string, kid: string): Promise<{ key: string; algorithm?: string; digest?: string }> {
  const res = await fetch(`https://api.ebay.com/commerce/notification/v1/public_key/${kid}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`pubkey ${res.status}: ${await res.text()}`);
  return await res.json();
}

function buildPem(rawKey: string): string {
  const body = rawKey
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const lines: string[] = [];
  for (let i = 0; i < body.length; i += 64) lines.push(body.slice(i, i + 64));
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}

async function main() {
  const token = await getOAuthToken();
  console.log('OAuth token acquired');
  const pubKeyResp = await fetchPubKey(token, KID);
  console.log('eBay public key response:');
  console.log('  algorithm:', pubKeyResp.algorithm);
  console.log('  digest:', pubKeyResp.digest);
  console.log('  key (raw):', JSON.stringify(pubKeyResp.key.slice(0, 80)) + (pubKeyResp.key.length > 80 ? '…' : ''));
  console.log('  key length:', pubKeyResp.key.length);
  console.log();

  const pem = buildPem(pubKeyResp.key);
  console.log('Reformatted PEM:');
  console.log(pem);
  console.log();

  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey({ key: pem, format: 'pem' });
    console.log('createPublicKey OK; key type:', publicKey.asymmetricKeyType);
    console.log();
  } catch (e) {
    console.error('createPublicKey threw:', (e as Error).message);
    return;
  }

  // Try multiple hash algorithms
  for (const hashAlg of ['SHA1', 'SHA256', 'SHA384', 'SHA512']) {
    const verify = createVerify(hashAlg);
    verify.update(BODY);
    verify.end();
    const ok = verify.verify(publicKey, SIGNATURE_B64, 'base64');
    console.log(`  ${hashAlg.padEnd(7)} → ${ok ? '✅ VERIFIED' : '❌ no match'}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
