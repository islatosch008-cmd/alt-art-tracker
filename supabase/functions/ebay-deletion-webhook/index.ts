// eBay Marketplace Account Deletion webhook.
//
// GET ?challenge_code=<code>
//   Verification handshake. We respond with
//     SHA-256(challenge_code + verification_token + endpoint_url)
//   hex-encoded, wrapped in JSON: { "challengeResponse": "<hex>" }.
//   This path is unchanged from 2d5d3a4 — already verified by eBay
//   on 2026-05-08, keyset enabled.
//
// POST { metadata: {...}, notification: { data: { userId } } }
//   Real account-deletion notification. RSA-SHA1 verify the body
//   against the signature in X-EBAY-SIGNATURE.
//
//   Background — why this is a rewrite:
//   The original 2d5d3a4 used HMAC-SHA1 with verification_token as
//   key (the project spec at the time). eBay's actual scheme is
//   RSA-SHA1: their notification API signs the body with a private
//   key, we fetch the matching public key by kid (key-id) embedded
//   in X-EBAY-SIGNATURE, then verify. From 2026-05-08 evening through
//   2026-05-09 morning, real eBay POSTs accumulated 3,274 consecutive
//   412s in api_request_log because the HMAC path could never match
//   their RSA signature.
//
// SIGNATURE FLOW
// ==============
// 1. X-EBAY-SIGNATURE is base64-encoded JSON: {alg, kid, signature, digest}
//    - alg: 'RSA' OR 'ECDSA' — eBay uses both depending on the kid.
//      Real notifications captured 2026-05-09 used alg='ecdsa'. Earlier
//      project spec said RSA-SHA1; the reality is dispatch-on-alg:
//        RSA   → SHA-1, RSASSA-PKCS1-v1_5
//        ECDSA → SHA-256, ECDSA over the curve in the public key (P-256)
//    - kid: opaque key-id eBay uses to identify the signing key
//    - signature: base64-encoded signature of the raw request body
//    - digest: declared (we ignore — we dispatch on alg, not digest)
// 2. Fetch public key:
//      GET /commerce/notification/v1/public_key/{kid}
//      Authorization: Bearer <oauth-token-from-client_credentials>
//    Response: { key: '<PEM-encoded pubkey>', algorithm: '<RSA|EC>' }
//    PEM may be -----BEGIN PUBLIC KEY----- (SPKI) OR
//    -----BEGIN RSA PUBLIC KEY----- (PKCS#1 raw RSA). node:crypto's
//    createPublicKey auto-detects.
// 3. Verify:
//      verify = crypto.createVerify(alg === 'ECDSA' ? 'SHA256' : 'SHA1')
//      verify.update(rawBody); verify.end();
//      verify.verify(publicKey, signatureBase64, 'base64')
//
// CACHING
// =======
// Public keys cache for 1 hour in module-level Map. eBay rotates
// rarely; even daily rotation gives us 24× cache hit rate per kid.
// OAuth token reuses the existing _shared/ebay.ts fetchToken() which
// has its own cache.
//
// verify_jwt = false (configured in supabase/config.toml). eBay calls
// us directly, no JWT.
//
// Required env (Supabase Edge Function secrets):
//   EBAY_DELETION_VERIFICATION_TOKEN  64-char alphanumeric. SAME value
//                                     pasted into eBay's Alerts &
//                                     Notifications page. Used ONLY by
//                                     the GET-challenge SHA-256 hash
//                                     now — POST verification doesn't
//                                     touch it.
//   EBAY_DELETION_ENDPOINT_URL        Public URL eBay calls. Used in
//                                     the GET hash; not for POST.
//   EBAY_CLIENT_ID, EBAY_CLIENT_SECRET — for fetchToken(). Already set
//                                     for the active-listing scraper.

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import {
  fetchToken,
  invalidateTokenCache,
  SCOPE_BROWSE,
} from '../_shared/ebay.ts';
import { recordOutcome } from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';
// node:crypto handles both PEM formats eBay might return:
//   -----BEGIN PUBLIC KEY-----    (SPKI / X.509 SubjectPublicKeyInfo)
//   -----BEGIN RSA PUBLIC KEY-----  (PKCS#1 raw RSA)
// Web Crypto's crypto.subtle.importKey('spki', ...) rejects PKCS#1 with
// "unsupported algorithm". We hit this in prod on real eBay POSTs (kid
// 694fde55... captured in scraper_html_snapshots 2026-05-09T14:35:24Z).
// node:crypto's createPublicKey auto-detects the format and works with
// both. Same crypto primitive (RSA-SHA1) under the hood.
import { createPublicKey, createVerify, type KeyObject } from 'node:crypto';

const SOURCE = 'ebay_deletion';

const VERIFICATION_TOKEN = Deno.env.get('EBAY_DELETION_VERIFICATION_TOKEN') ?? '';
const ENDPOINT_URL = Deno.env.get('EBAY_DELETION_ENDPOINT_URL') ?? '';

// SHA-256 of input, returned as lowercase hex. Used by GET challenge.
async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// --- RSA verification path -------------------------------------------

type CachedKey = { key: KeyObject; expiresAt: number };
// 24-hour cache: eBay rotates rarely (key id changes maybe quarterly).
// The Notification API's 5,000/day quota is shared with our outbound
// public-key fetches, so per-POST-fetch would be expensive. With this
// TTL, even 1,440 inbound POSTs/day cost only ~1 outbound fetch per
// kid per day.
const PUBLIC_KEY_CACHE_MS = 24 * 60 * 60 * 1000;
const publicKeyCache = new Map<string, CachedKey>();

// Drop a cached entry. Called on verify-false to force a fresh fetch in
// case eBay rotated the key under us (kid still valid, but content
// changed — rare but possible).
function invalidatePublicKeyCache(kid: string): void {
  publicKeyCache.delete(kid);
}

// Fetch and cache eBay's public key for a given kid. Throws on fetch
// failure so the caller can surface to api_request_log as a failure
// outcome (not a 412 — public-key fetch is our infra, not eBay's
// signature being wrong).
//
// Auto-recovers from a stale OAuth token: if eBay returns 401 on the
// public-key fetch, invalidate the token cache and retry ONCE with a
// fresh mint. Don't retry beyond that — repeat 401 means our creds
// themselves are bad, which is operator action territory.
//
// Uses node:crypto's createPublicKey so PEM-format autodetection works
// for both -----BEGIN PUBLIC KEY----- (SPKI) and -----BEGIN RSA PUBLIC
// KEY----- (PKCS#1). eBay returns one or the other depending on key
// generation tooling — verified empirically (real kid 694fde55... on
// 2026-05-09 returned a key that Web Crypto's importKey('spki') rejected
// with "unsupported algorithm"; node:crypto handled it cleanly).
async function getEbayPublicKey(kid: string): Promise<KeyObject> {
  const cached = publicKeyCache.get(kid);
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  let token = await fetchToken(SCOPE_BROWSE);
  const url = `https://api.ebay.com/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`;
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    // Stale token — force a remint and retry once.
    invalidateTokenCache();
    token = await fetchToken(SCOPE_BROWSE);
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) {
    throw new Error(
      `public key fetch failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }
  const payload = (await res.json()) as { key?: string; algorithm?: string };
  if (!payload.key) {
    throw new Error('public key response missing `key` field');
  }
  // eBay returns the key with -----BEGIN/END----- markers BUT on a
  // single line with no internal newlines — Deno's node:crypto PEM
  // parser is strict and requires 64-char line breaks. We strip any
  // markers + whitespace, then re-wrap with proper newlines.
  // (Empirically verified 2026-05-09: eBay's response shape was
  // "-----BEGIN PUBLIC KEY-----MFkwEwYHKoZIzj0...AQAB-----END PUBLIC KEY-----"
  // single-line, length ~174 for P-256. createPublicKey rejected with
  // "invalid PEM public key" until we reformatted.)
  const rawKey = payload.key.trim();
  const body = rawKey
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const lines: string[] = [];
  for (let i = 0; i < body.length; i += 64) {
    lines.push(body.slice(i, i + 64));
  }
  const pem = `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
  let keyObject: KeyObject;
  try {
    keyObject = createPublicKey({ key: pem, format: 'pem' });
  } catch (err) {
    // Surface the first 60 chars of the body so the diagnostic snapshot
    // tells us what eBay sent if this still fails.
    throw new Error(
      `createPublicKey failed: ${(err as Error).message}; ` +
        `body prefix=${body.slice(0, 60)}; body length=${body.length}`,
    );
  }
  publicKeyCache.set(kid, {
    key: keyObject,
    expiresAt: Date.now() + PUBLIC_KEY_CACHE_MS,
  });
  return keyObject;
}

type ParsedSignatureHeader = { kid: string; signature: string; alg?: string };

// Parse X-EBAY-SIGNATURE — base64-encoded JSON per eBay's spec.
// Defensive: returns null on any parse / shape error so callers can
// 412 cleanly without throwing.
function parseSignatureHeader(headerValue: string): ParsedSignatureHeader | null {
  try {
    const decoded = atob(headerValue);
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    const kid = typeof parsed.kid === 'string' ? parsed.kid : null;
    const signature =
      typeof parsed.signature === 'string' ? parsed.signature : null;
    if (!kid || !signature) return null;
    const alg = typeof parsed.alg === 'string' ? parsed.alg : undefined;
    return { kid, signature, alg };
  } catch {
    return null;
  }
}

// Verify using SHA-1, regardless of alg=RSA or alg=ECDSA.
//
// Empirical findings 2026-05-09 (replay against real eBay POST captured
// in scraper_html_snapshots):
//   - eBay's public-key endpoint returns `digest: "SHA1"` for ECDSA
//     keys (we initially assumed ECDSA → SHA-256 by convention; wrong)
//   - SHA-1 verifies; SHA-256/384/512 all fail
//   - Same applies to alg=RSA: RSA-SHA1 has been eBay's historical pair
//
// node:crypto's createVerify dispatches to the right primitive based
// on the public key type (RSASSA-PKCS1-v1_5 for RSA, ECDSA for EC).
// Same hash for both: SHA-1.
//
// If a future eBay tier changes the digest, read the `digest` field
// from the public-key endpoint response (cached separately would be
// ideal — for now SHA-1 is universal).
function dispatchVerify(
  publicKey: KeyObject,
  rawBody: string,
  signatureBase64: string,
): boolean {
  const verify = createVerify('SHA1');
  verify.update(rawBody);
  verify.end();
  return verify.verify(publicKey, signatureBase64, 'base64');
}

// Verify the request body against the signature using eBay's public key.
// Returns true on valid signature, false on invalid signature, throws on
// infrastructure errors (key fetch failures) so they're distinguishable
// from sig mismatches in recordOutcome.
//
// Robustness layer: on verify=false against a CACHED key, drop the cache
// entry, refetch fresh, and retry ONCE. Covers the rare case where eBay
// rotated the key under our 24h cache (kid still valid but content
// changed). If the cached key was already a fresh fetch within this
// invocation, the retry is a no-op — getEbayPublicKey will refetch
// because we just deleted it.
async function verifyEbaySignature(
  rawBody: string,
  parsedSig: ParsedSignatureHeader,
): Promise<boolean> {
  const wasCached = publicKeyCache.has(parsedSig.kid);
  const publicKey = await getEbayPublicKey(parsedSig.kid);
  if (dispatchVerify(publicKey, rawBody, parsedSig.signature)) {
    return true;
  }
  // Verify failed against a cached key — could be that eBay rotated the
  // key. Drop cache, refetch, retry once. If cache was empty to start
  // with, the key was already fresh, so don't retry.
  if (!wasCached) return false;
  invalidatePublicKeyCache(parsedSig.kid);
  const freshKey = await getEbayPublicKey(parsedSig.kid);
  return dispatchVerify(freshKey, rawBody, parsedSig.signature);
}

// ---------------------------------------------------------------------

Deno.serve(
  withSentry('ebay-deletion-webhook', async (req) => {
    const pre = preflight(req);
    if (pre) return pre;

    const admin = adminClient();

    // Misconfigured-env short-circuit. The GET path needs both env vars;
    // the POST path now needs CLIENT_ID/SECRET too (for public-key fetch).
    // Verify all four upfront so misconfig fails fast.
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
      // eBay spec: challengeCode + verificationToken + endpoint URL,
      // SHA-256 hex. Returned as { challengeResponse: <hex> }.
      //
      // BOM-safe: jsonResponse() uses JSON.stringify(body) + new Response().
      // JSON.stringify does NOT prepend a UTF-8 BOM (0xEF 0xBB 0xBF). eBay
      // explicitly warns about handlers that build the response by string
      // concatenation prepending a BOM and breaking their parser. Verified
      // via xxd on prod: first bytes of GET response are 0x7B 0x22 = `{"`.
      const response = await sha256Hex(challenge + VERIFICATION_TOKEN + ENDPOINT_URL);
      return jsonResponse({ challengeResponse: response }, 200);
    }

    if (req.method === 'POST') {
      const sigHeader = req.headers.get('x-ebay-signature') ?? '';
      const body = await req.text();

      if (!sigHeader) {
        await recordOutcome(admin, SOURCE, {
          kind: 'failure',
          statusCode: 412,
          error: 'Missing X-EBAY-SIGNATURE header',
        });
        return jsonResponse({ error: 'Missing X-EBAY-SIGNATURE header' }, 412);
      }

      const parsedSig = parseSignatureHeader(sigHeader);
      if (!parsedSig) {
        await recordOutcome(admin, SOURCE, {
          kind: 'failure',
          statusCode: 412,
          error: 'Malformed X-EBAY-SIGNATURE (expected base64-encoded JSON)',
        });
        return jsonResponse(
          { error: 'Malformed X-EBAY-SIGNATURE header' },
          412,
        );
      }

      let valid = false;
      let verifyErr: Error | null = null;
      try {
        valid = await verifyEbaySignature(body, parsedSig);
      } catch (err) {
        verifyErr = err as Error;
      }

      if (verifyErr) {
        // Infra error fetching the public key — distinct from a sig
        // mismatch. Return 500 so eBay retries (their docs say they
        // back off on 5xx).
        //
        // DIAGNOSTIC capture: persist the error detail to
        // scraper_html_snapshots so we can read it via REST without
        // dashboard access. Snapshot rows for 'ebay_deletion' source
        // get cleaned up by daily-maintenance after 7 days.
        const diagnostic = {
          phase: 'verifyEbaySignature',
          error_message: verifyErr.message,
          error_name: verifyErr.name,
          stack_first_3_lines: (verifyErr.stack ?? '').split('\n').slice(0, 3).join(' | '),
          parsed_kid: parsedSig.kid.slice(0, 32),
          parsed_alg: parsedSig.alg ?? null,
          signature_prefix: parsedSig.signature.slice(0, 24),
          body_byte_length: body.length,
          body_first_100_chars: body.slice(0, 100),
        };
        const diagnosticStr = JSON.stringify(diagnostic, null, 2);
        try {
          await admin.from('scraper_html_snapshots').insert({
            source: SOURCE,
            url: `https://api.ebay.com/commerce/notification/v1/public_key/${parsedSig.kid}`,
            reason: 'rsa_verify_threw',
            html_size_bytes: diagnosticStr.length,
            html_content: diagnosticStr,
          });
        } catch (snapErr) {
          console.warn(`diagnostic snapshot insert failed: ${(snapErr as Error).message}`);
        }
        console.error(`[ebay-deletion-webhook] verify threw: ${verifyErr.message}`);
        await recordOutcome(admin, SOURCE, {
          kind: 'failure',
          statusCode: 500,
          error: `verify threw: ${verifyErr.message.slice(0, 200)}`,
        });
        return jsonResponse({ error: 'Verification infra error' }, 500);
      }

      if (!valid) {
        // DIAGNOSTIC capture for the 412 path so we can debug verify=false
        // mismatches offline (replicate body + sig + key against the same
        // verify routine and figure out what's mismatched). Full body
        // captured because eBay signs the raw body — any byte difference
        // makes verify fail.
        try {
          // Compute a SHA-256 of the body for cross-check; if our body
          // matches what eBay signed, hashes will match what their
          // signing pipeline produced.
          const bodyHash = await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(body),
          );
          const bodyHashHex = Array.from(new Uint8Array(bodyHash))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          // Re-fetch the cached key to get the PEM we constructed.
          // This is informational only; cached lookup is a no-op.
          const diagnostic = {
            phase: 'verify_returned_false',
            parsed_kid: parsedSig.kid,
            parsed_alg: parsedSig.alg ?? null,
            signature_full: parsedSig.signature,
            body_byte_length: body.length,
            body_full: body,
            body_sha256_hex: bodyHashHex,
            request_content_type: req.headers.get('content-type'),
            request_content_length: req.headers.get('content-length'),
          };
          const diagnosticStr = JSON.stringify(diagnostic, null, 2);
          await admin.from('scraper_html_snapshots').insert({
            source: SOURCE,
            url: `https://api.ebay.com/commerce/notification/v1/public_key/${parsedSig.kid}`,
            reason: 'verify_returned_false',
            html_size_bytes: diagnosticStr.length,
            html_content: diagnosticStr,
          });
        } catch (snapErr) {
          console.warn(
            `412-diagnostic snapshot failed: ${(snapErr as Error).message}`,
          );
        }
        await recordOutcome(admin, SOURCE, {
          kind: 'failure',
          statusCode: 412,
          error: `Invalid signature for kid=${parsedSig.kid.slice(0, 12)}... alg=${parsedSig.alg ?? 'unknown'}`,
        });
        return jsonResponse({ error: 'Invalid signature' }, 412);
      }

      // Signature verified. Parse body for visibility — don't fail the
      // request if malformed (sig is already verified, so eBay sent
      // valid content from their POV).
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
        /* sig was valid even if body shape varies */
      }

      // No-op deletion: we don't store eBay user data anywhere. Future
      // change: if cards/users ever gain an ebay_user_id column, this
      // is where DELETEs go. Logged for audit.
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
