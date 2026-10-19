-- Phase 05B launch preparation and private artwork staging.
-- Additive. Does not mint a token, publish a product, or write a Feed entry.
-- Apply only with operator approval. Do not reapply earlier migrations.
-- Ready rows are wallet-owned preparations. They are not verified launches.

create table public.token_assets (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  content_type text not null check (content_type in ('image/png', 'image/jpeg')),
  width integer not null check (width >= 64),
  height integer not null check (height = width),
  byte_size integer not null check (byte_size between 1 and 5000000),
  storage_path text not null unique check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpg)$'),
  image_ipfs_uri text check (
    image_ipfs_uri is null
    or (char_length(image_ipfs_uri) between 12 and 200 and image_ipfs_uri ~ '^https://[^[:space:]]+$')
  ),
  visibility text not null default 'staged' check (visibility in ('staged', 'published')),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  constraint token_assets_owner_hash_unique unique (account_id, content_hash),
  constraint token_assets_side_chk check (
    (content_type = 'image/png' and width <= 4096)
    or (content_type = 'image/jpeg' and width <= 2048)
  )
);

create index token_assets_account_idx on public.token_assets (account_id, created_at desc);

create table public.token_launches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id),
  wallet_address text not null check (wallet_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  idempotency_key uuid not null,
  source_kind text not null check (source_kind in ('draft', 'library')),
  draft_id uuid references public.sdk_drafts (id),
  library_sdk_id uuid references public.library_sdks (id),
  library_version_id uuid references public.library_versions (id),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  origin text not null check (origin in ('private', 'official', 'community')),
  originator_account_id uuid references public.accounts (id),
  originator_label text not null check (char_length(btrim(originator_label)) between 1 and 80),
  fee_category text not null check (fee_category in ('community_split', 'originator_launch', 'official')),
  token_name text not null check (char_length(token_name) between 1 and 32),
  token_symbol text not null check (token_symbol ~ '^[A-Za-z0-9]{1,13}$'),
  token_description text not null check (char_length(token_description) between 1 and 500),
  website text check (website is null or (char_length(website) between 12 and 200 and website ~ '^https://[^[:space:]]+$')),
  twitter text check (twitter is null or (char_length(twitter) between 12 and 200 and twitter ~ '^https://[^[:space:]]+$')),
  telegram text check (telegram is null or (char_length(telegram) between 12 and 200 and telegram ~ '^https://[^[:space:]]+$')),
  asset_id uuid not null references public.token_assets (id),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  metadata_hash text check (metadata_hash is null or metadata_hash ~ '^[0-9a-f]{64}$'),
  metadata_ipfs_uri text check (
    metadata_ipfs_uri is null
    or (char_length(metadata_ipfs_uri) between 12 and 200 and metadata_ipfs_uri ~ '^https://[^[:space:]]+$')
  ),
  image_ipfs_uri text check (
    image_ipfs_uri is null
    or (char_length(image_ipfs_uri) between 12 and 200 and image_ipfs_uri ~ '^https://[^[:space:]]+$')
  ),
  buy_amount text not null check (buy_amount ~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,9})?$'),
  slippage_bps integer,
  status text not null check (status in ('preparing', 'ready_for_transaction', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint token_launches_idempotency_unique unique (account_id, idempotency_key),
  constraint token_launches_source_chk check (
    (
      source_kind = 'draft'
      and draft_id is not null
      and library_sdk_id is null
      and library_version_id is null
    )
    or (
      source_kind = 'library'
      and draft_id is null
      and library_sdk_id is not null
      and library_version_id is not null
    )
  ),
  constraint token_launches_buy_chk check (
    (buy_amount = '0' and slippage_bps is null)
    or (buy_amount <> '0' and slippage_bps between 1 and 1000)
  ),
  constraint token_launches_ready_chk check (
    status <> 'ready_for_transaction'
    or (
      metadata_hash is not null
      and metadata_ipfs_uri is not null
      and image_ipfs_uri is not null
    )
  )
);

create index token_launches_account_idx on public.token_launches (account_id, created_at desc);

alter table public.token_assets enable row level security;
alter table public.token_assets force row level security;
alter table public.token_launches enable row level security;
alter table public.token_launches force row level security;

revoke all on table public.token_assets from public, anon, authenticated;
revoke all on table public.token_launches from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('launch-artwork', 'launch-artwork', false, 5000000, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;
