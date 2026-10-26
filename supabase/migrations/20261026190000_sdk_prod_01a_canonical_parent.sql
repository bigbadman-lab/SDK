-- SDK-PROD-01A canonical parent identity.
-- Unapplied. Do not run this file as part of local implementation.
-- Does not insert a mint, activate rewards, open child launches, or modify TREST rows.

alter table public.sdk_parent_config
  add column rewards_active boolean not null default false;

alter table public.sdk_parent_config
  drop constraint if exists sdk_parent_config_rewards_check;

alter table public.sdk_parent_config
  add constraint sdk_parent_config_rewards_check check (
    rewards_active = false or mint_address is not null
  );

create function public.sdk_parent_config_lock()
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
  return new;
end;
$$;

create trigger sdk_parent_config_lock
before update on public.sdk_parent_config
for each row execute function public.sdk_parent_config_lock();

create function public.canonical_parent_identity_check()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  config_mint text;
  config_program text;
  config_decimals integer;
  production_mint text;
  production_program text;
  production_decimals integer;
begin
  select mint_address, token_program, decimals
    into config_mint, config_program, config_decimals
    from public.sdk_parent_config
    where id = 1;
  select mint_address, token_program, decimals
    into production_mint, production_program, production_decimals
    from public.parent_registrations
    where scope = 'production';
  if config_mint is null and production_mint is null then
    return null;
  end if;
  if config_mint is null
     or production_mint is null
     or config_mint <> production_mint
     or config_program is distinct from production_program
     or config_decimals is distinct from production_decimals then
    raise exception 'canonical parent identity diverged';
  end if;
  return null;
end;
$$;

create constraint trigger canonical_parent_identity
after insert or update on public.sdk_parent_config
deferrable initially deferred
for each row execute function public.canonical_parent_identity_check();

create constraint trigger canonical_parent_identity_registration
after insert or update on public.parent_registrations
deferrable initially deferred
for each row
when (new.scope = 'production')
execute function public.canonical_parent_identity_check();

revoke all on function public.sdk_parent_config_lock() from public, anon, authenticated;
revoke all on function public.canonical_parent_identity_check() from public, anon, authenticated;
