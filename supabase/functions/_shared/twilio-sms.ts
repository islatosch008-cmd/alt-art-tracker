// Plain SMS sender (separate from Twilio Verify which handles its own flow).
// Same dev-mode fallback pattern as _shared/twilio.ts: when any of the three
// envs is missing, we log instead of sending so the queue drain can still
// be exercised end-to-end.

const SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const FROM = Deno.env.get('TWILIO_FROM_NUMBER');

export const isLive = Boolean(SID && TOKEN && FROM);

export type SmsResult =
  | { ok: true; mode: 'live' | 'dev'; sid?: string }
  | { ok: false; error: string; status?: number };

function basic(): string {
  return `Basic ${btoa(`${SID}:${TOKEN}`)}`;
}

export async function sendSms(to: string, body: string): Promise<SmsResult> {
  if (!isLive) {
    console.log(`[twilio:dev] sms → ${to}: ${body}`);
    return { ok: true, mode: 'dev' };
  }
  const params = new URLSearchParams({ To: to, From: FROM!, Body: body });
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: basic(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    },
  );
  if (!res.ok) return { ok: false, error: await res.text(), status: res.status };
  const json = (await res.json()) as { sid?: string };
  return { ok: true, mode: 'live', sid: json.sid };
}
