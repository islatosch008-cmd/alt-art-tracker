import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

// Returns a service-role Supabase client for DB writes inside an Edge Function.
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

// Validates the caller's JWT and returns the user, or null if missing/invalid.
export async function getCallerUser(req: Request) {
  const auth = req.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const token = auth.slice('Bearer '.length);
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}
