import { execSync } from 'node:child_process';

import type { Database } from '@alt-art-tracker/shared';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Auto-detect local Supabase secrets via `supabase status -o json` so scripts
// "just work" against the dev stack without env-var setup. Override with
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for cloud or CI runs.
function readLocalStatus(): { url?: string; secretKey?: string } {
  try {
    const out = execSync('supabase status -o json', {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: new URL('..', import.meta.url),
    }).toString();
    const status = JSON.parse(out);
    return {
      url: status.API_URL,
      secretKey: status.SECRET_KEY ?? status.SERVICE_ROLE_KEY,
    };
  } catch {
    return {};
  }
}

export function adminClient(): SupabaseClient<Database> {
  const local = readLocalStatus();
  const url = process.env.SUPABASE_URL ?? local.url;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    local.secretKey;

  if (!url || !key) {
    console.error(
      'Missing Supabase credentials. Run `supabase start` first, or set\n' +
        'SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in your env.',
    );
    process.exit(1);
  }
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}
