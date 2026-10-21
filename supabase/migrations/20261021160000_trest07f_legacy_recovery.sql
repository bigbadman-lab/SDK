-- TREST-07F legacy collection recovery audit.
-- Forward-only. Do not apply to the hosted database without a separate approval.
-- Does not update reward_intents, collect fees, or store a key.

create table public.reward_legacy_recoveries (
  id uuid primary key default gen_random_uuid(),
  parent_mint_address text not null,
  scope text not null,
  idempotency_key text not null,
  signature text not null,
  prior_status text not null,
  operator_id text not null,
  approval text not null,
  reason text not null,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  constraint reward_legacy_recoveries_identity_check check (
    parent_mint_address = 'BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump'
    and scope = 'test'
    and (
      (
        idempotency_key = 'collect-1792587300000'
        and signature = '3QkoLCoC9xNnesUMksjxrEVx6UEvdMcZPo9NM8DZZBu4FXUUuqiAZvBvPGMjaZuHyNxyrjbdbLPSVDzbL3Ggi84m'
      )
      or (
        idempotency_key = 'collect-1792587600000'
        and signature = 'Rh18WpUe1wkT8bV8eVev7uTg1SY4jf1tRqdjo6c6Zufmtqbs5n99Yq6kJ3HzLLnxXKdtcKuwjKhWPpQx5E3Cqu6'
      )
    )
  ),
  constraint reward_legacy_recoveries_prior_check check (prior_status = 'uncertain'),
  constraint reward_legacy_recoveries_approval_check check (approval = 'TREST-07F-LEGACY-RECOVERY'),
  constraint reward_legacy_recoveries_operator_check check (operator_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  constraint reward_legacy_recoveries_reason_check check (char_length(reason) between 1 and 240),
  constraint reward_legacy_recoveries_evidence_check check (
    jsonb_typeof(evidence) = 'object'
    and evidence->>'signatureState' = 'absent'
    and evidence->>'transaction' = 'absent'
    and evidence->>'blockhashSlots' = '150'
    and (evidence->>'slotsElapsed') ~ '^[0-9]+$'
    and (evidence->>'slotsElapsed')::bigint >= 150
    and (evidence->>'currentSlot') ~ '^[0-9]+$'
    and (evidence->>'submissionSlot') ~ '^[0-9]+$'
    and (evidence->>'createdAtMs') ~ '^[0-9]+$'
    and (evidence->>'deployerLamports') ~ '^[0-9]+$'
    and (evidence->>'vaultLamports') ~ '^[0-9]+$'
  ),
  constraint reward_legacy_recoveries_key_unique unique (idempotency_key),
  constraint reward_legacy_recoveries_signature_unique unique (signature)
);

create function public.reward_legacy_recoveries_lock()
returns trigger
language plpgsql
as $$
begin
  raise exception 'legacy recovery records are immutable';
end;
$$;

create trigger reward_legacy_recoveries_lock
before update or delete on public.reward_legacy_recoveries
for each row execute function public.reward_legacy_recoveries_lock();

alter table public.reward_legacy_recoveries enable row level security;
alter table public.reward_legacy_recoveries force row level security;

revoke all on table public.reward_legacy_recoveries from public, anon, authenticated;
revoke all on function public.reward_legacy_recoveries_lock() from public, anon, authenticated;
