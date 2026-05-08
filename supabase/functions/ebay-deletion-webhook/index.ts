// eBay Marketplace Account Deletion webhook.
//
// Required by eBay before production API access is granted. eBay calls
// this endpoint for two purposes:
//
//   1. GET ?challenge_code=<code>
//      Verification handshake. We respond with
//        SHA-256(challenge_code + verification_token + endpoint_url)
//      hex-encoded, wrapped in JSON: { "challengeResponse": "<hex>" }.
//
//   2. POST { metadata: {...}, notification: { data: { userId } } }
//      Real account-deletion notification. We don't store eBay user
//      data anywhere in our schema, so the deletion is a no-op
//      acknowledgment. We do verify the HMAC-SHA1 signature in the
//      X-EBAY-SIGNATURE header (signed with the verification_token)
//      to prevent malicious 200 OKs landing in api_request_log.
//
// verify_jwt = false (configured in supabase/config.toml). eBay calls
// us directly, no JWT in the request.
//
// ⚠️ Note on signature scheme: eBay's public docs at
// developer.ebay.com/marketplace-account-deletion describe an RSA-based
// signature scheme using a public key fetched from eBay's notification
// API. This implementation matches the project spec (HMAC-SHA1 with
// the verification_token as key). If eBay rejects the test challenge
// or live notifications with a signature error, swap verifySignature()
// for the RSA-based path — fetch eBay's public key from
// `https://api.ebay.com/commerce/notification/v1/public_key/{kid}`,
// parse the X-EBAY-SIGNATURE JSON, RSA-verify against the body.
//
// Required env (set as Supabase Edge Function secrets):
//   EBAY_DELETION_VERIFICATION_TOKEN  64-char alphanumeric. SAME value
//                                     pasted into eBay's Alerts &
//                                     Notifications page.
//   EBAY_DELETION_ENDPOINT_URL        Public URL eBay calls. The hash
//                                     in the GET challenge MUST be
//                                     computed against the exact URL
//                                     eBay used. Set to:
//   https://<project-ref>.supabase.co/functions/v1/ebay-deletion-webhook

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { recordOutcome } from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'ebay_deletion';

const VERIFICATION_TOKEN = Deno.env.get('EBAY_DELETION_VERIFICATION_TOKEN') ?? '';
const ENDPOINT_URL = Deno.env.get('EBAY_DELETION_ENDPOINT_URL') ?? '';

// SHA-256 of input, returned as lowercase hex.
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// HMAC-SHA1 of `message` keyed by `key`, returned as lowercase hex.
async function hmacSha1Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Constant-time string comparison — prevents timing attacks on the
// signature header even though the keyspace is large (HMAC-SHA1 = 160
// bits) and a real timing attack is implausible here. Cheap defense.
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(
  withSentry('ebay-deletion-webhook', async (req) => {
    const pre = preflight(req);
    if (pre) return pre;

    const admin = adminClient();

    // Misconfigured-env short-circuit. Fail loud so the eBay test
    // challenge fails fast and we get an obvious api_request_log row.
    if (!VERIFICATION_TOKEN || !ENDPOINT_URL) {
      const missing = [
        !VERIFICATION_TOKEN && 'EBAY_DELETION_VERIFICATION_TOKEN',
        !ENDPOINT_URL && 'EBAY_DELETION_ENDPOINT_URL',
      ]
        .filter(Boolean)
        .join(', ');
      await recordOutcome(admin, SOURCE, {
        kind: 'failure',
        statusCode: 500,
        error: `missing env: ${missing}`,
      });
      return jsonResponse({ error: `missing env: ${missing}` }, 500);
    }

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const challenge = url.searchParams.get('challenge_code');
      if (!challenge) {
        return jsonResponse({ error: 'Missing challenge_code query param' }, 400);
      }
      // Order matters per eBay's spec:
      //   challengeCode + verificationToken + endpoint URL
      const response = await sha256Hex(challenge + VERIFICATION_TOKEN + ENDPOINT_URL);
      // eBay specifies a 200 status with this exact JSON shape.
      return jsonResponse({ challengeResponse: response }, 200);
    }

    if (req.method === 'POST') {
      const sig = req.headers.get('x-ebay-signature') ?? '';
      const body = await req.text();
      if (!sig) {
        await recordOutcome(admin, SOURCE, {
          kind: 'failure',
          statusCode: 412,
          error: 'Missing X-EBAY-SIGNATURE header',
        });
        return jsonResponse({ error: 'Missing X-EBAY-SIGNATURE header' }, 412);
      }
      const expected = await hmacSha1Hex(VERIFICATION_TOKEN, body);
      if (!constantTimeEquals(sig, expected)) {
        await recordOutcome(admin, SOURCE, {
          kind: 'failure',
          statusCode: 412,
          error: 'Invalid X-EBAY-SIGNATURE',
        });
        return jsonResponse({ error: 'Invalid signature' }, 412);
      }

      // Parse body for visibility. Don't fail the request if malformed
      // — signature is already verified, so eBay sent something they
      // think is valid. We log what we got and acknowledge.
      let topic: string | null = null;
      let userId: string | null = null;
      try {
        const parsed = JSON.parse(body) as {
          metadata?: { topic?: string };
          notification?: { data?: { userId?: string } };
        };
        topic = parsed.metadata?.topic ?? null;
        userId = parsed.notification?.data?.userId ?? null;
      } catch {
        // Body parse failed but sig was valid — log and ack anyway.
      }

      // No-op deletion: we don't store eBay user data in any of our
      // tables (no ebay_user_id column anywhere — search the schema).
      // If that ever changes, this is the place to wire DELETEs.
      console.log(
        `[ebay-deletion-webhook] ack topic=${topic ?? 'unknown'} userId=${userId ? userId.slice(0, 8) + '...' : 'unknown'}`,
      );

      await recordOutcome(admin, SOURCE, {
        kind: 'success',
        statusCode: 200,
        scraped: 1, // 1 deletion notification handled
      });
      return jsonResponse({ ok: true, topic }, 200);
    }

    return jsonResponse({ error: 'Method not allowed' }, 405);
  }),
);
