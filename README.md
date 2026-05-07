# Alt Art Tracker

SMS-first alert + trending intelligence app for trading card / sports card flippers.
Phase 1 invite-only beta. See [docs/01_Founder_Overview.md](docs/01_Founder_Overview.md)
for the why, [CLAUDE.md](CLAUDE.md) for the architecture, and
[docs/03_Build_Roadmap.md](docs/03_Build_Roadmap.md) for what's getting built when.

## Daily startup

Three terminals (or three tabs of the same one). Run in this order:

```bash
# 1. Docker engine (Colima) + Supabase stack
colima start --vm-type=vz --mount-type=virtiofs
cd ~/alt-art-tracker && supabase start

# 2. Edge Functions (auth + verify-phone + scrapers)
cd ~/alt-art-tracker && npm run supabase:functions

# 3. Expo web app
cd ~/alt-art-tracker && npm run web
```

Then open:

| What | URL |
|---|---|
| The app | http://localhost:8081 (or 8082 if 8081 is taken) |
| Supabase Studio (DB GUI) | http://127.0.0.1:54323 |
| Mailpit (catches local emails) | http://127.0.0.1:54324 |

To stop everything at end of day: `Ctrl-C` each terminal, then
`supabase stop && colima stop`.

## Repo layout

```
alt-art-tracker/
├── apps/mobile/                Expo Router app (web + iOS + Android)
├── packages/shared/            Generated DB types, shared exports
├── supabase/
│   ├── migrations/             Schema (tables, RLS, triggers, seeds)
│   ├── functions/              Edge Functions (Deno runtime)
│   │   ├── _shared/            cors, auth, twilio, api-log, rate-limit
│   │   ├── verify-phone-start/
│   │   ├── verify-phone-confirm/
│   │   └── scrape-pricecharting-prices/
│   └── config.toml             Local Supabase config
├── scripts/                    One-off TS scripts (Pokemon import, invites)
├── docs/                       Founder overview, eng spec, roadmap
└── CLAUDE.md                   Mirror of eng spec — Claude Code reads first
```

## Common commands

```bash
# Database
npm run supabase:reset           # nuke + re-apply all migrations + seed
npm run supabase:status          # show all local URLs and keys
npm run supabase:types           # regenerate packages/shared/database.types.ts

# Migrations
supabase migration new <name>    # create new empty migration file

# Scrapers + imports
npm run import:pokemon           # import recent Pokemon TCG sets/cards
npm run import:pokemon -- --all  # import everything (~17k cards)
npm run invite:new -- "Sam"      # generate a partner invite code
```

## Secrets

All secrets live in gitignored `.env` files:

- `apps/mobile/.env.local` — `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY` (loaded by Expo at dev time, ship in JS bundle)
- `supabase/functions/.env` — Twilio + Anthropic + PSA + (when set) eBay/Reddit (loaded by `supabase functions serve`)
- `.env.local` (root) — placeholders for everything; reference template

See `supabase/functions/.env.example` for the canonical list of variable
names. **NEVER use editor autosave files (`.env.save`)** — those are
gitignored but copy-paste mistakes have leaked secrets twice already.

To rotate a key: change it in the relevant `.env` file, restart the affected
process. Never paste a secret into chat, an issue, or a commit.

## GitHub Actions secrets (Google Trends fetcher)

The `.github/workflows/google-trends-cron.yml` workflow runs daily at
07:00 UTC on a hosted runner. It needs two repository secrets:

- `SUPABASE_URL` — production Supabase URL (e.g. `https://<ref>.supabase.co`)
- `SUPABASE_SERVICE_ROLE_KEY` — production service role key (admin)

Add both at GitHub → repo Settings → Secrets and variables → Actions →
"New repository secret". The workflow can also be triggered manually
from the Actions tab.

## Status: Phase 1 Week 1 acceptance

| Acceptance criterion | Status |
|---|---|
| Auth — signup with invite code | ✅ |
| Phone verification (Twilio Verify) | ✅ live |
| App shell with 4 tabs + auth gate | ✅ |
| Pokemon TCG cards in DB | ✅ 2911 cards across 15 sets (>= 2024) |
| PriceCharting scraper | ⚠️ scaffolded; needs PRICECHARTING_API_KEY to run live |
| Hourly price refresh (pg_cron) | ⏸️ Week 2 — wire after PriceCharting key + card→pricecharting_id mapping pass |
| First partner can sign up | ⏸️ ready (use `npm run invite:new`); needs an actual partner |

## Backups + safety

- Local DB volume persists across `supabase stop` / `start`. Wiped on `supabase db reset`.
- All migrations are version-controlled; re-running them rebuilds the schema.
- Seeds (brands, OWNER invite) are idempotent.
- Production DB and a real backup story land Week 4 when we move to Supabase Cloud.
