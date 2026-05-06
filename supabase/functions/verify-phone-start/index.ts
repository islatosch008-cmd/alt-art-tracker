import { adminClient, getCallerUser } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { startVerification } from '../_shared/twilio.ts';

const E164 = /^\+[1-9]\d{7,14}$/;

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const user = await getCallerUser(req);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: { phone_number?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const phone = body.phone_number?.trim();
  if (!phone || !E164.test(phone)) {
    return jsonResponse(
      { error: 'phone_number must be E.164, e.g. +15125551234' },
      400,
    );
  }

  // Save (or update) the unverified phone on the user's profile so confirm can
  // double-check later. Do this BEFORE sending the code so we never end up in a
  // state where Twilio sent a code we have no way to associate.
  const admin = adminClient();
  const { error: updateErr } = await admin
    .from('profiles')
    .update({ phone_number: phone, phone_verified_at: null })
    .eq('id', user.id);
  if (updateErr) {
    return jsonResponse({ error: `Profile update failed: ${updateErr.message}` }, 500);
  }

  const result = await startVerification(phone);
  if (!result.ok) {
    return jsonResponse({ error: result.error }, result.status ?? 500);
  }

  return jsonResponse({ ok: true, mode: result.mode });
});
