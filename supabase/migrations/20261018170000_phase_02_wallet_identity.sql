-- Phase 02 wallet identity.
-- Accounts, single-use login challenges, and hashed session tokens.
-- No blueprint, launch, feed, rewards, or API-key tables.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  wallet_address text not null,
  created_at timestamptz not null default now(),
  constraint accounts_wallet_address_unique unique (wallet_address),
  constraint accounts_wallet_address_canonical check (
    wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  )
);

create table public.login_challenges (
  id uuid primary key default gen_random_uuid(),
  nonce text not null,
  wallet_address text not null,
  domain text not null,
  network text not null,
  message text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint login_challenges_nonce_unique unique (nonce),
  constraint login_challenges_wallet_canonical check (
    wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'
  )
);

create index login_challenges_wallet_expires_idx
  on public.login_challenges (wallet_address, expires_at);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  absolute_expires_at timestamptz not null,
  revoked_at timestamptz,
  constraint sessions_token_hash_unique unique (token_hash)
);

create index sessions_account_idx on public.sessions (account_id);

create table public.auth_attempts (
  id bigint generated always as identity primary key,
  bucket text not null,
  created_at timestamptz not null default now()
);

create index auth_attempts_bucket_created_idx
  on public.auth_attempts (bucket, created_at);

alter table public.accounts enable row level security;
alter table public.login_challenges enable row level security;
alter table public.sessions enable row level security;
alter table public.auth_attempts enable row level security;

alter table public.accounts force row level security;
alter table public.login_challenges force row level security;
alter table public.sessions force row level security;
alter table public.auth_attempts force row level security;

revoke all on table public.accounts from public, anon, authenticated;
revoke all on table public.login_challenges from public, anon, authenticated;
revoke all on table public.sessions from public, anon, authenticated;
revoke all on table public.auth_attempts from public, anon, authenticated;
