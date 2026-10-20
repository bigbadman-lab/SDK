-- TREST-04 claim challenges, child-fee distributions, and emergency sweep audit.
-- Unapplied. Do not run this file against production Supabase.
-- Does not store a private key, a sweep destination, or a signature over real funds.

create table public.reward_claim_challenges (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null check (wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  parent_mint_address text not null check (parent_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  scope text not null check (scope in ('production', 'test')),
  asset text not null check (asset in ('sol', 'parent_token')),
  nonce text not null check (nonce ~ '^[A-Za-z0-9_-]{16,80}$'),
  amount text not null check (amount ~ '^[0-9]+$'),
  domain text not null check (char_length(domain) between 3 and 120),
  expires_at timestamptz not null,
  signature text check (signature is null or signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reward_claim_challenges_nonce_unique unique (scope, parent_mint_address, nonce)
);

create table public.child_fee_distributions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 160),
  child_mint_address text not null check (child_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  quote_mint_address text not null check (quote_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  scope text not null check (scope in ('production', 'test')),
  status text not null check (status in ('recorded', 'submitted', 'confirmed', 'failed', 'uncertain', 'unreconciled')),
  signature text check (signature is null or signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  slot bigint check (slot is null or slot >= 0),
  amount text check (amount is null or amount ~ '^[0-9]+$'),
  created_at timestamptz not null default now(),
  constraint child_fee_distributions_key_unique unique (idempotency_key),
  constraint child_fee_distributions_signature_state_check check (
    (status = 'recorded' and signature is null)
    or (status <> 'recorded' and signature is not null)
  )
);

create table public.child_fee_receipts (
  id uuid primary key default gen_random_uuid(),
  distribution_id uuid not null references public.child_fee_distributions (id),
  recipient_address text not null check (recipient_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  quote_mint_address text not null check (quote_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  amount text not null check (amount ~ '^[0-9]+$'),
  role text not null check (role in ('launcher', 'developer', 'platform')),
  signature text not null check (signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  slot bigint check (slot is null or slot >= 0),
  created_at timestamptz not null default now(),
  constraint child_fee_receipts_recipient_unique unique (distribution_id, recipient_address)
);

create table public.emergency_sweeps (
  id uuid primary key default gen_random_uuid(),
  parent_mint_address text not null check (parent_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  scope text not null check (scope in ('production', 'test')),
  destination_address text not null check (destination_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  signer_address text not null check (signer_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  mode text not null check (mode in ('dry_run', 'execute')),
  status text not null check (status in ('planned', 'submitted', 'confirmed', 'failed', 'uncertain', 'disabled')),
  sol_lamports text not null check (sol_lamports ~ '^[0-9]+$'),
  token_amount text not null check (token_amount ~ '^[0-9]+$'),
  claimable_sol text not null check (claimable_sol ~ '^[0-9]+$'),
  claimable_token text not null check (claimable_token ~ '^[0-9]+$'),
  shortfall boolean not null,
  signature text check (signature is null or signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  created_at timestamptz not null default now(),
  constraint emergency_sweeps_confirmation_check check (
    (status = 'confirmed' and signature is not null)
    or status <> 'confirmed'
  )
);

alter table public.reward_claim_challenges enable row level security;
alter table public.reward_claim_challenges force row level security;
alter table public.child_fee_distributions enable row level security;
alter table public.child_fee_distributions force row level security;
alter table public.child_fee_receipts enable row level security;
alter table public.child_fee_receipts force row level security;
alter table public.emergency_sweeps enable row level security;
alter table public.emergency_sweeps force row level security;

revoke all on table public.reward_claim_challenges from public, anon, authenticated;
revoke all on table public.child_fee_distributions from public, anon, authenticated;
revoke all on table public.child_fee_receipts from public, anon, authenticated;
revoke all on table public.emergency_sweeps from public, anon, authenticated;
