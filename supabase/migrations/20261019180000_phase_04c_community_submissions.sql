-- Phase 04C community submission and operator review.
-- Additive. Does not publish private drafts, alter official SDKs, or collect fees.
-- Do not reapply earlier migrations.

alter table public.usage_daily
  add column community_submissions integer not null default 0 check (community_submissions >= 0);

create table public.library_submissions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id),
  draft_id uuid not null references public.sdk_drafts (id),
  version_id uuid not null references public.blueprint_versions (id),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  blueprint jsonb not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null check (char_length(btrim(description)) between 1 and 500),
  originator_account_id uuid references public.accounts (id),
  originator_label text not null check (char_length(btrim(originator_label)) between 1 and 80),
  source_sdk_id uuid references public.library_sdks (id),
  source_version_id uuid references public.library_versions (id),
  status text not null check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_account_id uuid references public.accounts (id),
  review_note text,
  library_sdk_id uuid references public.library_sdks (id),
  library_version_id uuid references public.library_versions (id),
  constraint library_submissions_revision_unique unique (draft_id, content_hash),
  constraint library_submissions_lineage_chk check (
    (source_sdk_id is null and source_version_id is null)
    or (source_sdk_id is not null and source_version_id is not null)
  ),
  constraint library_submissions_review_chk check (
    (
      status = 'pending'
      and reviewed_at is null
      and reviewer_account_id is null
      and review_note is null
      and library_sdk_id is null
      and library_version_id is null
    )
    or (
      status = 'approved'
      and reviewed_at is not null
      and reviewer_account_id is not null
      and library_sdk_id is not null
      and library_version_id is not null
    )
    or (
      status = 'rejected'
      and reviewed_at is not null
      and reviewer_account_id is not null
      and review_note is not null
      and char_length(btrim(review_note)) between 1 and 500
      and library_sdk_id is null
      and library_version_id is null
    )
  )
);

create index library_submissions_pending_idx
  on public.library_submissions (created_at asc, id asc)
  where status = 'pending';

create index library_submissions_account_idx
  on public.library_submissions (account_id, created_at desc);

create or replace function public.prevent_library_submission_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'library_submission_immutable';
  end if;
  if new.blueprint is distinct from old.blueprint
     or new.content_hash is distinct from old.content_hash
     or new.account_id is distinct from old.account_id
     or new.draft_id is distinct from old.draft_id
     or new.version_id is distinct from old.version_id
     or new.name is distinct from old.name
     or new.description is distinct from old.description
     or new.originator_account_id is distinct from old.originator_account_id
     or new.originator_label is distinct from old.originator_label
     or new.source_sdk_id is distinct from old.source_sdk_id
     or new.source_version_id is distinct from old.source_version_id
     or new.id is distinct from old.id
  then
    raise exception 'library_submission_immutable';
  end if;
  if old.status <> 'pending'
     and (
       new.status is distinct from old.status
       or new.reviewed_at is distinct from old.reviewed_at
       or new.reviewer_account_id is distinct from old.reviewer_account_id
       or new.review_note is distinct from old.review_note
       or new.library_sdk_id is distinct from old.library_sdk_id
       or new.library_version_id is distinct from old.library_version_id
     )
  then
    raise exception 'library_submission_closed';
  end if;
  return new;
end;
$$;

create trigger library_submissions_immutable
  before update or delete on public.library_submissions
  for each row execute function public.prevent_library_submission_mutation();

alter table public.library_submissions enable row level security;
alter table public.library_submissions force row level security;

revoke all on table public.library_submissions from public, anon, authenticated;
revoke all on function public.prevent_library_submission_mutation() from public, anon, authenticated;
