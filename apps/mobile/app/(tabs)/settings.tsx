import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAuth } from '@/lib/auth';
import { confirmPhoneVerify, startPhoneVerify } from '@/lib/phone';
import { formatPhoneDisplay, normalizeUSPhone } from '@/lib/phone-format';
import { useProfile } from '@/lib/use-profile';

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { data: profile, isLoading } = useProfile();
  const qc = useQueryClient();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'idle' | 'code'>('idle');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

  // Hydrate the input with the profile's saved number once it loads.
  const phoneOnProfile = profile?.phone_number ?? '';
  const verified = !!profile?.phone_verified_at;
  const initialPhone = phone || phoneOnProfile;

  const onSendCode = async () => {
    setMsg(null);
    const normalized = normalizeUSPhone(initialPhone);
    if (!normalized) {
      setMsg({ kind: 'error', text: 'Enter a 10-digit US phone number' });
      return;
    }
    setBusy(true);
    const r = await startPhoneVerify(normalized);
    setBusy(false);
    if (r.error) {
      setMsg({ kind: 'error', text: r.error });
      return;
    }
    setStep('code');
    setMsg({
      kind: 'info',
      text:
        r.mode === 'dev'
          ? 'Dev mode: no SMS sent. Use code 000000.'
          : 'Code sent. Check your phone.',
    });
  };

  const onConfirm = async () => {
    setMsg(null);
    if (!/^\d{6}$/.test(code)) {
      setMsg({ kind: 'error', text: 'Code is 6 digits' });
      return;
    }
    setBusy(true);
    const r = await confirmPhoneVerify(code);
    setBusy(false);
    if (r.error) {
      setMsg({ kind: 'error', text: r.error });
      return;
    }
    setStep('idle');
    setCode('');
    setPhone('');
    setMsg({ kind: 'info', text: 'Phone verified ✓' });
    await qc.invalidateQueries({ queryKey: ['profile', user?.id] });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.subtitle}>Filters, alerts, account</Text>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Signed in as</Text>
        <Text style={styles.cardValue}>{user?.email ?? '—'}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardLabel}>Phone</Text>
        {isLoading ? (
          <ActivityIndicator />
        ) : verified ? (
          <View>
            <Text style={styles.cardValue}>{formatPhoneDisplay(profile!.phone_number!)} ✓</Text>
            <Text style={styles.hint}>
              Verified {new Date(profile!.phone_verified_at!).toLocaleString()}
            </Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {step === 'idle' ? (
              <>
                <TextInput
                  value={initialPhone}
                  onChangeText={setPhone}
                  placeholder="(512) 555-1234"
                  placeholderTextColor="#999"
                  inputMode="tel"
                  autoComplete="tel"
                  style={styles.input}
                  editable={!busy}
                />
                <Text style={styles.hint}>
                  US numbers only. We add the +1 for you.
                </Text>
                <Pressable
                  style={[styles.primaryButton, busy && styles.disabled]}
                  disabled={busy}
                  onPress={onSendCode}>
                  {busy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Send code</Text>
                  )}
                </Pressable>
              </>
            ) : (
              <>
                <TextInput
                  value={code}
                  onChangeText={setCode}
                  placeholder="6-digit code"
                  placeholderTextColor="#999"
                  inputMode="numeric"
                  maxLength={6}
                  style={[styles.input, styles.codeInput]}
                  editable={!busy}
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable
                    style={[styles.secondaryButton, busy && styles.disabled]}
                    disabled={busy}
                    onPress={() => {
                      setStep('idle');
                      setCode('');
                      setMsg(null);
                    }}>
                    <Text style={styles.secondaryButtonText}>Back</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.primaryButton, busy && styles.disabled, { flex: 1 }]}
                    disabled={busy}
                    onPress={onConfirm}>
                    {busy ? (
                      <ActivityIndicator color="#fff" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Verify</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        )}

        {msg ? (
          <Text style={[styles.msg, msg.kind === 'error' ? styles.error : styles.info]}>
            {msg.text}
          </Text>
        ) : null}
      </View>

      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>Preferences UI coming Week 3</Text>
      </View>

      <Pressable style={styles.signOut} onPress={() => void signOut()}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#fff',
  },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 24 },
  card: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    backgroundColor: '#fafafa',
  },
  cardLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  cardValue: { fontSize: 16, fontWeight: '600' },
  hint: { fontSize: 12, color: '#888', marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  codeInput: {
    fontSize: 22,
    letterSpacing: 6,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  primaryButton: {
    backgroundColor: '#111',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  secondaryButtonText: { color: '#333', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  msg: { fontSize: 13, marginTop: 12 },
  error: { color: '#c00' },
  info: { color: '#0a0' },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e5e5e5',
    borderStyle: 'dashed',
    borderRadius: 12,
  },
  placeholderText: { color: '#999', fontSize: 14 },
  signOut: {
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#c00',
  },
  signOutText: { color: '#c00', fontSize: 15, fontWeight: '600' },
});
