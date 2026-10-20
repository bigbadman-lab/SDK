-- Phase 05D.2B per-launch submission approval.
-- Unapplied. A row authorises one launch, one build, one parent, and one scope.
-- It does not authorise any other transaction and does not store a private key.

create table public.launch_approvals (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.token_launches (id),
  build_id uuid not null references public.launch_builds (id),
  parent_mint_address text not null check (parent_mint_address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  scope text not null check (scope in ('production', 'test')),
  approver_wallet text not null check (approver_wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  created_at timestamptz not null default now(),
  constraint launch_approvals_launch_build_unique unique (launch_id, build_id)
);

alter table public.launch_approvals enable row level security;
alter table public.launch_approvals force row level security;
revoke all on table public.launch_approvals from public, anon, authenticated;
