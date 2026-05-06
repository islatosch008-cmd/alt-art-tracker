import { supabase } from './supabase';

export type VerifyResult = { error?: string; mode?: 'live' | 'dev' };

export async function startPhoneVerify(phoneNumber: string): Promise<VerifyResult> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    error?: string;
    mode?: 'live' | 'dev';
  }>('verify-phone-start', {
    body: { phone_number: phoneNumber },
  });
  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };
  return { mode: data?.mode };
}

export async function confirmPhoneVerify(code: string): Promise<VerifyResult> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    error?: string;
    mode?: 'live' | 'dev';
  }>('verify-phone-confirm', {
    body: { code },
  });
  if (error) return { error: error.message };
  if (data?.error) return { error: data.error };
  return { mode: data?.mode };
}
