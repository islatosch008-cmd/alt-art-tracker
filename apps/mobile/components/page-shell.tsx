import { type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Max readable width before we start losing the grid: 8 cols × 180px target +
// 7 × 8px gap + 24px page padding = 1520px. Wider viewports leave equal
// whitespace on both sides instead of dumping it all on the right.
const MAX_CONTENT_WIDTH = 1520;

// Standard tab-screen wrapper. SafeAreaView (top edge) + a max-width inner
// container that centers within the viewport on desktop sizes. Background is
// white edge-to-edge so the centered band doesn't look like a floating card.
export function PageShell({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <SafeAreaView style={styles.outer} edges={['top']}>
      <View style={[styles.inner, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: '#fff' },
  inner: {
    flex: 1,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
  },
});
