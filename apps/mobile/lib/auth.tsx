import type { Session, User } from '@supabase/supabase-js';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';

import { checkPasswordBreach } from './hibp';
import { supabase } from './supabase';

export type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (input: SignUpInput) => Promise<{ error?: string; needsEmailConfirmation?: boolean }>;
  resendConfirmation: (email: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

// Where Supabase should send the user after they click the confirmation link.
// On web we return them to the current origin. On native this needs a deep link
// (e.g. an app scheme via Linking.createURL) — leave undefined until Phase 3.
const emailRedirectTo =
  typeof window !== 'undefined' ? window.location.origin : undefined;

export type SignUpInput = {
  email: string;
  password: string;
  inviteCode: string;
  phoneNumber?: string;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn: AuthState['signIn'] = async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  };

  const signUp: AuthState['signUp'] = async ({ email, password, inviteCode, phoneNumber }) => {
    if (password.length < 12) {
      return { error: 'Password must be at least 12 characters.' };
    }
    const breachCount = await checkPasswordBreach(password);
    if (breachCount > 0) {
      return {
        error: `This password has appeared in ${breachCount.toLocaleString()} known breaches. Pick a different one.`,
      };
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo,
        data: {
          invite_code: inviteCode.trim(),
          phone_number: phoneNumber?.trim() || null,
        },
      },
    });
    if (error) return { error: error.message };
    // When email confirmation is enabled, Supabase returns a user but no session.
    // When it's disabled, a session is created and AuthGate redirects automatically.
    return { needsEmailConfirmation: !data.session && !!data.user };
  };

  const resendConfirmation: AuthState['resendConfirmation'] = async (email) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo },
    });
    return error ? { error: error.message } : {};
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        signIn,
        signUp,
        resendConfirmation,
        signOut,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
