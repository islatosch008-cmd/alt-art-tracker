import { Link } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/lib/auth';

function isUnconfirmedEmailError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('email not confirmed') || lower.includes('email_not_confirmed');
}

export default function LoginScreen() {
  const { signIn, resendConfirmation } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);

  const onSubmit = async () => {
    setError(null);
    setUnconfirmed(false);
    setResent(false);
    setBusy(true);
    const { error: err } = await signIn(email.trim(), password);
    setBusy(false);
    if (err) {
      if (isUnconfirmedEmailError(err)) {
        setUnconfirmed(true);
        setError("Your email isn't verified yet — check your inbox for the link.");
      } else {
        setError(err);
      }
    }
  };

  const onResend = async () => {
    setError(null);
    setResent(false);
    setResending(true);
    const { error: err } = await resendConfirmation(email.trim());
    setResending(false);
    if (err) {
      setError(err);
      return;
    }
    setResent(true);
  };

  const disabled = busy || email.length === 0 || password.length === 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.brand}>Alt Art Tracker</Text>
        <Text style={styles.tagline}>Card alerts that actually move</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor="#999"
            autoCapitalize="none"
            autoComplete="email"
            inputMode="email"
            style={styles.input}
            editable={!busy}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor="#999"
            secureTextEntry
            autoComplete="current-password"
            style={styles.input}
            editable={!busy}
            onSubmitEditing={onSubmit}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {resent ? <Text style={styles.success}>Verification email sent.</Text> : null}

          <Pressable
            style={[styles.primaryButton, disabled && styles.disabled]}
            disabled={disabled}
            onPress={onSubmit}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Sign in</Text>
            )}
          </Pressable>

          {unconfirmed ? (
            <Pressable
              style={[styles.secondaryButton, resending && styles.disabled]}
              disabled={resending}
              onPress={onResend}>
              {resending ? (
                <ActivityIndicator color="#111" />
              ) : (
                <Text style={styles.secondaryButtonText}>Resend verification email</Text>
              )}
            </Pressable>
          ) : null}
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>No account?</Text>
          <Link href="/signup" style={styles.link}>
            Redeem an invite code
          </Link>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  inner: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    maxWidth: 420,
    width: '100%',
    alignSelf: 'center',
  },
  brand: {
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 4,
  },
  tagline: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
  },
  form: {
    gap: 8,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fafafa',
  },
  primaryButton: {
    marginTop: 20,
    backgroundColor: '#111',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  disabled: { opacity: 0.5 },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#111',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#111',
    fontSize: 16,
    fontWeight: '600',
  },
  error: {
    color: '#c00',
    fontSize: 13,
    marginTop: 12,
  },
  success: {
    color: '#0a7d28',
    fontSize: 13,
    marginTop: 12,
  },
  footer: {
    marginTop: 32,
    alignItems: 'center',
    gap: 4,
  },
  footerText: {
    fontSize: 14,
    color: '#666',
  },
  link: {
    color: '#0066cc',
    fontSize: 14,
    fontWeight: '600',
  },
});
