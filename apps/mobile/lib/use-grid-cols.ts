import { useWindowDimensions } from 'react-native';

// Compute how many grid columns fit at the current viewport width, given a
// target cell width. On web this updates as the user resizes the window.
//
//   target=180, padding=12, gap=8, viewport=400  -> 2 cols
//   target=180, padding=12, gap=8, viewport=900  -> 4 cols
//   target=180, padding=12, gap=8, viewport=1600 -> 8 cols (capped by data)
//
// Pair the returned `cols` with `<FlatList key={\`cols-\${cols}\`} numColumns={cols} />`
// so the list remounts cleanly when the column count changes.
export function useGridCols({
  target = 180,
  min = 2,
  max = 8,
  pagePadding = 12,
  gap = 8,
}: {
  target?: number;
  min?: number;
  max?: number;
  pagePadding?: number;
  gap?: number;
} = {}): number {
  const { width } = useWindowDimensions();
  const usable = Math.max(0, width - pagePadding * 2);
  // (usable + gap) / (cellWidth + gap) — accounts for n-1 gaps between n cells.
  const cols = Math.floor((usable + gap) / (target + gap));
  return Math.max(min, Math.min(max, cols));
}
