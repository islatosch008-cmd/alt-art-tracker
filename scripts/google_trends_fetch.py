#!/usr/bin/env python3
"""
Google Trends → trends_history daily fetcher.

Runs in GitHub Actions on schedule (daily 07:00 UTC). Pulls top-50
popularity-scored cards from Supabase via REST, queries Google Trends
for each via pytrends, upserts daily search-interest scores back to
public.trends_history.

Required env (set as repository secrets in GitHub → Settings → Secrets):
  SUPABASE_URL                — e.g. https://<project-ref>.supabase.co
  SUPABASE_SERVICE_ROLE_KEY   — service role key for upserts

Why GH Actions and not an Edge Function:
  pytrends scrapes Google Trends and depends on multiple Python libraries
  (lxml, pandas, requests). Deno Edge Functions can't run Python; a Fly.io
  worker would cost $; GitHub Actions free tier covers this comfortably
  (~10 min/day for 50 cards at 12s pacing).

Pacing:
  pytrends triggers Google's bot detection if hammered. We sleep 12s
  between queries. 50 cards × 12s + headers ≈ 11 minutes. Well within
  the 6h GH Actions free-tier per-job ceiling.
"""

from __future__ import annotations

import os
import sys
import time

import requests

try:
    from pytrends.request import TrendReq
except ImportError:
    print("pytrends not installed — `pip install pytrends`", file=sys.stderr)
    sys.exit(1)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not SUPABASE_URL or not SERVICE_KEY:
    print("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", file=sys.stderr)
    sys.exit(2)

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}

TOP_N = 50
SLEEP_BETWEEN_QUERIES_S = 12
REGION = "US"
TIMEFRAME = "now 7-d"  # Google Trends supports: "now 1-H", "now 4-H", "today 5-y", etc.


def fetch_top_cards() -> list[dict]:
    """Top-N most-popular cards. Filters to cards with a real name (not blank)."""
    url = (
        f"{SUPABASE_URL}/rest/v1/cards"
        f"?select=id,name,brand_id"
        f"&order=popularity_score.desc.nullslast"
        f"&limit={TOP_N}"
    )
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    cards = r.json()
    # Filter junk and very generic names ("Energy", "Pikachu") that would
    # return noisy / non-card-specific Google Trends data. Heuristic: require
    # at least 2 words.
    return [c for c in cards if c.get("name") and len(c["name"].split()) >= 2]


def upsert_rows(rows: list[dict]) -> None:
    if not rows:
        return
    url = f"{SUPABASE_URL}/rest/v1/trends_history?on_conflict=card_id,region,date_reported"
    headers = {**HEADERS, "Prefer": "resolution=merge-duplicates"}
    r = requests.post(url, json=rows, headers=headers, timeout=30)
    if not r.ok:
        print(f"  upsert failed {r.status_code}: {r.text[:200]}", file=sys.stderr)
        r.raise_for_status()


def log_outcome(endpoint: str, status_code: int, cost_units: int) -> None:
    """Mirror the Edge Function pattern — one row per run so /admin/scrapers
    can compute health + last-run timing."""
    url = f"{SUPABASE_URL}/rest/v1/api_request_log"
    payload = {
        "source": "google_trends",
        "endpoint": endpoint,  # 'success' | 'degraded' | 'failure'
        "status_code": status_code,
        "cost_units": cost_units,
    }
    try:
        r = requests.post(url, json=payload, headers=HEADERS, timeout=15)
        if not r.ok:
            print(f"  log failed {r.status_code}: {r.text[:200]}", file=sys.stderr)
    except Exception as e:
        # Logging failure should never take down a run.
        print(f"  log threw: {e}", file=sys.stderr)


def main() -> None:
    cards = fetch_top_cards()
    print(f"Fetched {len(cards)} cards from Supabase", flush=True)
    if not cards:
        print("No cards to query — exiting cleanly")
        return

    pytrends = TrendReq(hl="en-US", tz=0)
    rows: list[dict] = []
    success = 0
    skipped_empty = 0
    errored = 0

    for idx, card in enumerate(cards):
        keyword = card["name"]
        try:
            pytrends.build_payload([keyword], timeframe=TIMEFRAME, geo=REGION)
            df = pytrends.interest_over_time()
            if df is None or df.empty:
                skipped_empty += 1
                print(f"  [{idx + 1}/{len(cards)}] {keyword!r}: no data", flush=True)
            else:
                added = 0
                for ts, row in df.iterrows():
                    val = int(row[keyword])
                    rows.append(
                        {
                            "card_id": card["id"],
                            "region": REGION,
                            "search_interest": max(0, min(100, val)),
                            "date_reported": ts.strftime("%Y-%m-%d"),
                        }
                    )
                    added += 1
                success += 1
                print(f"  [{idx + 1}/{len(cards)}] {keyword!r}: +{added} rows", flush=True)
        except Exception as e:
            errored += 1
            print(f"  [{idx + 1}/{len(cards)}] {keyword!r} FAILED: {e}", flush=True)

        # Pacing — protects against Google's bot detection. Skip the last sleep.
        if idx < len(cards) - 1:
            time.sleep(SLEEP_BETWEEN_QUERIES_S)

    if rows:
        # Upsert in batches of 100 to keep PostgREST payload reasonable.
        for i in range(0, len(rows), 100):
            upsert_rows(rows[i : i + 100])
        print(f"\nUpserted {len(rows)} rows to trends_history", flush=True)

    print(
        f"Done. success={success} skipped_empty={skipped_empty} errored={errored}",
        flush=True,
    )

    # Three-outcome log mirrors the Edge Function recordOutcome pattern.
    if cards and success == 0:
        log_outcome("failure", 502, 0)
        # Non-zero exit so GH Actions surfaces a red X.
        sys.exit(3)
    elif success > 0 and len(rows) > 0:
        log_outcome("success", 200, len(rows))
    else:
        log_outcome("degraded", 200, 0)


if __name__ == "__main__":
    main()
