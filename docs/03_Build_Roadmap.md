# Alt Art Tracker — Build Roadmap

This doc is the source of truth for what to build, in what order, and what counts as "done." Read alongside the engineering spec.

**Status legend:** ⬜ Not started • 🟡 In progress • ✅ Complete • ⏸️ Paused

---

## Phase 0 — Setup (Week 0)

No coding. Just accounts, repos, and the Twilio approval clock starting.

### Accounts (do these first day)
- ⬜ **Twilio account + A2P 10DLC brand registration** (1-3 week approval, START IMMEDIATELY)
- ⬜ Twilio phone number ($1.15/mo local or $2/mo toll-free)
- ⬜ Twilio Verify service
- ⬜ Supabase account (free tier)
- ⬜ Cloudflare account (free tier) + domain registered
- ⬜ Expo account
- ⬜ PriceCharting API subscription
- ⬜ eBay Developer account
- ⬜ Reddit Developer app (free)
- ⬜ Sentry account (free tier)
- ⬜ Resend account
- ⬜ TCGplayer Affiliate application (approval takes time)
- ⬜ eBay Partner Network application

### Repo + tooling
- ⬜ GitHub repo created
- ⬜ Expo project scaffolded
- ⬜ Supabase project linked
- ⬜ `CLAUDE.md` placed at repo root
- ⬜ `docs/` folder with all 3 docs
- ⬜ `.env.example` with all required keys
- ⬜ Cloudflare Pages connected to GitHub for auto-deploy

### Decisions to lock
- ⬜ Domain name chosen
- ⬜ App name (USPTO + App Store cleared)
- ⬜ Color palette + typography (basic design tokens)
- ⬜ Identify 3-10 partners to invite

**Acceptance:** `git clone` → `npm install` → `supabase start` → `npx expo start --web` opens a blank app. A2P 10DLC application submitted.

---

## Phase 1 — Core MVP (Weeks 1-4, partner beta)

Goal: Ian + 3-10 partners using app daily, getting SMS alerts for upcoming releases, scrolling Trending Now and Heating Up feeds. Pokemon + Topps + Bandai at minimum (add Panini + Magic if scrapers run clean by Week 4).

### Week 1 — Foundation + auth + scrapers

**Database**
- ⬜ Run schema migration (Phase 1 core + operational tables only)
- ⬜ Enable RLS on all user-owned tables, write policies
- ⬜ Seed `brands` table with Pokemon, Topps, Bandai
- ⬜ Generate TypeScript types from schema

**Auth + invites**
- ⬜ Supabase email + password auth
- ⬜ Profile auto-created on signup (DB trigger)
- ⬜ **Invite code system** (signup requires valid code)
- ⬜ Cloudflare Turnstile on signup form
- ⬜ HaveIBeenPwned password check
- ⬜ Phone number field on profile (E.164)
- ⬜ Twilio Verify integration (send code, verify, mark phone_verified_at)
- ⬜ Per-user `user_preferences` row created on signup

**App shell**
- ⬜ Expo Router with tab navigation
- ⬜ Tabs: Trending, Heating Up, Releases, Settings
- ⬜ Auth gate wrapper
- ⬜ Tanstack Query set up
- ⬜ Supabase client with typed queries

**First scrapers**
- ⬜ `scrape-pricecharting-prices` Edge Function
- ⬜ Card import script: Pokemon TCG API → cards table
- ⬜ Card import script: Bandai (One Piece, DBS, Digimon)
- ⬜ Card import script: Topps (manual JSON or scrape)
- ⬜ Centralized rate limiter via `rate_limit_buckets`
- ⬜ pg_cron job: PriceCharting scrape every 1hr
- ⬜ `api_request_log` populated

**Acceptance:** Ian + at least 1 partner can sign up via invite, verify phone, log in, see empty tabs. `cards` table has ~3000 cards. Prices updating hourly.

### Week 2 — Trending Now + scoring infra

**Trending Now feed**
- ⬜ Reddit scraper Edge Function (mention counts in r/PokemonTCG, r/sportscards, r/onepiecetcg, r/mtgfinance)
- ⬜ Google Trends fetch (pytrends or scraperless wrapper)
- ⬜ Volume tracking via PriceCharting + eBay sold counts → `volume_history`
- ⬜ `compute-popularity-scores` Edge Function (algorithm from spec)
- ⬜ Materialized view `trending_cards_view`
- ⬜ Refresh cron every 15 min
- ⬜ `GET /trending` API endpoint
- ⬜ `GET /search-cards` API endpoint
- ⬜ `GET /cards/:id` API endpoint with 90-day price history

**Frontend**
- ⬜ Trending tab: feed with brand filter
- ⬜ Search screen: search box + results
- ⬜ Card detail screen: image, current price, popularity score, price history chart
- ⬜ Skeleton loaders everywhere

**Acceptance:** Ian + partners can browse Trending Now, see real cards moving today, search any card, view detail with price chart.

### Week 3 — Heating Up + release calendar

**Heating Up feed (the differentiator)**
- ⬜ Daily `compute-baselines` job (30-day rolling avgs for price + volume)
- ⬜ `compute-heating-up-scores` Edge Function (algorithm from spec)
- ⬜ Acceleration math validated (price + volume second derivatives)
- ⬜ Anomaly detection vs baseline working
- ⬜ Already-trending penalty applied (we want PRE-peak)
- ⬜ Cron every 1hr
- ⬜ `GET /heating-up` API endpoint
- ⬜ Heating Up tab in app
- ⬜ Score components shown in card detail (transparency builds trust)

**Release calendar**
- ⬜ Scrape/curate upcoming releases from Pokemon.com, Topps.com, Bandai TCG
- ⬜ Populate `sets` table with `release_date`
- ⬜ **Populate `pre_order_opens_at`** for known drops (manual entry per release)
- ⬜ `GET /releases` endpoint
- ⬜ Releases tab

**Per-user filters**
- ⬜ Settings screen
- ⬜ Brand multi-select
- ⬜ Category toggle (TCG / sports)
- ⬜ Release alert toggle + day selection (T-30, T-7, T-1, T-0)
- ⬜ Drop alert toggle
- ⬜ Heating Up alert toggle
- ⬜ Quiet hours + timezone
- ⬜ Apply filters across all feeds

**Acceptance:** Heating Up feed returns useful results (validate manually with partners — does it actually surface things partners think look hot?). Release calendar populated for upcoming sets.

### Week 4 — SMS alerts + affiliate + launch

**SMS infrastructure (critical path)**
- ⬜ A2P 10DLC approval received (validate Phase 0 didn't slip)
- ⬜ Twilio webhook endpoint for STOP/HELP
- ⬜ STOP handler flips `sms_enabled = false`
- ⬜ HELP handler returns help text
- ⬜ "Reply STOP to unsubscribe" appended to every SMS

**Notification routing**
- ⬜ `process-notifications` Edge Function (drains queue every minute)
- ⬜ Routes to Expo Push or Twilio SMS by channel
- ⬜ Respects quiet hours (defers SMS, push goes through immediately)
- ⬜ Critical alerts (drop_open) override quiet hours
- ⬜ Per-user monthly SMS counter enforces 100/mo cap

**Release alerts (the SMS killer feature)**
- ⬜ `check-release-alerts` cron (hourly)
- ⬜ Triggers SMS at T-30, T-7, T-1, T-0 days based on user preferences
- ⬜ `release_alerts_sent` dedup table prevents duplicate sends
- ⬜ Per-user filtering: only alert on user's brands
- ⬜ Manual test: set a `release_date` for tomorrow, verify T-1 SMS fires

**Drop alerts (pre-order open)**
- ⬜ `check-drop-alerts` cron (every 5 min)
- ⬜ When `pre_order_opens_at` hits, immediate SMS to opted-in users
- ⬜ Format: "Pokemon Crown Zenith pre-orders OPEN at Target now"

**Heating Up alerts**
- ⬜ `check-heating-up-alerts` cron (hourly)
- ⬜ Identify new entrants to top 10 Heating Up
- ⬜ SMS to opted-in users (with brand filter)
- ⬜ 7-day dedup per user/card to avoid fatigue

**Push notifications (parallel)**
- ⬜ Expo Push token registration on login
- ⬜ Same notification queue, push channel

**Affiliate**
- ⬜ TCGplayer + eBay Partner IDs configured
- ⬜ `/go/:id` Edge Function (logs click, redirects)
- ⬜ "Buy on TCGplayer" / "Buy on eBay" on every card detail
- ⬜ FTC disclosure footer

**Polish + deploy**
- ⬜ Loading, empty, error states everywhere
- ⬜ PWA manifest + install prompt
- ⬜ Sentry error reporting
- ⬜ Cost alerts on Supabase + PriceCharting + Twilio
- ⬜ Production Supabase project (separate from dev)
- ⬜ Production Cloudflare Pages deploy
- ⬜ Custom domain DNS
- ⬜ Security headers
- ⬜ Run a backup restore test

**Optional: brand expansion**
- ⬜ Add Magic via Scryfall (if scrapers run clean)
- ⬜ Add Panini (if scraper viable)

**Partner onboarding**
- ⬜ Generate invite codes for each partner
- ⬜ Send invites with quick how-to (signup, phone verify, set filters, opt into SMS)
- ⬜ Set up partner feedback channel (group chat or shared doc)

**Acceptance:** Ian + partners receiving SMS alerts for real upcoming releases. Heating Up feed validated as useful. Phase 2 begins.

---

## Phase 2 — Partner beta (Weeks 5-8)

No new feature work unless partners specifically request and validate. Use it. Watch how partners use it. Fix what's broken. Document what's missing.

### Daily ops
- ⬜ Use the app daily as primary card lookup tool
- ⬜ Add new releases to `sets` table as they're announced
- ⬜ Update MSRP data as confirmed
- ⬜ Monitor SMS delivery rates and STOP rate (should be near 0%)
- ⬜ Monitor scraper failures, fix as they break

### Tracking + learning
- ⬜ Weekly partner check-ins: what worked, what didn't, what's missing
- ⬜ Track which features get used (PostHog or Plausible event tracking)
- ⬜ Track which alerts partners click through (heating up vs trending vs releases)
- ⬜ Track affiliate click-through rate

### Bug bash + improvements
- ⬜ Top 5 issues fixed each week
- ⬜ Heating Up algorithm tuning based on partner feedback (was the alert useful?)

### Validation criteria
By end of Phase 2 you need clear answer to:
- Are partners using app daily?
- Are SMS alerts actually useful (or noise)?
- Is Heating Up surfacing real opportunities?
- What's the most-asked-for feature partners DON'T have?
- Would partners pay for a Pro tier?

**Acceptance:** Clear signal on Phase 3 direction. At least 60% of partners using daily.

---

## Phase 3 — Validation gate

Decision point. Don't skip this.

### If partners use it daily and refer people
→ Public launch path:
- Auth hardening (OAuth, 2FA, session mgmt, GDPR)
- Compliance (Privacy Policy, ToS, COPPA, FTC)
- Stripe + Pro tier
- App Store + Google Play submission
- Marketing site (Next.js, schema, AEO content)
- Soft launch to r/PokemonTCG, r/sportscards, conventions
- Gradually add the most-requested deferred feature first

### If partners use it sometimes
→ Narrow further:
- Cut features partners don't use
- Run as side service for known users
- Don't expand publicly

### If partners don't use it
→ Kill it:
- Document learnings
- Salvage reusable code (auth, scrapers) for next project
- Save the time

---

## Phase 4+ — Conditional expansions

Built only after validation gate. Priority based on Phase 2 partner asks.

### Likely most-requested (rank in this order based on data)

**Wishlist / target price alerts**
- Folds into existing SMS infra
- Low cost, high impact

**Convention calendar (Ian's edge)**
- Pull from Zimmad, 3XC, ConLive, Alt Art Exchange
- Show calendar near user location
- Vendor lists per show
- Featured event slot for Alt Art Exchange
- This is the actual moat long-term

**Pre-order/restock at retailers**
- Hotstock or BrickSeek integration
- Real-time Target/Walmart/Pokemon Center monitoring
- High value to flippers

**Auction tracking**
- eBay ending-soon, Goldin, PWCC
- Live auction tracking

**News & rumor feed**
- Pokebeach, Cardlines aggregator

### Lower priority unless explicitly requested

**Portfolio tracking**
- Only if partners specifically ask AND we have an angle vs CollX
- Otherwise CollX serves this audience

**Set completion**
- Same as portfolio, only if differentiated

**Card scanning**
- Heavy ML investment
- Only if it becomes a hard requirement

---

## Decision log

### 2026-05-05 — Initial decisions

- **Web first, native second:** Avoid App Store delays during beta.
- **PriceCharting over TCGplayer:** Single API for TCG + sports, no partner approval gate.
- **Multi-tenant from day 1:** Even with one user.
- **Solo build with Claude Code:** Skip $25k-50k dev shop cost.
- **Pokemon + Topps + Bandai for MVP:** Biggest each category.
- **Affiliate from day 1:** Built in, not retrofit.

### 2026-05-05 — Phase 1 expanded with SMS + partners

- **Beta scope:** solo → me + 3-10 invited partners
- **SMS in Phase 1:** ~$5/mo at partner scale, validates SMS infra early
- **Individual per-user filters:** each partner sets own preferences
- **Release alerts:** T-30, T-7, T-1, T-0 day SMS triggers
- **A2P 10DLC:** must start day 1 of Phase 0 (1-3 week approval)

### 2026-05-05 — Major scope cut after market scan

Competitive scan revealed CollX (20M+ cards, scanning, portfolio, marketplace, $10/mo Pro), Collectr (25+ TCGs, portfolio analytics), Ludex, TCGSnap, etc all serving the broad collection-tracking market. Building a 9th app in this category would burn 200-400 hours rebuilding what exists with no clear advantage.

**Decision:** Cut Phase 1 to ONLY differentiated features. Defer crowded features (portfolio, wishlist, set completion, scanning) to Phase 3 conditional based on partner validation.

**Phase 1 now includes:**
- SMS alerts (releases, drops, heating up)
- Trending Now feed
- Heating Up feed (the predictive differentiator)
- Release calendar
- Per-user filters
- Affiliate links

**Phase 1 timeline:** 8 weeks → 4 weeks (way less to build)

**Heating Up feed added:** Predictive acceleration scoring catches cards before they peak. Different math than Trending Now (current popularity). Real differentiation vs CollX/Collectr who only show current values.

---

## What "done" means at each phase

| Phase | Done = |
|---|---|
| Phase 0 | Repo runs locally. Accounts created. A2P 10DLC submitted. |
| Phase 1 | Ian + partners using app daily. SMS alerts firing for real release dates. Heating Up feed validated as useful. |
| Phase 2 | Clear signal on Phase 3 direction. At least 60% of partners using daily. |
| Phase 3 | Validation gate decision made. Either public launch path or narrow/kill. |
| Phase 4+ | Conditional features built based on partner data. Convention calendar live (the long-term moat). |

---

## What NOT to build (yet, or ever)

- ❌ AI/LLM features (triggers EU AI Act, defer)
- ❌ Crypto/Web3 features (regulatory minefield)
- ❌ User-to-user trading marketplace (huge legal/moderation overhead)
- ❌ Card grading scanner (CollX/Ludex own this)
- ❌ Native iPad layouts pre-validation
- ❌ Dark mode pre-launch
- ❌ Internationalization (US-only at launch)
- ❌ **Anything CollX/Collectr already do well, unless we have a clear differentiation angle**
