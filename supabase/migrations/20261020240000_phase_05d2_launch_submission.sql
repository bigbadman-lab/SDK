-- Phase 05D.2 durable launch submission.
-- Unapplied. Apply only after 20261020230000_trest031_reward_claim_status.sql and only with operator approval.
-- Does not store a private key. Signed wire bytes are optional ciphertext, never a secret key.
-- One submission row per prepared launch. A second broadcast cannot insert another mint.

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.token_launches'::regclass
    and contype = 'c'
    and (
      pg_get_constraintdef(oid) ilike '%attempt_status in%'
      or pg_get_constraintdef(oid) ilike '%attempt_status = any%'
    );
  if constraint_name is not null then
    execute format('alter table public.token_launches drop constraint %I', constraint_name);
  end if;
end $$;

alter table public.token_launches
  add constraint token_launches_attempt_status_chk check (
    attempt_status in (
      'ready_for_transaction',
      'ready_to_sign',
      'awaiting_wallet',
      'wallet_rejected',
      'signed',
      'submission_pending',
      'submitted',
      'pending_confirmation',
      'verifying',
      'verified',
      'page_ready',
      'completed',
      'expired',
      'invalidated',
      'mint_lost',
      'failed',
      'uncertain'
    )
  );

alter table public.token_launches
  add column parent_scope text not null default 'production' check (parent_scope in ('production', 'test')),
  add column parent_mint_address text check (
    parent_mint_address is null or parent_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  );

alter table public.token_launches
  add constraint token_launches_parent_scope_chk check (
    (parent_scope = 'production' and parent_mint_address is null)
    or (parent_scope = 'test' and parent_mint_address is not null)
  );

create table public.launch_submissions (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null unique references public.token_launches (id),
  build_id uuid not null references public.launch_builds (id),
  account_id uuid not null references public.accounts (id),
  wallet_address text not null check (wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  child_mint_address text not null check (child_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  parent_mint_address text not null check (parent_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  scope text not null check (scope in ('production', 'test')),
  signature text not null check (signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  message_hash text not null check (message_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (
    status in (
      'submission_pending',
      'submitted',
      'pending_confirmation',
      'verifying',
      'verified',
      'page_ready',
      'failed',
      'uncertain'
    )
  ),
  wire_ciphertext text,
  slot bigint check (slot is null or slot >= 0),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  constraint launch_submissions_signature_unique unique (signature),
  constraint launch_submissions_verified_chk check (
    (status in ('verified', 'page_ready') and slot is not null and verified_at is not null)
    or (status not in ('verified', 'page_ready'))
  )
);

create index launch_submissions_parent_idx
  on public.launch_submissions (scope, parent_mint_address, created_at desc);

alter table public.launch_submissions enable row level security;
alter table public.launch_submissions force row level security;
revoke all on table public.launch_submissions from public, anon, authenticated;
