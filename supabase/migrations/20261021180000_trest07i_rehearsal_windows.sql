-- TREST-07I bounded rehearsal fence.
-- Forward-only. Do not apply to the hosted database without a separate approval.
-- Does not collect fees, buy tokens, unsuspend a signer, or store a key.

create table public.reward_rehearsals (
  id uuid primary key default gen_random_uuid(),
  parent_mint_address text not null,
  scope text not null,
  status text not null,
  window_start_ms bigint[] not null,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint reward_rehearsals_identity_check check (
    parent_mint_address = 'BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump'
    and scope = 'test'
  ),
  constraint reward_rehearsals_status_check check (status in ('open', 'stopped', 'closed')),
  constraint reward_rehearsals_windows_check check (
    cardinality(window_start_ms) = 3
    and window_start_ms[1] > 0
    and window_start_ms[1] % 300000 = 0
    and window_start_ms[2] = window_start_ms[1] + 300000
    and window_start_ms[3] = window_start_ms[2] + 300000
  ),
  constraint reward_rehearsals_parent_unique unique (parent_mint_address, scope)
);

create table public.reward_rehearsal_windows (
  rehearsal_id uuid not null references public.reward_rehearsals (id),
  window_start_ms bigint not null,
  outcome text not null,
  created_at timestamptz not null default now(),
  primary key (rehearsal_id, window_start_ms),
  constraint reward_rehearsal_windows_outcome_check check (outcome in ('claimed', 'ok', 'stopped'))
);

create function public.reward_rehearsals_lock()
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
     or old.status <> 'open'
     or new.status not in ('stopped', 'closed') then
    raise exception 'rehearsal schedules are immutable';
  end if;
  return new;
end;
$$;

create trigger reward_rehearsals_lock
before update or delete on public.reward_rehearsals
for each row execute function public.reward_rehearsals_lock();

create function public.reward_rehearsal_windows_lock()
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

create trigger reward_rehearsal_windows_lock
before insert or update or delete on public.reward_rehearsal_windows
for each row execute function public.reward_rehearsal_windows_lock();

alter table public.reward_rehearsals enable row level security;
alter table public.reward_rehearsals force row level security;
alter table public.reward_rehearsal_windows enable row level security;
alter table public.reward_rehearsal_windows force row level security;

revoke all on table public.reward_rehearsals from public, anon, authenticated;
revoke all on table public.reward_rehearsal_windows from public, anon, authenticated;
revoke all on function public.reward_rehearsals_lock() from public, anon, authenticated;
revoke all on function public.reward_rehearsal_windows_lock() from public, anon, authenticated;
