import { supabase } from './supabase';

export type VerifyResult = { error?: string; mode?: 'live' | 'dev' };

// supabase-js throws a FunctionsHttpError on any non-2xx and sets `.message`
// to the generic "Edge Function returned a non-2xx status code". The actual
// JSON body our functions return ({ error: "..." }) lives on `error.context`
// (a Response). Read it so the user sees the real reason (e.g. the Twilio
// error) instead of the useless wrapper.
async function readFunctionError(error: { message: string; context?: unknown }): Promise<string> {
  const ctx = error.context as Response | undefined;
  if (ctx && typeof ctx.clone === 'function') {
    try {
      const body = await ctx.clone().json();
      if (body?.error) {
        return typeof body.error === 'string' ? body.error : JSON.stringify(body.error);
      }
    } catch {
      try {
        const text = await ctx.clone().text();
        if (text) return text;
      } catch {
        /* fall through to generic message */
      }
    }
  }
  return error.message;
}

export async function startPhoneVerify(phoneNumber: string): Promise<VerifyResult> {
  const { data, error } = await supabase.functions.invoke<{
    ok?: boolean;
    error?: string;
    mode?: 'live' | 'dev';
  }>('verify-phone-start', {
    body: { phone_number: phoneNumber },
  });
  if (error) return { error: await readFunctionError(error) };
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
  if (error) return { error: await readFunctionError(error) };
  if (data?.error) return { error: data.error };
  return { mode: data?.mode };
}
