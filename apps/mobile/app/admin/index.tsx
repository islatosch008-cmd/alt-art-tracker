import { Link, Stack } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PageShell } from '@/components/page-shell';

const TILES: Array<{ href: string; title: string; subtitle: string }> = [
  {
    href: '/admin/conflicts',
    title: 'Conflicts',
    subtitle: 'Resolve disagreements between AI agent + scraper data.',
  },
  {
    href: '/admin/sets',
    title: 'Sets',
    subtitle: 'Edit any set + lock fields so scrapers don’t overwrite.',
  },
  {
    href: '/admin/scrapers',
    title: 'Scrapers',
    subtitle: 'Per-source health, last run, snapshots, manual trigger.',
  },
];

export default function AdminHome() {
  return (
    <PageShell>
      <Stack.Screen options={{ title: 'Admin' }} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.h1}>Admin</Text>
        <Text style={styles.sub}>Internal tools — admin/owner only.</Text>
        {TILES.map((t) => (
          <Link key={t.href} href={t.href as never} asChild>
            <Pressable style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}>
              <Text style={styles.tileTitle}>{t.title}</Text>
              <Text style={styles.tileSub}>{t.subtitle}</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </Link>
        ))}
      </ScrollView>
    </PageShell>
  );
}

const styles = StyleSheet.create({
  body: { padding: 24, gap: 12 },
  h1: { fontSize: 28, fontWeight: '700' },
  sub: { fontSize: 14, color: '#666', marginBottom: 12 },
  tile: {
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 12,
    padding: 18,
    backgroundColor: '#fafafa',
    flexDirection: 'row',
    alignItems: 'center',
  },
  tilePressed: { backgroundColor: '#f0f0f0' },
  tileTitle: { fontSize: 17, fontWeight: '700', flexBasis: 110 },
  tileSub: { flex: 1, fontSize: 13, color: '#666', marginLeft: 12 },
  chevron: { fontSize: 24, color: '#bbb', marginLeft: 8 },
});
