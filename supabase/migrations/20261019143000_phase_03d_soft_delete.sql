-- Phase 03D: remove a private saved SDK from My SDKs.
-- Executions, blueprint versions, and conversations stay in place.
-- Do not reapply 20261019133000. That migration is already recorded.

alter table public.sdk_drafts
  add column if not exists deleted_at timestamptz;

create index if not exists sdk_drafts_account_active_saved_idx
  on public.sdk_drafts (account_id, saved_at desc)
  where saved_at is not null and deleted_at is null;
