# Alt Art Tracker — Engineering Spec (CLAUDE.md)

This document is the source of truth for the Alt Art Tracker project. Read this every session before making changes. Update this doc when architectural decisions change.

---

## Project context

**Product:** SMS-first alert and trending intelligence app for trading card / sports card flippers. Core differentiators: SMS drop alerts, predictive Heating Up feed, convention integration (Phase 4).

**Owner:** Ian Slatosch (solo founder, primary developer with Claude Code).

**Phase:** Phase 0 (setup) at time of writing. Targeting Phase 1 MVP completion in 3-4 weeks.

**Beta scope:** Owner + 3-10 invited partners (invite-only, not public). Multi-tenant validated from day 1 with real users.

**Strategic context:** Crowded competitive market (CollX, Collectr, Ludex, etc) means we lead with differentiated features (SMS alerts + Heating Up predictor) and defer crowded features (portfolio, wishlist, set completion) until Phase 3 validation gate proves they're worth building.

**Build philosophy:**
- Multi-tenant from day 1 (RLS on every table)
- Per-user filters and notification preferences
- Mobile-first via Expo, deploy web first
- Modular scrapers, decoupled background jobs
- Affiliate revenue baked in from launch
- Build only what's differentiated; defer the rest

---

## Phase 1 scope (what's actually being built first)

### IN scope
- Auth + invite-only signup
- Phone verification (Twilio Verify)
- Per-user preferences and filters
- Brands: Pokemon, Topps, Bandai (Panini + Magic if scrapers run clean)
- Sets / releases table with `release_date` and `pre_order_opens_at`
- Scrapers: PriceCharting (prices), Pokemon TCG API (metadata), Scryfall (Magic), eBay sold listings, Reddit mentions, Google Trends
- Trending Now feed (popularity_score)
- Heating Up feed (acceleration_score, predictive)
- Release calendar
- SMS alerts (T-30/T-7/T-1/T-0 + drop opens)
- Push notifications
- Affiliate links via `/go/:id`
- Audit logging

### OUT of scope (Phase 3+ if validated)
- Portfolio tracking with cost basis
- Wishlist with target prices
- Set completion tracker
- Graded card data (PSA pop reports)
- Card scanning / image recognition
- Marketplace / buy-sell features
- Auction tracking
- News/rumor feed
- Convention calendar (Phase 4 specifically)

Schema below includes the deferred tables (commented as "DEFERRED") so we don't paint ourselves into a corner, but Phase 1 implementation skips them.

---

## Tech stack

| Layer | Tool | Why |
|---|---|---|
| Frontend | Expo / React Native | iOS + Android + web from one codebase |
| Routing | Expo Router | File-based, cross-platform |
| Backend | Supabase | Auth + Postgres + Edge Functions + Realtime in one |
| Database | Postgres (via Supabase) + TimescaleDB extension | Time-series for price_history |
| Edge / CDN | Cloudflare | WAF, DDoS, caching, image optimization |
| Image hosting | Cloudflare R2 | No egress fees, critical for card images |
| Push notifications | Expo Push | Free, cross-platform |
| SMS | Twilio | Core Phase 1 feature |
| Phone verification | Twilio Verify | Required for SMS opt-in |
| Email | Resend | Transactional, DMARC-compliant |
| Payments | Stripe | Phase 3 only |
| Affiliate | TCGplayer Affiliate, eBay Partner Network | Revenue from buy-link clicks |
| Monitoring | Sentry, Supabase Logs | Errors, uptime, cost alerts |

---

## Repo structure

```
alt-art-tracker/
├── apps/
│   └── mobile/                    # Expo app (web + iOS + Android)
│       ├── app/                   # Expo Router screens
│       ├── components/            # Shared UI components
│       ├── hooks/                 # Custom React hooks
│       ├── lib/                   # Client utilities, Supabase client
│       └── app.config.ts
├── supabase/
│   ├── migrations/                # SQL migrations, version-controlled
│   ├── functions/                 # Edge Functions (Deno)
│   │   ├── scrape-pricecharting/
│   │   ├── scrape-ebay/
│   │   ├── scrape-reddit/
│   │   ├── compute-popularity/
│   │   ├── compute-heating-up/
│   │   ├── check-release-alerts/
│   │   ├── check-drop-alerts/
│   │   ├── send-notifications/
│   │   ├── affiliate-redirect/
│   │   └── twilio-webhook/
│   ├── seed.sql
│   └── config.toml
├── packages/
│   └── shared/                    # Shared types, schemas (Zod)
├── docs/
│   ├── 01_Founder_Overview.md
│   ├── 02_Engineering_Spec.md     # Also at root as CLAUDE.md
│   └── 03_Build_Roadmap.md
├── .env.example
├── CLAUDE.md
└── README.md
```

---

## Database schema

### Phase 1 core tables

```sql
-- Users (managed by Supabase Auth, this is metadata)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  phone_number text,                    -- E.164 format
  phone_verified_at timestamptz,
  role text default 'user',             -- 'owner', 'partner', 'user', 'admin'
  invited_by uuid references public.profiles(id),
  invite_code_used text,
  created_at timestamptz default now(),
  is_pro boolean default false,
  pro_expires_at timestamptz,
  age_verified boolean default false
);

-- Invite codes (Phase 1 invite-only beta)
create table public.invite_codes (
  code text primary key,
  created_by uuid references public.profiles(id),
  intended_for text,
  uses_remaining integer default 1,
  expires_at timestamptz,
  created_at timestamptz default now()
);

-- User preferences (PER-USER, individual settings)
create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  brands text[] default '{}',
  categories text[] default '{}',
  alert_channels text[] default '{push}',
  sms_enabled boolean default false,
  alert_frequency text default 'realtime',
  release_alerts_enabled boolean default true,
  release_alert_days integer[] default '{30, 7, 1, 0}',
  drop_alerts_enabled boolean default true,
  trending_alerts_enabled boolean default false,
  heating_up_alerts_enabled boolean default true,  -- Heating Up SMS alerts
  quiet_hours_start time,
  quiet_hours_end time,
  timezone text default 'America/Chicago',
  updated_at timestamptz default now()
);

-- Brands
create table public.brands (
  id text primary key,
  name text not null,
  category text not null,               -- 'tcg' or 'sports'
  logo_url text,
  active boolean default true
);

-- Sets / products
create table public.sets (
  id uuid primary key default gen_random_uuid(),
  brand_id text not null references public.brands(id),
  name text not null,
  release_date date,
  pre_order_opens_at timestamptz,
  msrp_box numeric,
  msrp_pack numeric,
  msrp_card numeric,
  external_ids jsonb default '{}',
  created_at timestamptz default now()
);

create index on public.sets (release_date);
create index on public.sets (pre_order_opens_at) where pre_order_opens_at is not null;

-- Cards (individual cards or sealed products)
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  set_id uuid references public.sets(id) on delete cascade,
  brand_id text not null references public.brands(id),
  category text not null,
  name text not null,
  card_number text,
  rarity text,
  is_sealed boolean default false,
  msrp numeric,
  current_price numeric,                -- denormalized
  popularity_score numeric default 0,   -- denormalized, current "trending now" score
  heating_up_score numeric default 0,   -- denormalized, predictive acceleration score
  baseline_30d_price numeric,           -- 30-day rolling avg, for anomaly detection
  baseline_30d_volume numeric,
  last_price_check_at timestamptz,
  external_ids jsonb default '{}',
  image_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index on public.cards (brand_id);
create index on public.cards (category);
create index on public.cards (popularity_score desc);
create index on public.cards (heating_up_score desc);
create index on public.cards (last_price_check_at);

-- Price history (time-series, partitioned monthly)
create table public.price_history (
  id bigserial,
  card_id uuid not null references public.cards(id) on delete cascade,
  price numeric not null,
  source text not null,
  condition text,
  recorded_at timestamptz not null default now(),
  primary key (id, recorded_at)
) partition by range (recorded_at);

create index on public.price_history (card_id, recorded_at desc);

-- Volume history (sales count over time, fuels Heating Up signals)
create table public.volume_history (
  id bigserial,
  card_id uuid not null references public.cards(id) on delete cascade,
  sales_count integer not null,
  source text not null,
  recorded_at timestamptz not null default now(),
  primary key (id, recorded_at)
) partition by range (recorded_at);

create index on public.volume_history (card_id, recorded_at desc);

-- Reddit mention tracking
create table public.reddit_mentions (
  id bigserial primary key,
  card_id uuid references public.cards(id) on delete cascade,
  subreddit text not null,
  mention_count integer not null,
  recorded_at timestamptz default now()
);

create index on public.reddit_mentions (card_id, recorded_at desc);

-- Score components (audit trail for both popularity and heating up)
create table public.score_history (
  id bigserial primary key,
  card_id uuid not null references public.cards(id) on delete cascade,
  popularity_score numeric,
  heating_up_score numeric,
  components jsonb not null,            -- breakdown of all signal components
  calculated_at timestamptz default now()
);

create index on public.score_history (card_id, calculated_at desc);
```

### Phase 1 operational tables

```sql
-- Notifications queue
create table public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  payload jsonb not null,
  channel text not null,                -- 'push', 'sms', 'email'
  scheduled_for timestamptz default now(),
  sent_at timestamptz,
  status text default 'pending'
);

create index on public.notification_queue (status, scheduled_for) where status = 'pending';

-- Release alert dedup
create table public.release_alerts_sent (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  set_id uuid not null references public.sets(id) on delete cascade,
  alert_type text not null,             -- 't30', 't7', 't1', 't0', 'drop_open'
  sent_at timestamptz default now(),
  unique (user_id, set_id, alert_type)
);

-- Heating Up alert dedup (don't spam if same card stays "heating" for days)
create table public.heating_up_alerts_sent (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null references public.cards(id) on delete cascade,
  sent_at timestamptz default now()
);

create index on public.heating_up_alerts_sent (user_id, card_id, sent_at desc);

-- Affiliate click tracking
create table public.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  card_id uuid references public.cards(id),
  network text not null,
  affiliate_url text not null,
  clicked_at timestamptz default now()
);

-- API request log (cost + abuse monitoring)
create table public.api_request_log (
  id bigserial primary key,
  source text not null,
  endpoint text not null,
  status_code integer,
  cost_units numeric,
  requested_at timestamptz default now()
);

-- Audit log (security, append-only)
create table public.audit_log (
  id bigserial primary key,
  user_id uuid references public.profiles(id),
  event_type text not null,
  metadata jsonb,
  ip_address inet,
  user_agent text,
  occurred_at timestamptz default now()
);

revoke update, delete on public.audit_log from authenticated;

-- Feature flags
create table public.feature_flags (
  key text primary key,
  enabled boolean default false,
  rollout_percentage integer default 0,
  description text,
  updated_at timestamptz default now()
);

-- Sessions
create table public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_name text,
  ip_address inet,
  last_active_at timestamptz default now(),
  refresh_token_hash text,
  created_at timestamptz default now()
);

-- Rate limiter
create table public.rate_limit_buckets (
  source text primary key,
  requests_in_window integer default 0,
  window_started_at timestamptz default now(),
  max_per_window integer not null
);
```

### DEFERRED — Phase 3+ schema (don't migrate yet)

```sql
-- Portfolio (DEFERRED)
-- create table public.user_portfolio ...

-- Wishlist (DEFERRED)
-- create table public.user_wishlist ...

-- Set completion (DEFERRED, derivable from portfolio)
```

### Row Level Security

Every user-owned table gets RLS policies. Pattern:

```sql
alter table public.user_preferences enable row level security;

create policy "Users see own preferences"
  on public.user_preferences for select
  using (auth.uid() = user_id);

create policy "Users update own preferences"
  on public.user_preferences for update
  using (auth.uid() = user_id);
```

Apply to: `user_preferences`, `notification_queue`, `release_alerts_sent`, `heating_up_alerts_sent`, `user_sessions`, `affiliate_clicks` (own only), `audit_log` (own only, read).

Public-readable: `brands`, `sets`, `cards`, `price_history`, `volume_history`, `score_history`. RLS enabled with permissive read policies.

---

## API design

### Phase 1 Edge Function endpoints

**`POST /search-cards`**
- Body: `{ query, brand?, category?, limit }`
- Returns: cards matching search

**`GET /cards/:id`**
- Returns: card details + current price + 90-day price history + popularity + heating up components

**`GET /trending`**
- Query: `?brand=&category=&limit=50&window=24h|7d|30d`
- Returns: top cards by popularity_score

**`GET /heating-up`**
- Query: `?brand=&category=&limit=50`
- Returns: top cards by heating_up_score (predictive feed)

**`GET /releases`**
- Query: `?brand=&from=&to=`
- Returns: upcoming sets with release_date and pre_order_opens_at

**`PUT /preferences`**
- Body: full preferences object
- Returns: updated preferences

**`POST /verify-phone`**
- Body: `{ phone_number }`
- Sends Twilio Verify code

**`POST /verify-phone-confirm`**
- Body: `{ code }`
- Marks `phone_verified_at`

**`GET /go/:affiliate_id`**
- Public, no auth
- Logs click, redirects to affiliate URL

**`POST /twilio-webhook`**
- Inbound SMS handler (STOP/HELP)

---

## Background jobs (cron)

| Job | Schedule | Purpose |
|---|---|---|
| `scrape-pricecharting-prices` | Every 1hr | Pull current prices, update price_history + cards |
| `scrape-ebay-sealed` | Every 2hr | Sealed sports box prices from sold listings |
| `scrape-reddit-mentions` | Every 4hr | Mention counts → reddit_mentions table |
| `fetch-google-trends` | Every 6hr | Search interest by region |
| `compute-popularity-scores` | Every 1hr | Recalculate "Trending Now" |
| `compute-heating-up-scores` | Every 1hr | Recalculate "Heating Up" predictive scores |
| `check-release-alerts` | Every 1hr | Find sets where T-30/T-7/T-1/T-0 hits, enqueue SMS |
| `check-drop-alerts` | Every 5min | Find pre_order_opens_at hits, enqueue SMS immediately |
| `check-heating-up-alerts` | Every 1hr | Find new entrants to Heating Up top 10, enqueue SMS for opted-in users |
| `process-notifications` | Every 1min | Drain queue, route to Expo Push or Twilio SMS, respect quiet hours |
| `compute-baselines` | Daily | Update `baseline_30d_price` and `baseline_30d_volume` per card |
| `partition-price-history` | Daily | Maintain monthly partitions |
| `cleanup-old-data` | Weekly | Drop API logs older than 90 days |

---

## Trending Now scoring (current popularity)

Composite score, normalized 0-100. Reactive — reflects what's hot RIGHT NOW.

```
price_velocity_24h = (current_price - price_24h_ago) / price_24h_ago
price_velocity_7d = (current_price - price_7d_ago) / price_7d_ago
volume_24h = log10(sales_count_24h + 1)
reddit_velocity = log10(mentions_24h + 1)
trends_velocity = current_search_interest / 7d_avg_interest

raw_score = (
  price_velocity_24h * 0.30 +
  price_velocity_7d * 0.20 +
  volume_24h * 0.25 +
  reddit_velocity * 0.15 +
  trends_velocity * 0.10
)

popularity_score = sigmoid(raw_score) * 100
```

Top 10% = "Trending Now."

---

## Heating Up scoring (predictive acceleration) — THE DIFFERENTIATOR

Different math, different value. Detects ACCELERATION above baseline, not absolute hotness. Catches movement before peaks.

```
# Acceleration: second derivative of price + volume
price_acceleration = price_velocity_24h - price_velocity_24h_ago_yesterday  
volume_acceleration = volume_24h - volume_24h_ago_yesterday

# Anomaly detection: how unusual vs 30-day baseline
price_z_score = (current_price - baseline_30d_price) / stddev_30d_price
volume_z_score = (current_volume - baseline_30d_volume) / stddev_30d_volume

# Early signal indicators (catches things before mass awareness)
new_subreddit_chatter = mentions_24h > (mentions_baseline_30d * 2)
search_spike = trends_24h > (trends_baseline_30d * 1.5)

# Penalty for already-trending (we want PRE-peak, not at-peak)
already_trending_penalty = clamp(popularity_score / 100, 0, 1)

raw_heating_up = (
  price_acceleration * 0.25 +
  volume_acceleration * 0.20 +
  abs(price_z_score) * 0.20 +     # absolute = catches both directions
  abs(volume_z_score) * 0.15 +
  (new_subreddit_chatter ? 0.10 : 0) +
  (search_spike ? 0.10 : 0)
) * (1 - already_trending_penalty * 0.5)  # halve score if already very trending

heating_up_score = sigmoid(raw_heating_up) * 100
```

**Key difference vs popularity:** A card already at the top of Trending has a low Heating Up score (it's already there). A card 60th percentile but accelerating fast has a high Heating Up score.

Top 10% Heating Up = the predictive feed. New entrants trigger SMS for users with `heating_up_alerts_enabled = true`.

Tune weights based on Phase 2 partner feedback. Store all components in `score_history.components` so we can backtest changes.

---

## Security requirements

### Secrets management
- All API keys in Supabase Edge Function secrets
- `.env.local` never committed
- Rotate keys every 90 days

### Authentication
- Supabase Auth with email + password
- Min 12 char passwords, HaveIBeenPwned breach check on signup
- Refresh token rotation
- Invalidate sessions on password change
- Phone verification via Twilio Verify (required for SMS)

### Authorization
- RLS on every user-owned table
- IDOR test in CI

### Network / web headers
```
Content-Security-Policy: default-src 'self'; img-src 'self' https: data:; script-src 'self' 'unsafe-inline'
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
```

Cookies: `HttpOnly; Secure; SameSite=Lax`

### Rate limiting
- Per-IP: 100 req/min on public endpoints
- Per-user: 60 req/min on authenticated
- Per-user: 5 attempts/min on auth endpoints
- Per-user SMS cap: 100/mo (partners), enforced server-side

### SMS compliance
- Every SMS includes "Reply STOP to unsubscribe"
- Inbound STOP webhook flips `sms_enabled = false`
- Reply HELP returns help text
- A2P 10DLC brand registration required (start day 1 of Phase 0)

### Data protection
- Backups encrypted (Supabase default)
- PII-safe logging
- TLS 1.2+ only

### Anti-abuse
- Cloudflare Turnstile CAPTCHA on signup
- Rate limit + auth required on own API
- Affiliate link cloaking via `/go/:id`

### Audit logging
- All auth events
- Privilege changes
- Phone verifications
- Append-only

### Compliance
- DMARC + SPF + DKIM on sending domain
- FTC affiliate disclosures on every page with affiliate links

---

## SMS implementation

```typescript
import twilio from 'twilio';

const client = twilio(
  Deno.env.get('TWILIO_ACCOUNT_SID'),
  Deno.env.get('TWILIO_AUTH_TOKEN')
);

await client.messages.create({
  to: user.phone_number,
  from: Deno.env.get('TWILIO_FROM_NUMBER'),
  body: `Pokemon Crown Zenith drops in 7 days. Pre-orders open Tuesday 9am EST. Reply STOP to unsubscribe.`
});
```

### Quiet hours logic

```typescript
function shouldDeferForQuietHours(user, alertType) {
  if (alertType === 'drop_open') return false; // critical, override
  if (!user.quiet_hours_start || !user.quiet_hours_end) return false;
  
  const localNow = toUserTimezone(new Date(), user.timezone);
  return isWithinRange(localNow, user.quiet_hours_start, user.quiet_hours_end);
}
```

### Release alert cron logic

```typescript
async function checkReleaseAlerts() {
  const today = new Date();
  
  for (const offset of [30, 7, 1, 0]) {
    const targetDate = addDays(today, offset);
    const sets = await fetchSetsByReleaseDate(targetDate);
    
    for (const set of sets) {
      const subscribers = await fetchSubscribers({
        brand_id: set.brand_id,
        release_alerts_enabled: true,
        offset_in_user_alert_days: offset
      });
      
      for (const sub of subscribers) {
        if (await alreadySent(sub.user_id, set.id, `t${offset}`)) continue;
        
        for (const channel of sub.alert_channels) {
          await enqueueNotification({
            user_id: sub.user_id,
            type: `release_t${offset}`,
            channel,
            payload: { set_id: set.id, days_until: offset }
          });
        }
        
        await markSent(sub.user_id, set.id, `t${offset}`);
      }
    }
  }
}
```

### Heating Up alert cron logic

```typescript
async function checkHeatingUpAlerts() {
  // Get current top 10 heating up
  const currentTopHeating = await supabase
    .from('cards')
    .select('id, name, brand_id, heating_up_score, current_price')
    .order('heating_up_score', { ascending: false })
    .limit(10);
  
  // Get users with heating_up_alerts_enabled
  const subscribers = await supabase
    .from('user_preferences')
    .select('user_id, brands, alert_channels')
    .eq('heating_up_alerts_enabled', true);
  
  for (const card of currentTopHeating) {
    for (const sub of subscribers) {
      // Filter by user's brand preferences
      if (!sub.brands.includes(card.brand_id)) continue;
      
      // Skip if alerted on this card in last 7 days (avoid fatigue)
      const recentAlert = await supabase
        .from('heating_up_alerts_sent')
        .select('sent_at')
        .eq('user_id', sub.user_id)
        .eq('card_id', card.id)
        .gte('sent_at', daysAgo(7))
        .maybeSingle();
      
      if (recentAlert.data) continue;
      
      for (const channel of sub.alert_channels) {
        await enqueueNotification({
          user_id: sub.user_id,
          type: 'heating_up',
          channel,
          payload: { 
            card_id: card.id, 
            card_name: card.name,
            heating_up_score: card.heating_up_score,
            current_price: card.current_price
          }
        });
      }
      
      await supabase.from('heating_up_alerts_sent').insert({
        user_id: sub.user_id,
        card_id: card.id
      });
    }
  }
}
```

---

## Data ingestion

### Scraper module pattern

Every data source is a separate Edge Function with same interface:

```typescript
export interface ScraperResult {
  source: string;
  records: PriceRecord[];
  errors: Error[];
  rate_limit_remaining?: number;
}

export async function scrape(): Promise<ScraperResult> {
  // 1. Read tracked cards from DB
  // 2. Check rate_limit_buckets, abort if exceeded
  // 3. Batch API calls
  // 4. Write to price_history + volume_history
  // 5. Update cards.current_price + last_price_check_at
  // 6. Log to api_request_log
  // 7. Return summary
}
```

### Caching layer

Cloudflare in front of Supabase:
- `GET /trending`: 15 min cache
- `GET /heating-up`: 15 min cache
- `GET /cards/:id`: 5 min
- `GET /releases`: 1 hour
- `GET /go/:id`: never cache (must log click)
- All authenticated endpoints: never cache

---

## Affiliate system

### Link cloaking

```
User clicks: https://yourapp.com/go/abc123?card_id=xyz&network=tcgplayer
→ Edge function logs to affiliate_clicks
→ Redirects to: https://www.tcgplayer.com/product/xyz?partner=YOUR_AFFILIATE_ID
```

### FTC disclosure

Every page with affiliate links: "Some links earn us a commission at no cost to you."

---

## Coding conventions

### TypeScript
- Strict mode on
- Zod schemas for all API inputs/outputs
- Explicit return types on exported functions

### React / Expo
- Functional components only
- Tanstack Query for server state
- NativeWind for styling
- One component per file

### Supabase
- All migrations in `supabase/migrations/`
- Migration files: `YYYYMMDDHHMMSS_description.sql`
- Edge functions in TypeScript (Deno runtime)

### Git
- Trunk-based, feature branches → `main`
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`

### Testing
- Playwright E2E for top 3 flows (signup, trending feed, SMS opt-in)
- Vitest unit tests for popularity + heating up scoring (regression-critical)
- Skip 100% coverage; test what matters

---

## Build commands

```bash
# Initial setup
npm install
supabase init
supabase start
cd apps/mobile && npx expo install

# Development
supabase start
cd apps/mobile && npx expo start --web

# Database
supabase migration new <name>
supabase db push --linked

# Edge functions
supabase functions deploy <name>

# Types
supabase gen types typescript --linked > packages/shared/database.types.ts

# Build for web
cd apps/mobile && npx expo export --platform web
```

---

## Environment variables

```bash
# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# External APIs
PRICECHARTING_API_KEY=
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
POKEMON_TCG_API_KEY=
REDDIT_CLIENT_ID=
REDDIT_CLIENT_SECRET=

# Notifications
EXPO_ACCESS_TOKEN=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_VERIFY_SERVICE_SID=
TWILIO_FROM_NUMBER=
RESEND_API_KEY=

# Affiliate
TCGPLAYER_AFFILIATE_ID=
EBAY_PARTNER_ID=

# App
APP_URL=http://localhost:8081
SENTRY_DSN=
```

---

## Deployment

### Web (Phase 1)
- Cloudflare Pages or Netlify (free tier covers Phase 1+2)

### Native (Phase 3)
- EAS Build for iOS + Android, only after validation gate

### Database
- Supabase free tier → Pro ($25/mo) at Phase 3

---

## Files Claude Code should always reference

- This file (`CLAUDE.md`)
- `docs/03_Build_Roadmap.md` — current phase + tasks
- `supabase/migrations/` — current schema state
- `packages/shared/database.types.ts` — generated DB types
