import { Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { PageShell } from '@/components/page-shell';
import {
  SKIPPED_SOURCES,
  type SourceHealth,
  useScraperHealth,
  useTriggerSource,
} from '@/lib/use-scraper-health';

export default function ScrapersDashboard() {
  const { data, isLoading, error, refetch, isRefetching } = useScraperHealth();
  const trigger = useTriggerSource();
  const [busySource, setBusySource] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});

  const onTrigger = async (functionName: string, source: string) => {
    setBusySource(source);
    try {
      const data = await trigger.mutateAsync(functionName);
      setLastResult((prev) => ({
        ...prev,
        [source]: { ok: true, text: JSON.stringify(data).slice(0, 280) },
      }));
    } catch (e) {
      setLastResult((prev) => ({
        ...prev,
        [source]: { ok: false, text: (e as Error).message.slice(0, 280) },
      }));
    } finally {
      setBusySource(null);
    }
  };

  return (
    <PageShell>
      <Stack.Screen options={{ title: 'Scrapers' }} />
      <ScrollView contentContainerStyle={styles.body}>
        {isLoading ? (
          <View style={styles.center}><ActivityIndicator /></View>
        ) : error ? (
          <Text style={styles.errorText}>{(error as Error).message}</Text>
        ) : (
          <>
            <View style={styles.headerRow}>
              <Text style={styles.h1}>Scrapers</Text>
              <Pressable
                onPress={() => refetch()}
                style={styles.refreshBtn}>
                <Text style={styles.refreshText}>
                  {isRefetching ? '…' : 'Refresh'}
                </Text>
              </Pressable>
            </View>
            <Text style={styles.sub}>
              Per-source 7-day health. Locked fields on edited sets always
              survive scrape refreshes.
            </Text>

            {(data ?? []).map((h) => (
              <SourceCard
                key={h.config.source}
                health={h}
                busy={busySource === h.config.source}
                onTrigger={() => onTrigger(h.config.functionName, h.config.source)}
                lastResult={lastResult[h.config.source]}
              />
            ))}

            <View style={styles.skippedBlock}>
              <Text style={styles.skippedTitle}>Deliberately skipped</Text>
              {SKIPPED_SOURCES.map((s) => (
                <View key={s.name} style={styles.skippedRow}>
                  <Text style={styles.skippedName}>{s.name}</Text>
                  <Text style={styles.skippedReason}>{s.reason}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </PageShell>
  );
}

function SourceCard({
  health,
  busy,
  onTrigger,
  lastResult,
}: {
  health: SourceHealth;
  busy: boolean;
  onTrigger: () => void;
  lastResult?: { ok: boolean; text: string };
}) {
  const status = statusFor(health);
  const lastRunWhen = health.lastRun
    ? timeAgo(health.lastRun.requested_at)
    : 'never';
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{health.config.display}</Text>
          <Text style={styles.cardSub}>{health.config.description}</Text>
        </View>
        <View style={[styles.statusPill, status.bg]}>
          <Text style={[styles.statusText, status.fg]}>{status.label}</Text>
        </View>
      </View>

      <View style={styles.statsRow}>
        <Stat label="last run" value={lastRunWhen} />
        <Stat label="7d runs" value={String(health.totalRuns7d)} />
        <Stat
          label="zero-day streak"
          value={
            health.consecutiveZeroDays === 0
              ? '—'
              : `${health.consecutiveZeroDays}d`
          }
          warn={health.consecutiveZeroDays >= 2}
        />
        {health.totalCost7d > 0 ? (
          <Stat
            label="7d $"
            value={`$${health.totalCost7d.toFixed(2)}`}
          />
        ) : null}
      </View>

      <View style={styles.endpointsRow}>
        {Object.entries(health.countByEndpoint).map(([endpoint, count]) => (
          <View key={endpoint} style={[styles.endpointPill, endpointColor(endpoint)]}>
            <Text style={styles.endpointText}>
              {endpoint} · {count}
            </Text>
          </View>
        ))}
      </View>

      {health.lastSnapshot ? (
        <View style={styles.snapshotRow}>
          <Text style={styles.snapshotLabel}>Latest HTML snapshot:</Text>
          <Text style={styles.snapshotMeta} numberOfLines={1}>
            #{health.lastSnapshot.id} · {health.lastSnapshot.reason} ·{' '}
            {(health.lastSnapshot.html_size_bytes / 1024).toFixed(1)} KB ·{' '}
            {timeAgo(health.lastSnapshot.fetched_at)}
          </Text>
        </View>
      ) : null}

      {health.config.triggerable ? (
        <Pressable
          onPress={onTrigger}
          disabled={busy}
          style={[styles.triggerBtn, busy && styles.triggerBtnDisabled]}>
          <Text style={styles.triggerText}>
            {busy ? 'Triggering…' : 'Trigger now'}
          </Text>
        </Pressable>
      ) : null}

      {lastResult ? (
        <View
          style={[
            styles.resultBox,
            lastResult.ok ? styles.resultBoxOk : styles.resultBoxErr,
          ]}>
          <Text style={styles.resultLabel}>
            {lastResult.ok ? 'Result' : 'Error'}
          </Text>
          <Text style={styles.resultText}>{lastResult.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, warn && styles.statValueWarn]}>
        {value}
      </Text>
    </View>
  );
}

function statusFor(h: SourceHealth): {
  label: string;
  bg: { backgroundColor: string };
  fg: { color: string };
} {
  if (!h.lastRun) {
    return {
      label: 'never',
      bg: { backgroundColor: '#f1f5f9' },
      fg: { color: '#475569' },
    };
  }
  const ep = h.lastRun.endpoint;
  if (ep === 'success' && h.consecutiveZeroDays === 0) {
    return {
      label: 'healthy',
      bg: { backgroundColor: '#dcfce7' },
      fg: { color: '#166534' },
    };
  }
  if (ep === 'failure') {
    return {
      label: 'failure',
      bg: { backgroundColor: '#fee2e2' },
      fg: { color: '#991b1b' },
    };
  }
  if (ep === 'degraded' || h.consecutiveZeroDays >= 2) {
    return {
      label: 'degraded',
      bg: { backgroundColor: '#fef3c7' },
      fg: { color: '#92400e' },
    };
  }
  return {
    label: ep,
    bg: { backgroundColor: '#f1f5f9' },
    fg: { color: '#475569' },
  };
}

function endpointColor(ep: string): { backgroundColor: string } {
  switch (ep) {
    case 'success':
      return { backgroundColor: '#dcfce7' };
    case 'degraded':
      return { backgroundColor: '#fef3c7' };
    case 'failure':
      return { backgroundColor: '#fee2e2' };
    case 'cost_cap_exceeded':
      return { backgroundColor: '#ede9fe' };
    case 'stale_warning':
      return { backgroundColor: '#fef3c7' };
    default:
      return { backgroundColor: '#f1f5f9' };
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const styles = StyleSheet.create({
  body: { padding: 16, gap: 12, paddingBottom: 32 },
  center: { padding: 32, alignItems: 'center' },
  errorText: { color: '#c00', fontSize: 14, padding: 24 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  h1: { fontSize: 24, fontWeight: '700' },
  sub: { fontSize: 13, color: '#666', marginBottom: 4 },
  refreshBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 6,
  },
  refreshText: { fontSize: 12, fontWeight: '600', color: '#333' },

  card: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#fff',
    gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  cardSub: { fontSize: 12, color: '#666', marginTop: 2 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  stat: { minWidth: 80 },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111',
    marginTop: 2,
  },
  statValueWarn: { color: '#92400e' },

  endpointsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  endpointPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  endpointText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#333',
    fontFamily: 'monospace',
  },

  snapshotRow: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  snapshotLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
  },
  snapshotMeta: { fontSize: 12, color: '#444', fontFamily: 'monospace', marginTop: 2 },

  triggerBtn: {
    backgroundColor: '#1e3a8a',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  triggerBtnDisabled: { opacity: 0.5 },
  triggerText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  resultBox: {
    padding: 10,
    borderRadius: 6,
    borderWidth: 1,
    gap: 4,
  },
  resultBoxOk: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  resultBoxErr: { backgroundColor: '#fef2f2', borderColor: '#fecaca' },
  resultLabel: { fontSize: 10, fontWeight: '700', color: '#666', textTransform: 'uppercase' },
  resultText: { fontSize: 11, fontFamily: 'monospace', color: '#222' },

  skippedBlock: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  skippedTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  skippedRow: {
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
  },
  skippedName: { fontSize: 13, fontWeight: '600', color: '#475569' },
  skippedReason: { fontSize: 11, color: '#888', marginTop: 1 },
});
