-- AI research agent runs Sunday 09:00 UTC, weekly. Cron format: m h dom mon dow
-- where dow: 0 = Sunday.
select cron.schedule(
  'ai_research',
  '0 9 * * 0',
  $$ select public.invoke_function('ai-research-releases'); $$
);
