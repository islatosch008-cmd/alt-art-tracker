// Generate a partner invite code.
//
// Usage:
//   npm run invite:new -- "Sam from r/PokemonTCG"
//   npm run invite:new -- "Sam" --uses 3 --expires 30   # 3 uses, expires in 30 days
//
// Codes are 8 char base32 (A-Z, 2-7) prefixed with PNR- so they're recognizable
// and easy to type without confusing 0/O or 1/l.

import { adminClient } from './_supabase.ts';
import { captureException, flushSentry, initSentry } from './_sentry.ts';

initSentry('generate-invite');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789'; // 32 chars, no 0/O/1/I

function makeCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return `PNR-${s}`;
}

function parseArgs(argv: string[]): {
  intendedFor: string;
  uses: number;
  expiresInDays: number | null;
} {
  let intendedFor = '';
  let uses = 1;
  let expiresInDays: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--uses') uses = parseInt(argv[++i] ?? '1', 10);
    else if (a === '--expires') expiresInDays = parseInt(argv[++i] ?? '0', 10);
    else if (!a.startsWith('--') && !intendedFor) intendedFor = a;
  }
  return { intendedFor, uses, expiresInDays };
}

async function main() {
  const { intendedFor, uses, expiresInDays } = parseArgs(process.argv.slice(2));
  if (!intendedFor) {
    console.error('Usage: npm run invite:new -- "Person or group"');
    console.error('       npm run invite:new -- "Sam" --uses 3 --expires 30');
    process.exit(1);
  }

  const supabase = adminClient();
  const code = makeCode();

  const expiresAt =
    expiresInDays !== null
      ? new Date(Date.now() + expiresInDays * 86400 * 1000).toISOString()
      : null;

  const { error } = await supabase.from('invite_codes').insert({
    code,
    intended_for: intendedFor,
    uses_remaining: uses,
    expires_at: expiresAt,
  });

  if (error) {
    console.error('Failed:', error.message);
    process.exit(1);
  }

  console.log(`✓ created invite code`);
  console.log(`  code:         ${code}`);
  console.log(`  intended_for: ${intendedFor}`);
  console.log(`  uses:         ${uses}`);
  console.log(`  expires:      ${expiresAt ?? 'never'}`);
  console.log(`\nShare with: "Sign up at <APP_URL> with code ${code}"`);
}

main().catch(async (err) => {
  console.error(err);
  captureException(err, { script: 'generate-invite' });
  await flushSentry();
  process.exit(1);
});
