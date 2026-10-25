-- One like per account per published SDK in any rolling 24 hours.

create table public.library_sdk_votes (
  id uuid primary key default gen_random_uuid(),
  sdk_id uuid not null references public.library_sdks (id),
  account_id uuid not null references public.accounts (id),
  created_at timestamptz not null default now()
);

create index library_sdk_votes_sdk_idx
  on public.library_sdk_votes (sdk_id, created_at desc);

create index library_sdk_votes_account_sdk_idx
  on public.library_sdk_votes (account_id, sdk_id, created_at desc);

alter table public.library_sdk_votes enable row level security;
alter table public.library_sdk_votes force row level security;

revoke all on table public.library_sdk_votes from public, anon, authenticated;
