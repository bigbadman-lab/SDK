-- Phase 04D wallet-owned API keys and a separate API execution counter.
-- Additive. Does not publish drafts, alter Library versions, or change website quotas.
-- Do not reapply earlier migrations.

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  prefix text not null check (char_length(prefix) between 8 and 16),
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index api_keys_active_account_idx
  on public.api_keys (account_id)
  where revoked_at is null;

alter table public.executions
  add column api_key_id uuid references public.api_keys (id);

alter table public.usage_daily
  add column api_runs integer not null default 0 check (api_runs >= 0);

alter table public.api_keys enable row level security;
alter table public.api_keys force row level security;

revoke all on table public.api_keys from public, anon, authenticated;
