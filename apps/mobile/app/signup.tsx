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

const E164 = /^\+[1-9]\d{7,14}$/;

export default function SignupScreen() {
  const { signUp } = useAuth();
  const [inviteCode, setInviteCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    if (phone && !E164.test(phone)) {
      setError('Phone must be E.164 format, e.g. +15125551234');
      return;
    }
    setBusy(true);
    const { error: err } = await signUp({
      email: email.trim(),
      password,
      inviteCode,
      phoneNumber: phone || undefined,
    });
    setBusy(false);
    if (err) setError(err);
    // success: AuthGate redirects to /(tabs) automatically
  };

  const disabled =
    busy || inviteCode.length === 0 || email.length === 0 || password.length < 12;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.brand}>Redeem invite</Text>
        <Text style={styles.tagline}>Phase 1 is invite-only</Text>

        <View style={styles.form}>
          <Text style={styles.label}>Invite code</Text>
          <TextInput
            value={inviteCode}
            onChangeText={setInviteCode}
            placeholder="OWNER-2026"
            placeholderTextColor="#999"
            autoCapitalize="characters"
            style={styles.input}
            editable={!busy}
          />

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
            placeholder="At least 12 characters"
            placeholderTextColor="#999"
            secureTextEntry
            autoComplete="new-password"
            style={styles.input}
            editable={!busy}
          />
          <Text style={styles.hint}>
            We check against HaveIBeenPwned to block reused passwords. Your password never leaves
            your device.
          </Text>

          <Text style={styles.label}>Phone (optional)</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            placeholder="+15125551234"
            placeholderTextColor="#999"
            inputMode="tel"
            autoComplete="tel"
            style={styles.input}
            editable={!busy}
          />
          <Text style={styles.hint}>
            E.164 format. SMS verification happens after signup (you can skip and add later).
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.primaryButton, disabled && styles.disabled]}
            disabled={disabled}
            onPress={onSubmit}>
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Create account</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account?</Text>
          <Link href="/login" style={styles.link}>
            Sign in
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
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 4,
  },
  tagline: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
  },
  form: { gap: 8 },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginTop: 10,
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
  hint: {
    fontSize: 11,
    color: '#888',
    marginTop: 4,
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
  error: {
    color: '#c00',
    fontSize: 13,
    marginTop: 12,
  },
  footer: {
    marginTop: 24,
    alignItems: 'center',
    gap: 4,
  },
  footerText: { fontSize: 14, color: '#666' },
  link: { color: '#0066cc', fontSize: 14, fontWeight: '600' },
});
