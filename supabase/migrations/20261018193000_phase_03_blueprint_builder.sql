-- Phase 03 private Builder drafts, immutable Blueprint versions, and executions.
-- No token, marketplace, reward, or API-key tables.

create table public.sdk_drafts (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  name text not null,
  description text not null,
  working_blueprint jsonb not null,
  content_hash text not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sdk_drafts_account_updated_idx
  on public.sdk_drafts (account_id, updated_at desc);

create table public.builder_conversations (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null unique references public.sdk_drafts (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.builder_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.builder_conversations (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  failed boolean not null default false,
  created_at timestamptz not null default now()
);

create index builder_messages_conversation_idx
  on public.builder_messages (conversation_id, created_at);

create table public.blueprint_versions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.sdk_drafts (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  content_hash text not null,
  blueprint jsonb not null,
  created_at timestamptz not null default now(),
  constraint blueprint_versions_hash_unique unique (draft_id, content_hash)
);

create table public.executions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  draft_id uuid not null references public.sdk_drafts (id) on delete cascade,
  version_id uuid not null references public.blueprint_versions (id) on delete cascade,
  status text not null check (status in ('RUNNING', 'SUCCESS', 'FAILED', 'REJECTED', 'TIMEOUT')),
  error_code text,
  output jsonb,
  openai_requests integer not null default 0,
  helius_requests integer not null default 0,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_usd numeric(12, 6) not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index executions_account_status_idx
  on public.executions (account_id, status, started_at);

create table public.execution_steps (
  id bigint generated always as identity primary key,
  execution_id uuid not null references public.executions (id) on delete cascade,
  position integer not null,
  step_id text not null,
  status text not null,
  duration_ms integer not null,
  provider_requests integer not null,
  error_code text
);

create table public.usage_daily (
  account_id uuid not null references public.accounts (id) on delete cascade,
  day date not null,
  builder_messages integer not null default 0,
  website_runs integer not null default 0,
  estimated_usd numeric(12, 6) not null default 0,
  primary key (account_id, day)
);

create table public.provider_spend_daily (
  day date primary key,
  estimated_usd numeric(12, 6) not null default 0
);

alter table public.sdk_drafts enable row level security;
alter table public.builder_conversations enable row level security;
alter table public.builder_messages enable row level security;
alter table public.blueprint_versions enable row level security;
alter table public.executions enable row level security;
alter table public.execution_steps enable row level security;
alter table public.usage_daily enable row level security;
alter table public.provider_spend_daily enable row level security;

alter table public.sdk_drafts force row level security;
alter table public.builder_conversations force row level security;
alter table public.builder_messages force row level security;
alter table public.blueprint_versions force row level security;
alter table public.executions force row level security;
alter table public.execution_steps force row level security;
alter table public.usage_daily force row level security;
alter table public.provider_spend_daily force row level security;

revoke all on table public.sdk_drafts from public, anon, authenticated;
revoke all on table public.builder_conversations from public, anon, authenticated;
revoke all on table public.builder_messages from public, anon, authenticated;
revoke all on table public.blueprint_versions from public, anon, authenticated;
revoke all on table public.executions from public, anon, authenticated;
revoke all on table public.execution_steps from public, anon, authenticated;
revoke all on table public.usage_daily from public, anon, authenticated;
revoke all on table public.provider_spend_daily from public, anon, authenticated;
