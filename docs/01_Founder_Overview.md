# Alt Art Tracker — Founder Overview

**Owner:** Ian Slatosch
**Date:** 2026-05-05 (revised)
**Status:** Pre-build

---

## What this is

An SMS-first alert + trending intelligence app for trading card and sports card flippers. Built on a focused MVP that does what no other app does, then expanded into broader collection tracking only if partners and users validate it's worth building.

**The pitch in one line:** "Get a text the moment Pokemon, Topps, Panini, Bandai, or Magic releases drop, plus a live feed of what's popping off and what's about to."

---

## Why this version (not the original spec)

A market scan turned up CollX, Collectr, Ludex, TCGSnap, TCGplayer App, and others already doing portfolio tracking, scanning, market pricing, set completion, and marketplaces. CollX alone has 20M+ cards indexed and millions of users.

Building the broad version meant 200-400 hours rebuilding things that already exist with no clear advantage. Bad math.

The smart move: lead with what's actually unique, get partners using it fast, then expand only into features users prove they want from us specifically.

---

## What's unique to this app (the core)

1. **SMS drop alerts** — nobody texts you when pre-orders open or releases hit. Push notifications get buried, texts don't.
2. **Heating Up feed** — predictive, not just reactive. Catches cards starting to move BEFORE they peak.
3. **Convention/show integration** (Phase 4) — tied to my real event business, no competitor can replicate.

Everything else (portfolio, set completion, wishlist) gets built only if partners and users prove it's needed AFTER the core launches.

---

## Who it's for

**Phase 1 (3-4 weeks):** Me + 3-10 invited partners. Real users from day 1.

**Public launch:** Flippers, resellers, and serious collectors who want to be first on drops. Not casual scanners (CollX serves that audience well already).

---

## Core features (Phase 1)

### SMS drop alerts
Get texted at T-30, T-7, T-1, and T-0 days before any release across Pokemon, Topps, Panini, Bandai, Magic. Get texted instantly when pre-orders open at retailers. Per-user filters so each partner only gets brands they care about.

### Trending Now feed
Live feed of what's moving in the last 24 hours and 7 days. Sorted by composite popularity score. Filter by brand and category.

### Heating Up feed (the differentiator)
Predictive feed of cards showing acceleration signals — recent velocity above their normal baseline, new Reddit chatter, search interest spikes. Built to catch movement before it peaks. This is the moat.

### Release calendar
Every upcoming release across all major brands. Filterable. Source of truth for the SMS triggers.

### Per-user filters
Each partner sets their own brand toggles, alert preferences, quiet hours, and timezone. Logan only cares about Pokemon? Done. You want everything? Done.

### Affiliate links
Every card has a one-tap "Buy on TCGplayer" or "Buy on eBay" link. Tracked through `/go/:id` for clean analytics and easy network swapping.

---

## Features deferred to later phases

These are NOT being built in Phase 1. They get built only if partner usage shows demand or if we identify a real differentiator angle.

- Portfolio tracking with ROI (CollX/Collectr already do this well)
- Wishlist with target prices (could fold into SMS alerts later)
- Set completion tracker (Collectr does this)
- Graded card data / PSA pop reports
- Card scanning (deep ML investment, not our edge)
- Auction tracking
- Marketplace / buy-sell features

---

## Phases (revised)

### Phase 0 — Setup (Week 0)
Accounts, repos, A2P 10DLC registration kicked off (1-3 week Twilio approval is the critical path).

### Phase 1 — Core MVP (Weeks 1-4)
SMS alerts + trending feed + heating up feed + release calendar. Three brands at launch (Pokemon, Topps, Bandai). Add Panini and Magic in Week 4 if scrapers run clean.

### Phase 2 — Partner beta (Weeks 5-8)
Use it daily with partners. Document what's broken, what's missing, what we hit on. Gather real signals on what to build next.

### Phase 3 — Validation gate
Decision point based on Phase 2 data:
- **If partners use it daily and refer people** → public launch + expand carefully into requested features
- **If partners use it sometimes** → narrow further, keep small, run as side service
- **If partners don't use it** → kill it, save the time

### Phase 4+ — Conditional expansions
Built only after validation. In rough priority:
- Public launch (auth, Stripe, App Store)
- Wishlist / target price alerts (folds into SMS)
- Convention calendar (Alt Art Exchange + show integration — the real edge)
- Pre-order/restock at retailers (Hotstock-style real-time)
- Portfolio tracking (only if a clear angle vs CollX emerges)

---

## Tech stack (in human terms)

- **What I write the app in:** Expo (React Native) — one codebase = web + iOS + Android
- **Where the data lives:** Supabase — login, database, background jobs, realtime
- **How it stays fast:** Cloudflare in front for caching and protection
- **How notifications work:** SMS via Twilio (Phase 1 core), push via Expo (free)
- **Where prices come from:** PriceCharting (main), eBay sold listings, free Pokemon TCG API, Scryfall for Magic
- **How I build it:** Claude Code in terminal, with the engineering spec as reference

---

## Money

### What it costs me to run

**Phase 1 (me + partners):** ~$80/month
- Claude Pro: $20
- PriceCharting: $50
- Twilio (number + SMS at partner scale): $5
- Domain + misc: $5

**Phase 3+ (public, if we get there):** ~$300-500/month depending on scale

### What it could earn

**Affiliate revenue:** TCGplayer ~5% commission, eBay Partner Network 1-4%. Conservative: 500 active users × 10% click-through × $50 average order = real money.

**Pro subscription (if we add it):** $5-10/mo. Validate first.

### Build cost

Solo with Claude Code: **$3-5k first year cash + my time** (compressed because Phase 1 is shorter)

---

## What I have to do

### Time commitment
5-10 hours per week, evenings and slow weekends. Phase 1 fits in 3-4 weeks at that pace.

### Things only I can do
- Sign up for accounts (Supabase, Twilio, PriceCharting, eBay Dev, Apple Developer eventually)
- Make brand/feature decisions
- Manual MSRP and release date entry (boring but necessary)
- Recruit and onboard partners

### Things Claude Code does
- All the actual coding
- Database, scrapers, edge functions
- Frontend screens, routing
- Deployment, cron jobs
- Testing, debugging

---

## Key decisions made

| Decision | Choice | Why |
|---|---|---|
| Web vs mobile first | Web first via Expo, native later | No App Store delays, instant iteration |
| Build vs hire | Solo with Claude Code | Saves $25k+ |
| TCGplayer vs PriceCharting | PriceCharting | Single API, no approval gate |
| User scope at launch | Me + 3-10 partners (invite-only) | Real testing, low compliance scope |
| Phase 1 scope | SMS alerts + trending + heating up only | Differentiated, fast to ship, validates demand |
| Portfolio/wishlist/sets | Deferred to post-validation | Crowded space, build only if proven need |
| Brands at launch | Pokemon + Topps + Bandai | Biggest each category. Add Panini + Magic Week 4. |
| Affiliate strategy | Built in Phase 1 | Monetization works during beta |
| SMS in Phase 1 | Yes, core feature | The actual unique value |
| Partner filters | Individual per-user | Each partner sets own preferences |

---

## Risks I'm aware of

1. **Scraper maintenance is forever.** Ongoing tax.
2. **MSRP and release date data is manual.** No clean API source.
3. **CollX or Collectr could add SMS alerts.** Mitigation: ship fast, build community before they react.
4. **A2P 10DLC approval delay.** Mitigation: kick off day 1 of Phase 0.
5. **Partners might not actually use it.** That's the whole point of Phase 2 — find out fast and adjust before more investment.
6. **Heating Up algorithm needs tuning.** First version will probably miss or false-alarm. Real-world data refines it.

---

## What success looks like

**End of Phase 1:** Me and partners getting SMS alerts for real upcoming releases. Trending and Heating Up feeds returning useful results.

**End of Phase 2:** Partners using daily, referring friends, asking for specific features. Clear signal on Phase 3 direction.

**6 months in:** Either a focused, profitable niche product OR a clean shutdown with minimal sunk cost.

---

## Files to read alongside this

- `02_Engineering_Spec.md` — technical reference for Claude Code
- `03_Build_Roadmap.md` — week-by-week sprint plan with checkboxes
