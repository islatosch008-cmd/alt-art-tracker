-- Add external_ids jsonb to price_history for source-specific provenance.
--
-- price_history is partitioned by recorded_at. Adding a column to the
-- parent propagates to all existing child partitions automatically
-- (Postgres partitioned-table semantics). Future month-rollover
-- partitions inherit the column from the parent template.
--
-- Driven by the cowork-collected sport cards import which needs to
-- store {listing_url, psa_grade, listing_title} per sale row. The
-- column will be reused for future eBay sold-listing imports
-- ({item_id, condition_id}) and any other source that has per-sale
-- provenance worth retaining.
--
-- DEFAULT '{}' applies to all existing rows so the NOT NULL is safe
-- to add in one statement (no separate backfill needed).

alter table public.price_history
  add column if not exists external_ids jsonb not null default '{}'::jsonb;

comment on column public.price_history.external_ids is
  'Source-specific identifiers and metadata. For cowork_collection: '
  '{listing_url, psa_grade, listing_title}. For ebay sources: '
  '{item_id, condition_id}. For tcgcsv: {tcgplayer_id}. Schema varies '
  'by source; consumer code should defensively check keys.';
