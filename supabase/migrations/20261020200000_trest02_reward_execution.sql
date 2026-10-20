-- TREST-02 reward execution persistence.
-- Unapplied. Apply only after 20261020180000_trest01_parent_registration.sql and only with operator approval.
-- Does not store a private key, credit a wallet balance, or broadcast a transaction.

alter table public.reward_collections
  add column gross_lamports bigint,
  add column network_fee_lamports bigint not null default 0 check (network_fee_lamports >= 0),
  add column net_lamports bigint,
  add constraint reward_collections_net_check check (
    net_lamports is null or (gross_lamports is not null and net_lamports >= 0 and net_lamports <= gross_lamports)
  );

create table public.reward_intents (
  id uuid primary key default gen_random_uuid(),
  parent_registration_id uuid not null references public.parent_registrations (id),
  parent_mint_address text not null check (parent_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  scope text not null check (scope in ('production', 'test')),
  kind text not null check (kind in ('collect', 'buyback', 'claim_sol', 'claim_token')),
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{16,80}$'),
  status text not null check (status in ('recorded', 'submitted', 'confirmed', 'failed', 'uncertain')),
  signature text check (signature is null or signature ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
  amount_lamports bigint check (amount_lamports is null or amount_lamports >= 0),
  token_amount text check (token_amount is null or token_amount ~ '^[0-9]+$'),
  created_at timestamptz not null default now(),
  constraint reward_intents_idempotency_unique unique (parent_mint_address, scope, idempotency_key),
  constraint reward_intents_signature_state_check check (
    (status = 'recorded' and signature is null)
    or (status in ('submitted', 'confirmed', 'failed', 'uncertain') and signature is not null)
  )
);

create unique index reward_intents_signature_idx
  on public.reward_intents (signature)
  where signature is not null;

create table public.reward_snapshots (
  id uuid primary key default gen_random_uuid(),
  parent_registration_id uuid not null references public.parent_registrations (id),
  parent_mint_address text not null check (parent_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  scope text not null check (scope in ('production', 'test')),
  window_start timestamptz not null,
  owner_address text not null check (owner_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  balance text not null check (balance ~ '^[0-9]+$'),
  sol_lamports bigint not null check (sol_lamports >= 0),
  token_amount text not null check (token_amount ~ '^[0-9]+$'),
  created_at timestamptz not null default now(),
  constraint reward_snapshots_owner_unique unique (parent_mint_address, scope, window_start, owner_address)
);

create table public.reward_cycle_locks (
  parent_mint_address text not null check (parent_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  scope text not null check (scope in ('production', 'test')),
  holder text not null check (holder ~ '^[A-Za-z0-9_-]{1,80}$'),
  locked_at timestamptz not null default now(),
  primary key (parent_mint_address, scope)
);

create function public.reward_intents_lock()
returns trigger
language plpgsql
as $$
begin
  if new.parent_mint_address is distinct from old.parent_mint_address
     or new.scope is distinct from old.scope
     or new.kind is distinct from old.kind
     or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'reward intent identity is immutable';
  end if;
  return new;
end;
$$;

create trigger reward_intents_lock
before update on public.reward_intents
for each row execute function public.reward_intents_lock();

alter table public.reward_intents enable row level security;
alter table public.reward_intents force row level security;
alter table public.reward_snapshots enable row level security;
alter table public.reward_snapshots force row level security;
alter table public.reward_cycle_locks enable row level security;
alter table public.reward_cycle_locks force row level security;

revoke all on table public.reward_intents from public, anon, authenticated;
revoke all on table public.reward_snapshots from public, anon, authenticated;
revoke all on table public.reward_cycle_locks from public, anon, authenticated;
revoke all on function public.reward_intents_lock() from public, anon, authenticated;
