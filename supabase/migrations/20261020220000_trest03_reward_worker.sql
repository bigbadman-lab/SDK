-- TREST-03 worker execution columns.
-- Unapplied. Apply only after 20261020200000_trest02_reward_execution.sql and only with operator approval.
-- Does not store a private key or broadcast a transaction.

alter table public.reward_collections
  add column native_lamports bigint,
  add column wsol_token_lamports bigint not null default 0 check (wsol_token_lamports >= 0),
  add column wsol_converted_lamports bigint not null default 0 check (wsol_converted_lamports >= 0),
  add column rent_excluded_lamports bigint not null default 0 check (rent_excluded_lamports >= 0);

alter table public.reward_intents
  add column message_sha256 text check (message_sha256 is null or message_sha256 ~ '^[0-9a-f]{64}$');

alter table public.reward_intents drop constraint if exists reward_intents_status_check;
alter table public.reward_intents drop constraint if exists reward_intents_signature_state_check;

alter table public.reward_intents
  add constraint reward_intents_status_check check (
    status in ('recorded', 'submitted', 'confirmed', 'failed', 'uncertain', 'unreconciled')
  );

alter table public.reward_intents
  add constraint reward_intents_signature_state_check check (
    (status = 'recorded' and signature is null)
    or (status in ('submitted', 'confirmed', 'failed', 'uncertain', 'unreconciled') and signature is not null)
  );

alter table public.reward_cycle_locks
  add column expires_at timestamptz not null default now();

alter table public.reward_snapshots
  add column cutoff_slot bigint check (cutoff_slot is null or cutoff_slot >= 0);

alter table public.reward_claims
  add column proof_hash text check (proof_hash is null or proof_hash ~ '^[0-9a-f]{64}$');
