-- Phase 03C: a Builder workspace is not a saved SDK until the owner names it.
-- Existing drafts stay saved. Nothing is deleted.

alter table public.sdk_drafts
  add column if not exists saved_at timestamptz,
  add column if not exists saved_name text,
  add column if not exists saved_description text,
  add column if not exists saved_hash text;

update public.sdk_drafts
set saved_at = coalesce(saved_at, updated_at, created_at),
    saved_name = coalesce(saved_name, name),
    saved_description = coalesce(saved_description, description),
    saved_hash = coalesce(saved_hash, content_hash)
where saved_at is null;

create index if not exists sdk_drafts_account_saved_idx
  on public.sdk_drafts (account_id, saved_at desc)
  where saved_at is not null;
