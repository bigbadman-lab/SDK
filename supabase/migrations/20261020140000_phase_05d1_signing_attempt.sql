-- Phase 05D.1 signing attempt state.
-- Additive only. Do not apply until a later gate approves it.
-- Does not store private keys or signed transaction bytes.
-- Does not register a mint or submit a transaction.

alter table public.token_launches
  add column attempt_status text not null default 'ready_for_transaction',
  add column attempt_mint_address text,
  add column attempt_message_hash text;

alter table public.token_launches
  add constraint token_launches_attempt_status_chk check (
    attempt_status in (
      'ready_for_transaction',
      'ready_to_sign',
      'awaiting_wallet',
      'signed',
      'wallet_rejected',
      'expired',
      'invalidated',
      'mint_lost'
    )
  ),
  add constraint token_launches_attempt_mint_chk check (
    attempt_mint_address is null
    or attempt_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  ),
  add constraint token_launches_attempt_hash_chk check (
    attempt_message_hash is null
    or attempt_message_hash ~ '^[0-9a-f]{64}$'
  );

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.launch_builds'::regclass
    and contype = 'c'
    and (
      pg_get_constraintdef(oid) ilike '%status in%'
      or pg_get_constraintdef(oid) ilike '%status = any%'
    );
  if constraint_name is not null then
    execute format('alter table public.launch_builds drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.launch_builds
  add constraint launch_builds_status_check
  check (status in ('built', 'expired', 'invalidated', 'signed'));
