-- TREST-03.1 claim recovery statuses.
-- Unapplied. Apply only after 20261020220000_trest03_reward_worker.sql and only with operator approval.
-- Does not store a private key or broadcast a transaction.
-- Rollback, in order, after confirming no claim uses the added statuses:
--   alter table public.reward_claims drop constraint reward_claims_status_check;
--   alter table public.reward_claims add constraint reward_claims_status_check
--     check (status in ('reserved', 'submitted', 'confirmed', 'uncertain'));

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.reward_claims'::regclass
    and contype = 'c'
    and (
      pg_get_constraintdef(oid) ilike '%status in%'
      or pg_get_constraintdef(oid) ilike '%status = any%'
    );
  if constraint_name is not null then
    execute format('alter table public.reward_claims drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.reward_claims
  add constraint reward_claims_status_check check (
    status in ('reserved', 'submitted', 'confirmed', 'failed', 'uncertain', 'unreconciled')
  );
