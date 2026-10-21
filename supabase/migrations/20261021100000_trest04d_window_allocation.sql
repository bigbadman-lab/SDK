-- TREST-04D incremental creator-fee allocation.
-- Unapplied. Apply only with operator approval, after 20261020260000_trest04_claims_child_fees_emergency.sql.
-- Does not credit a wallet, store a private key, or broadcast a transaction.
-- A confirmed receipt is allocated at most once. Reserve withheld on a receipt
-- is the portion of that receipt kept as the standing solvency floor.
-- The rehearsal control values live in lib/rewards/controls.ts and are not
-- applied by this migration: signer suspended, 0.005 SOL withheld once from
-- confirmed fees, a 0.1 SOL cycle cap, and 1% slippage. They are bounds, not
-- an assumed fee volume, and a production parent cannot receive them.

alter table public.reward_collections
  add column reward_window_id uuid references public.reward_windows (id),
  add column reserve_withheld_lamports bigint not null default 0,
  add column allocated_at timestamptz,
  add constraint reward_collections_reserve_withheld_check check (
    reserve_withheld_lamports >= 0 and reserve_withheld_lamports <= amount_lamports
  ),
  add constraint reward_collections_allocation_check check (
    (
      allocated_at is null
      and reward_window_id is null
      and reserve_withheld_lamports = 0
    )
    or (
      allocated_at is not null
      and (reward_window_id is not null or reserve_withheld_lamports = amount_lamports)
    )
  );

create index reward_collections_unallocated_idx
  on public.reward_collections (parent_mint_address, scope)
  where allocated_at is null;
