-- Phase 04A public Library foundation.
-- Additive. Does not publish private drafts, seed official SDKs, or change fees.
-- Do not reapply 20261019133000 or 20261019143000.

create table public.library_sdks (
  id uuid primary key default gen_random_uuid(),
  origin text not null check (origin in ('official', 'community')),
  status text not null check (status in ('published', 'pending', 'rejected', 'withdrawn')),
  creator_account_id uuid references public.accounts (id),
  originator_account_id uuid references public.accounts (id),
  originator_label text not null check (char_length(btrim(originator_label)) between 1 and 80),
  parent_sdk_id uuid references public.library_sdks (id),
  current_version_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null check (char_length(btrim(description)) between 1 and 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.library_versions (
  id uuid primary key default gen_random_uuid(),
  sdk_id uuid not null references public.library_sdks (id),
  version_number integer not null check (version_number > 0),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  blueprint jsonb not null,
  created_at timestamptz not null default now(),
  constraint library_versions_number_unique unique (sdk_id, version_number),
  constraint library_versions_hash_unique unique (sdk_id, content_hash)
);

alter table public.library_sdks
  add constraint library_sdks_current_version_fk
  foreign key (current_version_id) references public.library_versions (id);

create unique index library_sdks_official_name_idx
  on public.library_sdks (name)
  where origin = 'official';

create index library_sdks_published_idx
  on public.library_sdks (updated_at desc, id desc)
  where status = 'published';

create index library_versions_sdk_idx
  on public.library_versions (sdk_id, version_number desc);

alter table public.sdk_drafts
  add column source_sdk_id uuid,
  add column source_version_id uuid,
  add column originator_account_id uuid,
  add column originator_label text;

alter table public.sdk_drafts
  add constraint sdk_drafts_source_sdk_fk
    foreign key (source_sdk_id) references public.library_sdks (id),
  add constraint sdk_drafts_source_version_fk
    foreign key (source_version_id) references public.library_versions (id),
  add constraint sdk_drafts_originator_fk
    foreign key (originator_account_id) references public.accounts (id),
  add constraint sdk_drafts_lineage_chk check (
    (
      source_sdk_id is null
      and source_version_id is null
      and originator_label is null
    )
    or (
      source_sdk_id is not null
      and source_version_id is not null
      and originator_label is not null
      and char_length(btrim(originator_label)) between 1 and 80
    )
  );

create index sdk_drafts_source_sdk_idx
  on public.sdk_drafts (source_sdk_id)
  where source_sdk_id is not null;

alter table public.executions
  add column library_version_id uuid references public.library_versions (id);

alter table public.executions
  alter column draft_id drop not null,
  alter column version_id drop not null;

alter table public.executions
  add constraint executions_subject_chk check (
    (
      draft_id is not null
      and version_id is not null
      and library_version_id is null
    )
    or (
      draft_id is null
      and version_id is null
      and library_version_id is not null
    )
  );

create or replace function public.prevent_library_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'library_version_immutable';
  end if;
  if new.blueprint is distinct from old.blueprint
     or new.content_hash is distinct from old.content_hash
     or new.sdk_id is distinct from old.sdk_id
     or new.version_number is distinct from old.version_number
     or new.id is distinct from old.id
  then
    raise exception 'library_version_immutable';
  end if;
  return new;
end;
$$;

create trigger library_versions_immutable
  before update or delete on public.library_versions
  for each row execute function public.prevent_library_version_mutation();

alter table public.library_sdks enable row level security;
alter table public.library_versions enable row level security;
alter table public.library_sdks force row level security;
alter table public.library_versions force row level security;

revoke all on table public.library_sdks from public, anon, authenticated;
revoke all on table public.library_versions from public, anon, authenticated;
revoke all on function public.prevent_library_version_mutation() from public, anon, authenticated;
