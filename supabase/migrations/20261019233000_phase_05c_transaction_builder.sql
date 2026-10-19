-- Phase 05C unsigned launch binding.
-- Apply only after 20261019220000_phase_05b_launch_preparation.sql and only with operator approval.
-- Does not register a mint, create an address lookup table, or sign a transaction.
-- v1 construction does not require an address lookup table. alt_address stays nullable.

create table public.sdk_parent_config (
  id integer primary key check (id = 1),
  mint_address text check (
    mint_address is null or mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  ),
  token_program text check (
    token_program is null
    or token_program in (
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
    )
  ),
  decimals integer check (decimals is null or decimals between 0 and 9),
  bonding_curve_address text check (
    bonding_curve_address is null or bonding_curve_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  ),
  quote_mint_address text check (
    quote_mint_address is null or quote_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  ),
  associated_quote_address text check (
    associated_quote_address is null or associated_quote_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  ),
  eligible boolean,
  eligibility_reason text check (
    eligibility_reason is null or char_length(eligibility_reason) between 1 and 80
  ),
  graduated boolean,
  pool_address text check (pool_address is null or pool_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  base_vault_address text check (
    base_vault_address is null or base_vault_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  ),
  quote_vault_address text check (
    quote_vault_address is null or quote_vault_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  ),
  depth integer check (depth is null or depth between 0 and 5),
  max_curve_depth integer check (max_curve_depth is null or max_curve_depth between 0 and 5),
  quote_control_address text check (
    quote_control_address is null or quote_control_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  ),
  alt_address text check (alt_address is null or alt_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  alt_authority text check (
    alt_authority is null
    or alt_authority = 'DLhNy5Y33LrSoszV4cG3dEfcXTTmnRMDDUgFLMpt7zwC'
  ),
  alt_status text not null default 'absent' check (
    alt_status in ('absent', 'prepared', 'created', 'extended', 'warm')
  ),
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.launch_builds (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.token_launches (id),
  account_id uuid not null references public.accounts (id),
  wallet_address text not null check (wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  idempotency_key uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  mint_address text not null check (mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  parent_mint_address text not null check (parent_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  metadata_hash text not null check (metadata_hash ~ '^[0-9a-f]{64}$'),
  metadata_uri text not null check (
    char_length(metadata_uri) between 12 and 200 and metadata_uri ~ '^https://[^[:space:]]+$'
  ),
  fee_category text not null check (
    fee_category in ('community_split', 'originator_launch', 'official')
  ),
  shareholders jsonb not null check (jsonb_typeof(shareholders) = 'array'),
  buy_amount text not null check (buy_amount ~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,9})?$'),
  slippage_bps integer check (slippage_bps is null or slippage_bps between 1 and 1000),
  blockhash text not null check (blockhash ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  message_hash text not null check (message_hash ~ '^[0-9a-f]{64}$'),
  transaction text not null check (char_length(transaction) between 16 and 8192),
  coverage text not null check (coverage = 'live'),
  status text not null check (status in ('built', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint launch_builds_idempotency_unique unique (account_id, idempotency_key)
);

create index launch_builds_wallet_idx on public.launch_builds (wallet_address, expires_at);

create table public.builder_nonces (
  nonce text primary key check (nonce ~ '^[A-Za-z0-9_-]{16,80}$'),
  seen_at timestamptz not null default now()
);

alter table public.sdk_parent_config enable row level security;
alter table public.sdk_parent_config force row level security;
alter table public.launch_builds enable row level security;
alter table public.launch_builds force row level security;
alter table public.builder_nonces enable row level security;
alter table public.builder_nonces force row level security;

revoke all on table public.sdk_parent_config from public, anon, authenticated;
revoke all on table public.launch_builds from public, anon, authenticated;
revoke all on table public.builder_nonces from public, anon, authenticated;
