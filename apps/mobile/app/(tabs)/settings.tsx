import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PageShell } from '@/components/page-shell';
import { ScreenHeader } from '@/components/screen-header';
import { useAuth } from '@/lib/auth';
import { theme } from '@/lib/theme';
import { confirmPhoneVerify, startPhoneVerify } from '@/lib/phone';
import { formatPhoneDisplay, normalizeUSPhone } from '@/lib/phone-format';
import { useIsAdmin } from '@/lib/use-is-admin';
import { usePreferences, useUpdatePreferences } from '@/lib/use-preferences';
import { useProfile } from '@/lib/use-profile';

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { data: profile, isLoading } = useProfile();
  const { data: prefs, isLoading: prefsLoading } = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'idle' | 'code'>('idle');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);

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
    <PageShell>
      <ScreenHeader title="Settings" subtitle="Filters, alerts, account" />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Signed in as</Text>
          <Text style={styles.cardValue}>{user?.email ?? '—'}</Text>
          {isAdmin ? (
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>
                {profile?.role?.toUpperCase() ?? 'ADMIN'}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Phone</Text>
          {isLoading ? (
            <ActivityIndicator />
          ) : verified ? (
            <View>
              <Text style={styles.cardValue}>
                {formatPhoneDisplay(profile!.phone_number!)} ✓
              </Text>
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

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Email notifications</Text>
          {prefsLoading ? (
            <ActivityIndicator />
          ) : !prefs ? (
            <Text style={styles.hint}>Preferences unavailable.</Text>
          ) : (
            <View style={{ marginTop: 4 }}>
              <ToggleRow
                label="Email notifications"
                hint="Master switch for all email alerts."
                value={prefs.email_enabled}
                disabled={updatePrefs.isPending}
                onChange={(v) => updatePrefs.mutate({ email_enabled: v })}
              />
              <ToggleRow
                label="Drop reminders"
                hint="Emails before a pre-order window opens."
                value={prefs.drop_alerts_enabled}
                disabled={updatePrefs.isPending || !prefs.email_enabled}
                onChange={(v) => updatePrefs.mutate({ drop_alerts_enabled: v })}
              />
              <ToggleRow
                label="Release reminders"
                hint="Emails before a set's release date."
                value={prefs.release_alerts_enabled}
                disabled={updatePrefs.isPending || !prefs.email_enabled}
                onChange={(v) => updatePrefs.mutate({ release_alerts_enabled: v })}
                last
              />
            </View>
          )}
          {updatePrefs.isError ? (
            <Text style={[styles.msg, styles.error]}>
              Could not save — {(updatePrefs.error as Error).message}
            </Text>
          ) : null}
        </View>

        <Pressable style={styles.signOut} onPress={() => void signOut()}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </PageShell>
  );
}

function ToggleRow({
  label,
  hint,
  value,
  disabled,
  onChange,
  last,
}: {
  label: string;
  hint: string;
  value: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <View style={[styles.toggleRow, last && styles.toggleRowLast]}>
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: theme.borderStrong, true: theme.accentDefault }}
        thumbColor="#fff"
        ios_backgroundColor={theme.borderStrong}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 24, paddingTop: 0, gap: 16, paddingBottom: 40 },
  card: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    padding: 16,
    backgroundColor: theme.surface,
  },
  cardLabel: { fontSize: 12, color: theme.textMuted, marginBottom: 4 },
  cardValue: { fontSize: 16, fontWeight: '600', color: theme.text },
  roleBadge: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(91, 127, 255, 0.18)',
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: theme.accentDefault,
    letterSpacing: 0.5,
  },
  hint: { fontSize: 12, color: theme.textMuted, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: theme.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: theme.text,
    backgroundColor: theme.surfaceAlt,
  },
  codeInput: {
    fontSize: 22,
    letterSpacing: 6,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  primaryButton: {
    backgroundColor: theme.accentDefault,
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
    borderColor: theme.borderStrong,
  },
  secondaryButtonText: { color: theme.text, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  msg: { fontSize: 13, marginTop: 12 },
  error: { color: theme.danger },
  info: { color: theme.success },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    gap: 12,
  },
  toggleRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  toggleText: { flex: 1 },
  toggleLabel: { fontSize: 15, fontWeight: '600', color: theme.text },
  signOut: {
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.danger,
  },
  signOutText: { color: theme.danger, fontSize: 15, fontWeight: '600' },
});
