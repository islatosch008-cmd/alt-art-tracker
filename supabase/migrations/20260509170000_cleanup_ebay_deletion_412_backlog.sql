-- Cleanup historical noise: api_request_log rows from the broken-RSA
-- period of ebay-deletion-webhook (between 2026-05-08 13:03 PDT first
-- 412 and 2026-05-09 15:37:00 UTC first SUCCESS in P4).
--
-- During that window the webhook returned 412 to every real eBay POST
-- because we used HMAC-SHA1 instead of RSA/ECDSA verification. eBay
-- retried ~136/hour for 24+ hours, stacking 3,274+ failure rows that
-- are now historical noise — they don't reflect any real signal we
-- want to retain.
--
-- DELETE conditions:
--   source = 'ebay_deletion'
--   status_code = 412
--   requested_at < '2026-05-09T15:37:00Z'  (first success was 15:37:36)
--
-- Self-test smoke 412s from earlier in the session are also captured
-- by this WHERE clause (id 9, 10 from 2026-05-08T20:03 UTC). Those
-- were intentionally bad-sig probes — also noise, also fine to drop.
--
-- This migration is one-way. Data lost is purely historical noise
-- (no aggregations, dashboards, or user-facing reports query the
-- ebay_deletion failure history of that window). Any future analytics
-- about eBay's 24h retry behavior have all the signal they need from
-- the 2 self-test 412s I'll re-add via smoke tests if needed.
--
-- WARNING: if /admin/scrapers grafana-style charts query this, they'll
-- see a sudden cliff in the history. None of our existing dashboards
-- do (verified 2026-05-09 audit). If new dashboards land that DO use
-- the data, they should already understand the 412 storm as a P4
-- incident artifact and want to exclude it.

delete from public.api_request_log
where source = 'ebay_deletion'
  and status_code = 412
  and requested_at < '2026-05-09T15:37:00Z';
