-- TREST-01 parent registration and rewards foundation.
-- Unapplied. Do not run this file as part of local implementation.
-- Does not modify sdk_parent_config, insert a mint, or store a private key.
-- Wallet SOL balances are not reward inventory.

create table public.parent_registrations (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('production', 'test')),
  symbol text not null check (symbol in ('SDK', 'TREST')),
  mint_address text not null check (mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  deployer_address text not null check (deployer_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  fee_recipient_address text not null check (fee_recipient_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  fee_mode text not null check (fee_mode in ('single_recipient', 'fee_sharing', 'holder_rewards', 'unknown')),
  token_program text not null check (
    token_program in (
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
    )
  ),
  decimals integer not null check (decimals between 0 and 9),
  bonding_curve_address text check (
    bonding_curve_address is null or bonding_curve_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  ),
  graduated boolean not null,
  pool_address text check (pool_address is null or pool_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  quote_mint_address text not null check (quote_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  eligible boolean not null check (eligible = true),
  eligibility_reason text not null check (char_length(eligibility_reason) between 1 and 80),
  verified_at timestamptz not null,
  registered_by text not null check (registered_by ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  evidence_hash text not null check (evidence_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint parent_registrations_mint_unique unique (mint_address),
  constraint parent_registrations_scope_symbol_check check (
    (scope = 'test' and symbol = 'TREST')
    or (scope = 'production' and symbol = 'SDK')
  ),
  constraint parent_registrations_recipient_check check (
    fee_mode <> 'single_recipient' or fee_recipient_address = deployer_address
  )
);

create unique index parent_registrations_production_scope_idx
  on public.parent_registrations (scope)
  where scope = 'production';

create unique index parent_registrations_trest_idx
  on public.parent_registrations (symbol)
  where symbol = 'TREST';

create function public.parent_registrations_lock()
returns trigger
language plpgsql
as $$
begin
  if new.mint_address is distinct from old.mint_address
     or new.scope is distinct from old.scope
     or new.symbol is distinct from old.symbol
     or new.deployer_address is distinct from old.deployer_address
     or new.fee_recipient_address is distinct from old.fee_recipient_address
     or new.fee_mode is distinct from old.fee_mode then
    raise exception 'parent identity is immutable';
  end if;
  return new;
end;
$$;

create trigger parent_registrations_lock
before update on public.parent_registrations
for each row execute function public.parent_registrations_lock();

alter table public.launch_builds
  add column parent_scope text not null default 'production' check (parent_scope in ('production', 'test')),
  add column parent_registration_id uuid references public.parent_registrations (id);

create table public.reward_collections (
  id uuid primary key default gen_random_uuid(),
  parent_registration_id uuid not null references public.parent_registrations (id),
  parent_mint_address text not null check (parent_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  scope text not null check (scope in ('production', 'test')),
  signature text not null check (signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  amount_lamports bigint not null check (amount_lamports > 0),
  slot bigint not null check (slot >= 0),
  source text not null check (source = 'creator_vault'),
  status text not null check (status in ('submitted', 'confirmed', 'uncertain')),
  credited boolean not null default false,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint reward_collections_signature_unique unique (signature),
  constraint reward_collections_credit_check check (
    (status = 'confirmed' and credited = true and confirmed_at is not null)
    or (status <> 'confirmed' and credited = false)
  )
);

create table public.reward_windows (
  id uuid primary key default gen_random_uuid(),
  parent_registration_id uuid not null references public.parent_registrations (id),
  parent_mint_address text not null check (parent_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  scope text not null check (scope in ('production', 'test')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  collected_lamports bigint not null check (collected_lamports >= 0),
  holder_lamports bigint not null check (holder_lamports >= 0),
  buyback_lamports bigint not null check (buyback_lamports >= 0),
  deployer_retained_lamports bigint not null check (deployer_retained_lamports >= 0),
  status text not null check (status in ('open', 'allocated', 'suspended')),
  created_at timestamptz not null default now(),
  constraint reward_windows_identity_unique unique (parent_mint_address, scope, window_start),
  constraint reward_windows_sum_check check (
    holder_lamports + buyback_lamports + deployer_retained_lamports = collected_lamports
  ),
  constraint reward_windows_span_check check (window_end = window_start + interval '5 minutes')
);

create table public.reward_liabilities (
  id uuid primary key default gen_random_uuid(),
  parent_registration_id uuid not null references public.parent_registrations (id),
  parent_mint_address text not null check (parent_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  scope text not null check (scope in ('production', 'test')),
  kind text not null check (kind in ('holder_sol', 'buyback_sol', 'buyback_token', 'deployer_retained')),
  amount text not null check (amount ~ '^[0-9]+$'),
  asset text not null check (asset in ('sol', 'parent_token')),
  window_id uuid references public.reward_windows (id),
  status text not null check (status in ('reserved', 'claimable', 'paid', 'suspended')),
  evidence_hash text check (evidence_hash is null or evidence_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);

create table public.reward_claims (
  id uuid primary key default gen_random_uuid(),
  liability_id uuid not null references public.reward_liabilities (id),
  parent_mint_address text not null check (parent_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  scope text not null check (scope in ('production', 'test')),
  claimant text not null check (claimant ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  signature text check (signature is null or signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  status text not null check (status in ('reserved', 'submitted', 'confirmed', 'uncertain')),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{16,80}$'),
  created_at timestamptz not null default now(),
  constraint reward_claims_idempotency_unique unique (parent_mint_address, scope, idempotency_key)
);

create table public.reward_controls (
  parent_registration_id uuid primary key references public.parent_registrations (id),
  parent_mint_address text not null check (parent_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  scope text not null check (scope in ('production', 'test')),
  signer_suspended boolean not null default false,
  reserve_lamports bigint not null check (reserve_lamports >= 0),
  cycle_cap_lamports bigint not null check (cycle_cap_lamports >= 0),
  slippage_bps integer not null check (slippage_bps between 1 and 1000),
  updated_at timestamptz not null default now()
);

alter table public.parent_registrations enable row level security;
alter table public.parent_registrations force row level security;
alter table public.reward_collections enable row level security;
alter table public.reward_collections force row level security;
alter table public.reward_windows enable row level security;
alter table public.reward_windows force row level security;
alter table public.reward_liabilities enable row level security;
alter table public.reward_liabilities force row level security;
alter table public.reward_claims enable row level security;
alter table public.reward_claims force row level security;
alter table public.reward_controls enable row level security;
alter table public.reward_controls force row level security;

revoke all on table public.parent_registrations from public, anon, authenticated;
revoke all on table public.reward_collections from public, anon, authenticated;
revoke all on table public.reward_windows from public, anon, authenticated;
revoke all on table public.reward_liabilities from public, anon, authenticated;
revoke all on table public.reward_claims from public, anon, authenticated;
revoke all on table public.reward_controls from public, anon, authenticated;
revoke all on function public.parent_registrations_lock() from public, anon, authenticated;
