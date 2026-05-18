-- Add total_active to price_history for the Trending volume signal.
--
-- price_history is partitioned by recorded_at. Adding a column to the
-- parent propagates to all existing child partitions automatically
-- (Postgres partitioned-table semantics). Future month-rollover
-- partitions inherit the column from the parent template.
--
-- WHY: compute-trending's volume signal previously counted how many
-- source='ebay_active' rows existed for a card in a window, which only
-- measured scrape frequency, not real listing supply. eBay's Browse API
-- already returns a real total match count per query; scrape-ebay-active
-- now persists it here so the volume signal reflects genuine supply.
--
-- Nullable on purpose: only scrape-ebay-active populates it (for its
-- source='ebay_active' rows). All other sources leave it NULL, and rows
-- where eBay's total wasn't available also stay NULL — consumers must
-- treat NULL as "unknown", not zero.

alter table public.price_history
  add column if not exists total_active integer;

comment on column public.price_history.total_active is
  'eBay active-listing match count for the card at scrape time. '
  'Populated ONLY by scrape-ebay-active for source=''ebay_active'' rows; '
  'NULL for every other source and for ebay_active rows where eBay''s '
  'total was unavailable. Consumed by compute-trending as the volume signal.';
