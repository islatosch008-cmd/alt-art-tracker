// One-off Twilio Verify smoke test — confirms TWILIO_ACCOUNT_SID +
// TWILIO_AUTH_TOKEN + TWILIO_VERIFY_SERVICE_SID env names match what the
// account expects. Mirrors the start/check calls the verify-phone-* Edge
// Functions make internally (supabase/functions/_shared/twilio.ts).
//
// Reads from supabase/functions/.env so we test against the same values
// the local Edge runtime would use. To test against prod values, point
// TWILIO_* and TEST_PHONE_NUMBER at prod (or symlink the file).
//
// Usage:
//   1. start: npx tsx --env-file=supabase/functions/.env scripts/smoke-twilio-verify.ts start
//      → SMS arrives at TEST_PHONE_NUMBER
//   2. check: npx tsx --env-file=supabase/functions/.env scripts/smoke-twilio-verify.ts check 123456
//      → reports approved/denied
//
// Never logs the auth token or service SID.

const SID = process.env.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN;
const SERVICE = process.env.TWILIO_VERIFY_SERVICE_SID;
const PHONE = process.env.TEST_PHONE_NUMBER;

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`Missing env: ${name}`);
    process.exit(1);
  }
  return value;
}

function basicAuth(): string {
  return 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');
}

async function start(): Promise<void> {
  requireEnv('TWILIO_ACCOUNT_SID', SID);
  requireEnv('TWILIO_AUTH_TOKEN', TOKEN);
  requireEnv('TWILIO_VERIFY_SERVICE_SID', SERVICE);
  requireEnv('TEST_PHONE_NUMBER', PHONE);

  const body = new URLSearchParams({ To: PHONE!, Channel: 'sms' });
  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${SERVICE}/Verifications`,
    {
      method: 'POST',
      headers: {
        Authorization: basicAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  // Don't dump the full response — it includes the SID. Just status + outcome.
  if (res.ok) {
    const json = JSON.parse(text) as { status?: string; channel?: string; to?: string };
    console.log(`status: ${json.status}`);
    console.log(`channel: ${json.channel}`);
    console.log(`to: ${json.to ? json.to.replace(/.(?=.{4})/g, '*') : '(missing)'}`);
    console.log('\nSMS dispatched. When it arrives, run:');
    console.log('  npx tsx --env-file=supabase/functions/.env scripts/smoke-twilio-verify.ts check <6-digit-code>');
  } else {
    console.error(`error body: ${text.slice(0, 400)}`);
    process.exit(2);
  }
}

async function check(code: string): Promise<void> {
  requireEnv('TWILIO_ACCOUNT_SID', SID);
  requireEnv('TWILIO_AUTH_TOKEN', TOKEN);
  requireEnv('TWILIO_VERIFY_SERVICE_SID', SERVICE);
  requireEnv('TEST_PHONE_NUMBER', PHONE);
  if (!/^\d{6}$/.test(code)) {
    console.error('Code must be exactly 6 digits.');
    process.exit(1);
  }

  const body = new URLSearchParams({ To: PHONE!, Code: code });
  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${SERVICE}/VerificationCheck`,
    {
      method: 'POST',
      headers: {
        Authorization: basicAuth(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
  );
  const text = await res.text();
  console.log(`HTTP ${res.status}`);
  if (res.ok) {
    const json = JSON.parse(text) as { status?: string };
    console.log(`status: ${json.status}`);
    if (json.status === 'approved') {
      console.log('\n✅ Verification approved.');
    } else {
      console.log('\n❌ Verification not approved.');
      process.exit(3);
    }
  } else {
    console.error(`error body: ${text.slice(0, 400)}`);
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const arg = process.argv[3];
  if (cmd === 'start') {
    await start();
  } else if (cmd === 'check') {
    if (!arg) {
      console.error('Usage: ... check <6-digit-code>');
      process.exit(1);
    }
    await check(arg);
  } else {
    console.error('Usage: ... { start | check <code> }');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(99);
});
