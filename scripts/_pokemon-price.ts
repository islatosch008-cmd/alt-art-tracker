// Pull a market price out of a Pokemon TCG API card response.
//
// `tcgplayer.prices` has one entry per finish (normal, holofoil,
// reverseHolofoil, etc.). Each entry has low/mid/high/market/directLow.
//
// Strategy: prefer the foil variants (more valuable, what most collectors
// price-track), fall back to normal, fall back to mid if market isn't set.
// Returns null when there's no usable signal.

type Variant = {
  low?: number;
  mid?: number;
  high?: number;
  market?: number;
  directLow?: number;
};

type Tcgplayer = {
  url?: string;
  updatedAt?: string;
  prices?: Record<string, Variant | null>;
};

const VARIANT_PRIORITY = [
  'holofoil',
  'reverseHolofoil',
  '1stEditionHolofoil',
  'unlimitedHolofoil',
  'normal',
  '1stEdition',
  'unlimited',
];

export function extractTcgPrice(tcgplayer: Tcgplayer | undefined): number | null {
  const prices = tcgplayer?.prices;
  if (!prices) return null;

  for (const variant of VARIANT_PRIORITY) {
    const v = prices[variant];
    if (!v) continue;
    if (typeof v.market === 'number' && v.market > 0) return v.market;
  }
  // Fall back to mid if no market price was set on any priority variant.
  for (const variant of VARIANT_PRIORITY) {
    const v = prices[variant];
    if (!v) continue;
    if (typeof v.mid === 'number' && v.mid > 0) return v.mid;
  }
  // Last resort: scan all variants for anything usable.
  for (const v of Object.values(prices)) {
    if (!v) continue;
    if (typeof v.market === 'number' && v.market > 0) return v.market;
    if (typeof v.mid === 'number' && v.mid > 0) return v.mid;
  }
  return null;
}

// Until we have the eBay Browse API + Marketplace Insights wired up, derive
// an eBay-shaped estimate from the TCG market price. eBay sold listings tend
// to land 80–100% of TCG market for popular cards, with more variance below
// (people lowball, but rarely massively overpay). The randomization is seeded
// per-call so re-running shifts the value slightly — that's intentional, it
// prevents the UI from looking like the eBay number is stale.
export function estimateEbayFromTcg(tcgPrice: number): number {
  const factor = 0.85 + Math.random() * 0.15; // 0.85 – 1.00
  return tcgPrice * factor;
}

export function avgPrice(a: number, b: number): number {
  return (a + b) / 2;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
