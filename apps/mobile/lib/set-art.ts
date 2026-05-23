// Per-set artwork + accent resolver. Maps a release set to one of the 18
// bundled square PNGs and an accent color used to tint/glow its row.
//
// Metro requires STATIC, literal `require()` calls — no dynamic require — so
// every slug is spelled out in the ART map below.

import { theme } from './theme';

// Static require map. All 18 slugs that have art in assets/set-art/.
const ART: Record<string, number> = {
  gundam: require('../assets/set-art/gundam.png'),
  'one-piece': require('../assets/set-art/one-piece.png'),
  'dragon-ball': require('../assets/set-art/dragon-ball.png'),
  pokemon: require('../assets/set-art/pokemon.png'),
  digimon: require('../assets/set-art/digimon.png'),
  evangelion: require('../assets/set-art/evangelion.png'),
  'union-arena': require('../assets/set-art/union-arena.png'),
  'weiss-schwarz': require('../assets/set-art/weiss-schwarz.png'),
  magic: require('../assets/set-art/magic.png'),
  baseball: require('../assets/set-art/baseball.png'),
  basketball: require('../assets/set-art/basketball.png'),
  football: require('../assets/set-art/football.png'),
  soccer: require('../assets/set-art/soccer.png'),
  hockey: require('../assets/set-art/hockey.png'),
  wrestling: require('../assets/set-art/wrestling.png'),
  mma: require('../assets/set-art/mma.png'),
  racing: require('../assets/set-art/racing.png'),
  bandai: require('../assets/set-art/bandai.png'),
};

// Accent colors per slug + publisher/brand fallbacks.
const ACCENT: Record<string, string> = {
  gundam: '#00D1FF',
  'one-piece': '#FF7A00',
  'dragon-ball': '#FFD000',
  pokemon: '#FFE100',
  digimon: '#00FFA6',
  evangelion: '#A000FF',
  'union-arena': '#FF00E1',
  'weiss-schwarz': '#FF66CC',
  magic: '#7A5CFF',
  baseball: '#4CC3FF',
  basketball: '#FF7B00',
  football: '#00FF99',
  soccer: '#00D084',
  hockey: '#8AE6FF',
  wrestling: '#FFD700',
  mma: '#FF2D2D',
  racing: '#00E0FF',
  bandai: '#FF3131',
  // Publisher fallbacks (no dedicated art for these brands).
  panini: '#FFD700',
  topps: '#0055FF',
  upper_deck: '#00CFFF',
  default: theme.accentDefault,
};

type SetLike = {
  name: string;
  brand_id?: string | null;
  box_type?: string | null;
};

export type ResolvedSetArt = {
  /** Metro asset module (number) or null when no art matches. */
  image: number | null;
  /** Always a usable accent color (falls back to default). */
  accent: string;
};

// Resolve a set to its art slug + accent. Order matters:
//   1. Franchise keyword in the name (most specific)
//   2. Sport keyword in the name
//   3. Publisher/brand fallback (image may be null but accent still returns)
//   4. Default
function matchSlug(set: SetLike): string | null {
  const name = (set.name ?? '').toLowerCase();
  const brand = (set.brand_id ?? '').toLowerCase();

  // --- Franchise (checked first) ---
  if (name.includes('gundam')) return 'gundam';
  if (name.includes('one piece')) return 'one-piece';
  if (name.includes('dragon ball') || name.includes('fusion world')) return 'dragon-ball';
  if (name.includes('digimon')) return 'digimon';
  if (name.includes('evangelion')) return 'evangelion';
  if (name.includes('union arena')) return 'union-arena';
  if (name.includes('weiss')) return 'weiss-schwarz';
  if (brand === 'magic' || name.includes('magic')) return 'magic';
  if (brand === 'pokemon') return 'pokemon';

  // --- Sport (name keyword) ---
  if (name.includes('baseball')) return 'baseball';
  if (name.includes('basketball')) return 'basketball';
  if (name.includes('football')) return 'football';
  if (name.includes('soccer')) return 'soccer';
  if (name.includes('hockey')) return 'hockey';
  if (name.includes('wrestl')) return 'wrestling';
  if (name.includes('ufc') || name.includes('mma')) return 'mma';
  if (
    name.includes('racing') ||
    name.includes('nascar') ||
    name.includes('f1') ||
    name.includes('indycar')
  ) {
    return 'racing';
  }

  // --- Publisher fallback ---
  if (brand === 'bandai') return 'bandai'; // image exists
  if (brand === 'panini' || brand === 'topps' || brand === 'upper_deck') {
    // Accent-only: these have no bundled art, signalled by returning the brand
    // key (present in ACCENT but absent from ART).
    return brand;
  }

  return null;
}

export function resolveSetArt(set: SetLike): ResolvedSetArt {
  const slug = matchSlug(set);
  if (!slug) {
    return { image: null, accent: ACCENT.default };
  }
  return {
    image: ART[slug] ?? null,
    accent: ACCENT[slug] ?? ACCENT.default,
  };
}

// Human-readable label for a set's box_type. Returns '' for null/unknown so
// callers can hide the chip entirely.
export function setTypeLabel(boxType?: string | null): string {
  switch (boxType) {
    case 'booster_box':
      return 'BOOSTER BOX';
    case 'elite_trainer_box':
      return 'ELITE TRAINER BOX';
    case 'booster_bundle':
      return 'BOOSTER BUNDLE';
    case 'starter_deck':
      return 'STARTER DECK';
    case 'structure_deck':
      return 'STRUCTURE DECK';
    case 'collection_box':
      return 'COLLECTION BOX';
    case 'blister':
      return 'BLISTER';
    default:
      return '';
  }
}

// Extract a set code from the name when present, e.g. "[EB01]" or a trailing
// "#OP01-070". Returns null when nothing matches.
export function parseSetCode(name: string): string | null {
  if (!name) return null;
  // Bracketed code: [EB01], [OP-11], etc.
  const bracket = name.match(/\[([A-Z0-9][A-Z0-9-]*)\]/i);
  if (bracket) return bracket[1].toUpperCase();
  // Trailing #CODE token: "#OP01-070".
  const hash = name.match(/#([A-Z0-9]+(?:-[A-Z0-9]+)*)\s*$/i);
  if (hash) return hash[1].toUpperCase();
  return null;
}
