// Twilio Verify wrapper with a dev-mode fallback.
//
// If TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID are
// all set, we hit the real Twilio Verify API. Otherwise we run in dev mode:
// no SMS is sent and the code "000000" always passes verification. This lets
// the UX be built and tested before paying for Twilio.

const SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const SERVICE = Deno.env.get('TWILIO_VERIFY_SERVICE_SID');

export const isLive = Boolean(SID && TOKEN && SERVICE);

const DEV_CODE = '000000';

function basicAuthHeader(): string {
  const enc = btoa(`${SID}:${TOKEN}`);
  return `Basic ${enc}`;
}

export type StartResult =
  | { ok: true; mode: 'live' | 'dev' }
  | { ok: false; error: string; status?: number };

export async function startVerification(phone: string): Promise<StartResult> {
  if (!isLive) {
    console.log(`[twilio:dev] Would send code to ${phone}. Use ${DEV_CODE} to verify.`);
    return { ok: true, mode: 'dev' };
  }

  const body = new URLSearchParams({ To: phone, Channel: 'sms' });
  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${SERVICE}/Verifications`,
    {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: text, status: res.status };
  }
  return { ok: true, mode: 'live' };
}

export type CheckResult =
  | { ok: true; mode: 'live' | 'dev' }
  | { ok: false; error: string; status?: number };

export async function checkVerification(
  phone: string,
  code: string,
): Promise<CheckResult> {
  if (!isLive) {
    if (code === DEV_CODE) return { ok: true, mode: 'dev' };
    return { ok: false, error: 'Invalid code (dev mode expects 000000)' };
  }

  const body = new URLSearchParams({ To: phone, Code: code });
  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${SERVICE}/VerificationCheck`,
    {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: text, status: res.status };
  }
  const json = await res.json();
  if (json.status !== 'approved') {
    return { ok: false, error: 'Code did not match' };
  }
  return { ok: true, mode: 'live' };
}
