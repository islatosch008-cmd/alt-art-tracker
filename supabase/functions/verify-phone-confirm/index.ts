import { adminClient, getCallerUser } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import { withSentry } from '../_shared/sentry.ts';
import { checkVerification } from '../_shared/twilio.ts';

const CODE = /^\d{6}$/;

Deno.serve(withSentry('verify-phone-confirm', async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const user = await getCallerUser(req);
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: { code?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const code = body.code?.trim();
  if (!code || !CODE.test(code)) {
    return jsonResponse({ error: 'code must be 6 digits' }, 400);
  }

  // Pull the phone we stored on /verify-phone-start so the user can't substitute
  // a different number at confirm time.
  const admin = adminClient();
  const { data: profile, error: readErr } = await admin
    .from('profiles')
    .select('phone_number')
    .eq('id', user.id)
    .single();
  if (readErr || !profile?.phone_number) {
    return jsonResponse(
      { error: 'No pending phone number on file. Start verification first.' },
      400,
    );
  }

  const result = await checkVerification(profile.phone_number, code);
  if (!result.ok) {
    return jsonResponse({ error: result.error }, result.status ?? 400);
  }

  const { error: updateErr } = await admin
    .from('profiles')
    .update({ phone_verified_at: new Date().toISOString() })
    .eq('id', user.id);
  if (updateErr) {
    return jsonResponse({ error: `Profile update failed: ${updateErr.message}` }, 500);
  }

  return jsonResponse({ ok: true, mode: result.mode });
}));
