import type postgres from "postgres";

import { rehearsalControl } from "./controls.ts";

type Sql = ReturnType<typeof postgres>;

export async function ensureTestParentControls(
  sql: Sql,
  mint: string,
): Promise<"created" | "preserved" | "rejected"> {
  const configured = rehearsalControl();
  if (!configured.ok) return "rejected";
  const control = configured.control;
  const created = await sql<{ id: string }[]>`
    insert into reward_controls (
      parent_registration_id, parent_mint_address, scope, signer_suspended, reserve_lamports, cycle_cap_lamports, slippage_bps
    )
    select id, mint_address, scope, true, ${control.reserveLamports}::bigint, ${control.cycleCapLamports}::bigint, ${control.slippageBps}
    from parent_registrations
    where mint_address = ${mint} and scope = 'test' and symbol = 'TREST'
    on conflict (parent_registration_id) do nothing
    returning parent_registration_id::text as id
  `;
  if (created[0]) return "created";
  const existing = await sql<{ id: string }[]>`
    select reward_controls.parent_registration_id::text as id
    from reward_controls
    join parent_registrations on parent_registrations.id = reward_controls.parent_registration_id
    where parent_registrations.mint_address = ${mint}
      and parent_registrations.scope = 'test'
      and parent_registrations.symbol = 'TREST'
  `;
  return existing[0] ? "preserved" : "rejected";
}
