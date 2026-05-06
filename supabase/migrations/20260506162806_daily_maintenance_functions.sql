-- Daily maintenance Postgres functions, called from Edge Functions.

-- 30-day rolling avg of price + volume per card. Run daily.
-- Only writes a baseline when there's data; cards with no history keep
-- their existing baseline (or NULL on first run).
create or replace function public.recompute_30d_baselines()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  with computed as (
    select
      c.id,
      (select avg(price)
         from public.price_history ph
        where ph.card_id = c.id
          and ph.recorded_at > now() - interval '30 days') as avg_price,
      (select avg(sales_count)
         from public.volume_history vh
        where vh.card_id = c.id
          and vh.recorded_at > now() - interval '30 days') as avg_volume
    from public.cards c
  )
  update public.cards
     set baseline_30d_price  = computed.avg_price,
         baseline_30d_volume = computed.avg_volume
    from computed
   where public.cards.id = computed.id
     and (computed.avg_price is not null or computed.avg_volume is not null);

  get diagnostics affected = row_count;
  return affected;
end;
$$;

-- Make sure monthly partitions exist for the current month and the next two.
-- Idempotent — only creates partitions that don't exist yet.
-- Returns rows for each newly-created partition (table name + range).
create or replace function public.maintain_monthly_partitions()
returns table(parent text, partition_name text, range_from date, range_to date)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  parent_name text;
  m integer;
  range_start date;
  range_end date;
  pname text;
begin
  foreach parent_name in array array['price_history', 'volume_history'] loop
    for m in 0..2 loop
      range_start := date_trunc('month', current_date + (m || ' months')::interval)::date;
      range_end   := date_trunc('month', current_date + ((m + 1) || ' months')::interval)::date;
      pname := format('%s_%s', parent_name, to_char(range_start, 'YYYY_MM'));

      if not exists (
        select 1
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
           and c.relname = pname
      ) then
        execute format(
          'create table public.%I partition of public.%I for values from (%L) to (%L)',
          pname, parent_name, range_start, range_end
        );
        parent := parent_name;
        partition_name := pname;
        range_from := range_start;
        range_to := range_end;
        return next;
      end if;
    end loop;
  end loop;
  return;
end;
$$;
