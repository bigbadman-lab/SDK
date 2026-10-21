-- TREST-07J confirmation recovery and a future rehearsal generation.
-- Forward-only. Applying this file creates no receipt, audit row, liability, or rehearsal.
-- It does not collect fees, buy tokens, unsuspend a signer, or store a key.

alter table public.reward_collections
  add column allocation_deferred boolean not null default false;

alter table public.reward_collections
  add constraint reward_collections_deferred_check check (
    allocation_deferred = false
    or signature = '3kUdMkBarVdzrWneSJueDuQgaUdDwn3VLgCywUK5riN7pD83aRSx8JrT8fBL9BBqJWBbcpY4ueo6FJ5B2Zbo38AF'
  );

alter table public.reward_rehearsals
  add column generation integer not null default 1;

alter table public.reward_rehearsals
  drop constraint reward_rehearsals_parent_unique;

alter table public.reward_rehearsals
  add constraint reward_rehearsals_generation_check check (generation between 1 and 100);

alter table public.reward_rehearsals
  add constraint reward_rehearsals_generation_unique unique (parent_mint_address, scope, generation);

create unique index reward_rehearsals_one_open
  on public.reward_rehearsals (parent_mint_address, scope)
  where status = 'open';

create or replace function public.reward_rehearsals_lock()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'rehearsal schedules are immutable';
  end if;
  if new.parent_mint_address is distinct from old.parent_mint_address
     or new.scope is distinct from old.scope
     or new.window_start_ms is distinct from old.window_start_ms
     or new.generation is distinct from old.generation
     or old.status <> 'open'
     or new.status not in ('stopped', 'closed') then
    raise exception 'rehearsal schedules are immutable';
  end if;
  return new;
end;
$$;

create or replace function public.reward_rehearsals_admit()
returns trigger
language plpgsql
as $$
begin
  if new.generation > 1 and exists (
    select 1
    from public.reward_rehearsals
    where parent_mint_address = new.parent_mint_address
      and scope = new.scope
      and status = 'open'
  ) then
    raise exception 'open rehearsal';
  end if;
  if new.generation > 1 and exists (
    select 1
    from public.reward_intents intent
    where intent.parent_mint_address = new.parent_mint_address
      and intent.scope = new.scope
      and intent.status in ('submitted', 'uncertain', 'unreconciled')
      and not exists (
        select 1
        from public.reward_legacy_recoveries recovery
        where recovery.parent_mint_address = intent.parent_mint_address
          and recovery.scope = intent.scope
          and recovery.idempotency_key = intent.idempotency_key
          and recovery.signature = intent.signature
          and recovery.prior_status = 'uncertain'
      )
  ) then
    raise exception 'unresolved financial state';
  end if;
  if new.generation > 1 and exists (
    select 1
    from public.reward_collections
    where parent_mint_address = new.parent_mint_address
      and scope = new.scope
      and status = 'confirmed'
      and allocated_at is null
  ) then
    raise exception 'unresolved financial state';
  end if;
  if new.generation > 1 and exists (
    select 1
    from public.reward_liabilities
    where parent_mint_address = new.parent_mint_address
      and scope = new.scope
      and status in ('reserved', 'claimable')
  ) then
    raise exception 'unsettled liabilities';
  end if;
  return new;
end;
$$;

create trigger reward_rehearsals_admit
before insert on public.reward_rehearsals
for each row execute function public.reward_rehearsals_admit();

create or replace function public.reward_rehearsal_windows_lock()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'rehearsal windows are immutable';
  end if;
  if tg_op = 'INSERT' then
    if new.outcome <> 'claimed' then
      raise exception 'rehearsal windows are immutable';
    end if;
    if not exists (
      select 1
      from public.reward_rehearsals
      where id = new.rehearsal_id
        and new.window_start_ms = any (window_start_ms)
    ) then
      raise exception 'rehearsal window is not authorised';
    end if;
    if exists (
      select 1
      from public.reward_rehearsal_windows earlier
      join public.reward_rehearsals earlier_rehearsal on earlier_rehearsal.id = earlier.rehearsal_id
      join public.reward_rehearsals current_rehearsal on current_rehearsal.id = new.rehearsal_id
      where earlier.window_start_ms = new.window_start_ms
        and earlier.rehearsal_id <> new.rehearsal_id
        and earlier_rehearsal.parent_mint_address = current_rehearsal.parent_mint_address
        and earlier_rehearsal.scope = current_rehearsal.scope
    ) then
      raise exception 'rehearsal window overlaps another generation';
    end if;
    return new;
  end if;
  if old.rehearsal_id is distinct from new.rehearsal_id
     or old.window_start_ms is distinct from new.window_start_ms
     or old.outcome <> 'claimed'
     or new.outcome not in ('ok', 'stopped') then
    raise exception 'rehearsal windows are immutable';
  end if;
  return new;
end;
$$;

create table public.reward_collection_recoveries (
  id uuid primary key default gen_random_uuid(),
  parent_mint_address text not null,
  scope text not null,
  idempotency_key text not null,
  signature text not null,
  prior_status text not null,
  approval text not null,
  operator_label text not null,
  reason text not null,
  gross_lamports bigint not null,
  fee_lamports bigint not null,
  net_lamports bigint not null,
  reserve_withheld_lamports bigint not null,
  holder_lamports bigint not null,
  buyback_lamports bigint not null,
  deployer_lamports bigint not null,
  snapshot_status text not null,
  created_at timestamptz not null default now(),
  constraint reward_collection_recoveries_identity_check check (
    parent_mint_address = 'BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump'
    and scope = 'test'
    and idempotency_key = 'collect-1792603200000'
    and signature = '3kUdMkBarVdzrWneSJueDuQgaUdDwn3VLgCywUK5riN7pD83aRSx8JrT8fBL9BBqJWBbcpY4ueo6FJ5B2Zbo38AF'
    and prior_status = 'uncertain'
    and approval = 'TREST-07J-COLLECTION-RECOVERY'
    and gross_lamports = 85145307
    and fee_lamports = 5000
    and net_lamports = 85140307
    and reserve_withheld_lamports = 5000000
    and holder_lamports = 24042092
    and buyback_lamports = 24042092
    and deployer_lamports = 32056123
    and snapshot_status = 'historical_unavailable'
    and char_length(operator_label) between 1 and 80
    and char_length(reason) between 1 and 240
  ),
  constraint reward_collection_recoveries_signature_unique unique (signature)
);

create function public.reward_collection_recoveries_lock()
returns trigger
language plpgsql
as $$
begin
  raise exception 'collection recoveries are immutable';
end;
$$;

create trigger reward_collection_recoveries_lock
before update or delete on public.reward_collection_recoveries
for each row execute function public.reward_collection_recoveries_lock();

alter table public.reward_collection_recoveries enable row level security;
alter table public.reward_collection_recoveries force row level security;

revoke all on table public.reward_collection_recoveries from public, anon, authenticated;
revoke all on function public.reward_rehearsals_admit() from public, anon, authenticated;
revoke all on function public.reward_collection_recoveries_lock() from public, anon, authenticated;
