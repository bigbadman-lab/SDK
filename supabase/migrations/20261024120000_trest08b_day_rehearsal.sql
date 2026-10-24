-- TREST-08B bounded 288-window rehearsal.
-- Forward-only. Applying this file creates no receipt, liability, buyback, or rehearsal.
-- It does not collect fees, unsuspend a signer, or alter historical recovery rows.
-- The local TREST-07L migration is not a dependency and must not be applied for this change.

create or replace function public.reward_rehearsal_starts_valid(starts bigint[])
returns boolean
language plpgsql
immutable
as $$
declare
  index integer;
begin
  if starts is null or cardinality(starts) not in (3, 6, 288) then
    return false;
  end if;
  if starts[1] is null or starts[1] <= 0 or starts[1] % 300000 <> 0 then
    return false;
  end if;
  for index in 2..cardinality(starts) loop
    if starts[index] is distinct from starts[1] + (index - 1) * 300000 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

alter table public.reward_rehearsals
  drop constraint reward_rehearsals_windows_check;

alter table public.reward_rehearsals
  add constraint reward_rehearsals_windows_check
  check (public.reward_rehearsal_starts_valid(window_start_ms));

alter table public.reward_rehearsal_windows
  drop constraint reward_rehearsal_windows_outcome_check;

alter table public.reward_rehearsal_windows
  add constraint reward_rehearsal_windows_outcome_check
  check (outcome in ('claimed', 'ok', 'stopped', 'skipped'));

create or replace function public.reward_rehearsals_admit()
returns trigger
language plpgsql
as $$
begin
  if new.generation <> coalesce((
    select max(generation)
    from public.reward_rehearsals
    where parent_mint_address = new.parent_mint_address
      and scope = new.scope
  ), 0) + 1 then
    raise exception 'rehearsal generation';
  end if;
  if new.generation > 1 and exists (
    select 1
    from public.reward_rehearsals
    where parent_mint_address = new.parent_mint_address
      and scope = new.scope
      and status = 'open'
  ) then
    raise exception 'open rehearsal';
  end if;
  if exists (
    select 1
    from public.reward_rehearsals earlier
    where earlier.parent_mint_address = new.parent_mint_address
      and earlier.scope = new.scope
      and earlier.window_start_ms && new.window_start_ms
  ) then
    raise exception 'rehearsal window overlaps another generation';
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
      and allocation_deferred = false
  ) then
    raise exception 'unresolved financial state';
  end if;
  return new;
end;
$$;

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
     or new.outcome not in ('ok', 'stopped', 'skipped') then
    raise exception 'rehearsal windows are immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.reward_rehearsal_starts_valid(bigint[]) from public, anon, authenticated;
