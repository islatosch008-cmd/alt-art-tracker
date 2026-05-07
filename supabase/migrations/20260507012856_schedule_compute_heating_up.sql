-- compute-heating-up-scores hourly at :30. Spread from compute-popularity
-- (:15) so the two don't overlap their per-card history reads.
--
--   :15  compute-popularity-scores
--   :30  compute-heating-up-scores   ← this
--   :*   process-notifications  (per minute)

select cron.schedule(
  'compute-heating-up-scores',
  '30 * * * *',
  $$ select public.invoke_function('compute-heating-up-scores'); $$
);
