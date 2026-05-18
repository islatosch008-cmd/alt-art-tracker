-- ============================================================================
-- Alt Art Tracker 2.0 — Phase 0 (Strip)
-- ============================================================================
-- Forward migration that removes the dead weight ahead of the 2.0 rebuild.
-- Existing migration files are intentionally left untouched (deleting them
-- would corrupt migration history); this migration undoes their effects.
--
-- Unschedules pg_cron jobs for the deleted Edge Functions:
--   * compute-heating-up-scores   (heating-up score compute)
--   * scrape-psa-pop-reports      (PSA pop-report scraper)
--   * scrape-psa-recent-sales     (PSA recent-sales scraper)
--   * scrape-reddit-mentions      (Reddit mentions scraper)
--
-- Drops the dead tables:
--   * psa_pop_reports             (PSA population reports)
--   * psa_graded_sales            (PSA recent graded sales)
--   * psa_card_map                (card_id <-> PSA spec_id mapping)
--   * reddit_mentions             (Reddit mention counts)
--   * set_conflicts               (cross-source conflict-resolution queue)
--
-- Drops the dead column (heating-up is a column on `cards`, not a table):
--   * public.cards.heating_up_score  (+ its index cards_heating_up_score_idx)
--
-- Idempotent: every statement is guarded so re-running is safe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Unschedule pg_cron jobs for the deleted Edge Functions.
--    cron.unschedule() raises if the job is absent — swallow that so the
--    migration is safe whether or not the jobs were ever scheduled.
-- ----------------------------------------------------------------------------
do $$ begin perform cron.unschedule('compute-heating-up-scores'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('scrape-psa-pop-reports');    exception when others then null; end $$;
do $$ begin perform cron.unschedule('scrape-psa-recent-sales');   exception when others then null; end $$;
do $$ begin perform cron.unschedule('scrape-reddit-mentions');    exception when others then null; end $$;

-- ----------------------------------------------------------------------------
-- 2. Drop dead tables. `cascade` removes dependent indexes, policies, and FKs.
-- ----------------------------------------------------------------------------
drop table if exists public.psa_pop_reports cascade;
drop table if exists public.psa_graded_sales cascade;
drop table if exists public.psa_card_map cascade;
drop table if exists public.reddit_mentions cascade;
drop table if exists public.set_conflicts cascade;

-- ----------------------------------------------------------------------------
-- 3. Drop the dead heating-up score column on `cards` and its index.
--    `drop column ... if exists` also drops the dependent index, but the
--    explicit `drop index if exists` keeps this safe if the column was
--    already removed by hand.
-- ----------------------------------------------------------------------------
drop index if exists public.cards_heating_up_score_idx;
alter table public.cards drop column if exists heating_up_score;
