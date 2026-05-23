// Dark theme tokens for Alt Art Tracker 2.0. Single source of truth for the
// "game-styled" dark redesign — import `theme` anywhere instead of hardcoding
// hex values so the whole app reads consistently dark.
//
// Web-first: glow/box-shadow effects work on react-native-web; native falls
// back to `elevation` (Android) or simply omits the glow (iOS) gracefully.

export const theme = {
  // Core surfaces
  bg: '#0B0E14', // app background (near-black, slight blue)
  surface: '#121722', // raised cards / rows
  surfaceAlt: '#0F141D', // slightly deeper inset (chooser, inputs)
  surfaceHover: '#1A2130', // pressed / hover state

  // Lines
  border: '#222A38',
  borderStrong: '#2E394C',

  // Text
  text: '#F5F7FA',
  textMuted: '#8A93A6',
  textFaint: '#5C6679',

  // Accents
  accentDefault: '#5B7FFF',
  danger: '#FF5A5A',
  success: '#3DDC84',
} as const;

export type Theme = typeof theme;

// Convert a #RRGGBB hex + 0..1 alpha into an `rgba()` string. Used for accent
// tints and glows so a single accent color drives the whole row's look.
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return `rgba(91, 127, 255, ${alpha})`; // fall back to accentDefault
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
