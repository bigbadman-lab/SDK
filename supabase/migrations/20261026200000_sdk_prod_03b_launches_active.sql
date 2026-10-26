-- SDK-PROD-03B public launch gate.
-- Unapplied. Do not run this file against production in this phase.
-- Does not register a mint, set launches_active, change rewards_active, or modify TREST rows.

alter table public.sdk_parent_config
  add column launches_active boolean not null default false;

alter table public.sdk_parent_config
  drop constraint if exists sdk_parent_config_launches_check;

alter table public.sdk_parent_config
  add constraint sdk_parent_config_launches_check check (
    launches_active = false or mint_address is not null
  );

create or replace function public.sdk_parent_config_lock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.mint_address is not null and (
    new.mint_address is distinct from old.mint_address
    or new.token_program is distinct from old.token_program
    or new.decimals is distinct from old.decimals
  ) then
    raise exception 'canonical mint is immutable';
  end if;
  if new.rewards_active and new.mint_address is null then
    raise exception 'rewards require a canonical mint';
  end if;
  if new.launches_active and new.mint_address is null then
    raise exception 'public launches require a canonical mint';
  end if;
  return new;
end;
$$;

revoke all on function public.sdk_parent_config_lock() from public, anon, authenticated;
