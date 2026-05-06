// Leaf Trading Cards scraper. Pulls /releases — a Webflow page with
// product cards linking to /products/<slug>. Each link is one product
// release. No release date in the index (Leaf doesn't publish one publicly
// per row); we capture name + slug + URL and let the AI agent or admin
// fill in the date.
//
// Built first as the abstraction test for _shared/scraper.ts; the
// CardboardConnection scraper reuses the same plumbing.

import { adminClient } from '../_shared/auth.ts';
import { jsonResponse, preflight } from '../_shared/cors.ts';
import {
  hashSourceId,
  politeFetch,
  recordOutcome,
  type ScrapeOutcome,
  type ScrapedRelease,
  upsertScrapedReleases,
} from '../_shared/scraper.ts';
import { withSentry } from '../_shared/sentry.ts';

const SOURCE = 'leaf_scraper';
const TARGET = 'https://www.leaftradingcards.com/releases';

// Sport keyword → our sport tag. Run on the slug.
const SPORT_KEYWORDS: Array<[RegExp, string]> = [
  [/baseball/i, 'baseball'],
  [/football/i, 'football'],
  [/basketball/i, 'basketball'],
  [/hockey/i, 'hockey'],
  [/soccer/i, 'soccer'],
  [/wrestl/i, 'wrestling'],
  [/golf/i, 'golf'],
  [/tennis/i, 'tennis'],
  [/racing|nascar|f1|indycar/i, 'racing'],
  [/ufc|mma/i, 'ufc'],
  [/multi[- ]sport/i, 'multi-sport'],
  [/celebrit|art of sport|nation/i, 'other'],
];

function inferSport(text: string): string | null {
  for (const [re, sport] of SPORT_KEYWORDS) {
    if (re.test(text)) return sport;
  }
  return null;
}

// Extract /products/<slug> hrefs. The clean product name is on the nested
// img's `alt` attribute ("2026 Leaf Art of Sport") — the link text contains
// the date label ("Jul 2026 COMING SOON"), which is junk for our purposes.
// Fall back to slug-titlecased if no alt found.
function parseLeafProducts(
  html: string,
): Array<{ slug: string; url: string; name: string }> {
  const out: Array<{ slug: string; url: string; name: string }> = [];
  const linkRe = /<a[^>]*href="(\/products\/([^"]+))"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = linkRe.exec(html)) !== null) {
    const path = m[1];
    const slug = m[2];
    const inner = m[3];

    let name: string | null = null;
    const altMatch = /<img[^>]*alt="([^"]+)"/i.exec(inner);
    if (altMatch) name = altMatch[1].trim();
    if (!name || name.length === 0) {
      // Fall back to slug → "2026 Leaf Art Of Sport"
      name = slug
        .split('-')
        .map((w) => (w[0] ?? '').toUpperCase() + w.slice(1))
        .join(' ');
    }

    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ slug, url: `https://www.leaftradingcards.com${path}`, name });
  }
  return out;
}

Deno.serve(
  withSentry(SOURCE, async (req) => {
    const pre = preflight(req);
    if (pre) return pre;
    const admin = adminClient();

    let res: Response;
    try {
      res = await politeFetch(TARGET);
    } catch (err) {
      const outcome: ScrapeOutcome = {
        kind: 'failure',
        statusCode: 0,
        error: `fetch threw: ${(err as Error).message}`,
      };
      await recordOutcome(admin, SOURCE, outcome);
      return jsonResponse({ ok: false, ...outcome }, 502);
    }

    if (!res.ok) {
      const outcome: ScrapeOutcome = {
        kind: 'failure',
        statusCode: res.status,
        error: `HTTP ${res.status}`,
      };
      await recordOutcome(admin, SOURCE, outcome);
      return jsonResponse({ ok: false, ...outcome }, 502);
    }

    const html = await res.text();
    const products = parseLeafProducts(html);

    if (products.length === 0) {
      const outcome: ScrapeOutcome = {
        kind: 'degraded',
        statusCode: res.status,
        reason: 'no_results',
        url: TARGET,
        html,
      };
      await recordOutcome(admin, SOURCE, outcome);
      return jsonResponse({ ok: true, scraped: 0, reason: 'no_results' });
    }

    const releases: ScrapedRelease[] = await Promise.all(
      products.map(async (p) => ({
        source_id: await hashSourceId('leaf', p.slug),
        brand_id: 'leaf',
        name: p.name,
        sport: inferSport(p.slug + ' ' + p.name),
        external_ids: { leaf_slug: p.slug, leaf_url: p.url },
      })),
    );

    const counts = await upsertScrapedReleases(admin, SOURCE, releases);

    await recordOutcome(admin, SOURCE, {
      kind: 'success',
      statusCode: res.status,
      scraped: products.length,
    });

    return jsonResponse({
      ok: true,
      scraped: products.length,
      ...counts,
    });
  }),
);
