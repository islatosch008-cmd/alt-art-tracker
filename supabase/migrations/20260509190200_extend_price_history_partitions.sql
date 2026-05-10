-- Extend price_history monthly partition coverage to 2024-01 .. 2027-12.
--
-- Background: phase1_core_schema.sql seeded only 2026-05/06/07 partitions.
-- The cowork sport-card import (see scripts/import-cowork-sport-cards.ts)
-- contains 10 sales with sale_dates from 2025-10 through 2026-04 — all
-- failed to insert with code 23514 ("no partition of relation
-- price_history found for row") on the first --commit attempt.
--
-- Decision: extend the partition range generously (24 months historical +
-- 24 months forward from 2026-01) rather than a tight fit, so future
-- backfill imports of older eBay/PSA/Cowork data don't trigger the same
-- partial-commit failure. Each empty partition is metadata-only — no
-- storage cost — so over-allocating is cheap insurance.
--
-- Coverage after this migration:
--   2024-01-01 .. 2027-12-31    (48 months, 48 partitions)
--   includes the 3 pre-existing 2026-05/06/07 (CREATE IF NOT EXISTS skips them)
--
-- The price_history_<year>_<month> naming matches the existing convention.
-- A future cron-driven roll-forward can append 2028-01 onwards as 2027-12
-- approaches; tracked separately, not in scope here.

do $$
declare
  yr integer;
  mo integer;
  start_date date;
  end_date date;
  partition_name text;
begin
  for yr in 2024..2027 loop
    for mo in 1..12 loop
      start_date := make_date(yr, mo, 1);
      end_date := (start_date + interval '1 month')::date;
      partition_name := format('price_history_%s_%s', yr, lpad(mo::text, 2, '0'));
      execute format(
        'create table if not exists public.%I partition of public.price_history for values from (%L) to (%L)',
        partition_name, start_date, end_date
      );
    end loop;
  end loop;
end $$;
