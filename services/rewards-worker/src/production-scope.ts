import {
  registrationFromParent,
  resolveProductionParent,
  type CanonicalParentConfig,
  type ProductionRegistration,
} from "../../../lib/rewards/production.ts";
import { createSql } from "./postgres.ts";
import type { RegisteredParent } from "./store.ts";

type Sql = ReturnType<typeof createSql>;

type ConfigRow = {
  mint: string | null;
  tokenProgram: string | null;
  decimals: number | null;
  rewardsActive: boolean;
};

export async function loadProductionParent(sql: Sql): Promise<{
  parent: RegisteredParent | null;
  config: CanonicalParentConfig | null;
  registration: ProductionRegistration | null;
}> {
  try {
    const parents = await sql<RegisteredParent[]>`
      select
        id::text,
        scope,
        symbol,
        mint_address as "mintAddress",
        deployer_address as "deployerAddress",
        fee_recipient_address as "feeRecipientAddress",
        fee_mode as "feeMode",
        token_program as "tokenProgram",
        decimals,
        graduated,
        quote_mint_address as "quoteMintAddress",
        eligible
      from parent_registrations
      where scope = 'production' and symbol = 'SDK'
      limit 2
    `;
    const configs = await sql<ConfigRow[]>`
      select
        mint_address as mint,
        token_program as "tokenProgram",
        decimals,
        rewards_active as "rewardsActive"
      from sdk_parent_config
      where id = 1
    `;
    const row = configs[0];
    const decimals = row?.decimals === null || row?.decimals === undefined ? null : Number(row.decimals);
    const config = row
      ? {
          mint: row.mint,
          tokenProgram: row.tokenProgram,
          decimals: Number.isInteger(decimals) ? decimals : null,
          rewardsActive: row.rewardsActive === true,
        }
      : null;
    const parent = parents.length === 1 ? parents[0] ?? null : null;
    return {
      parent,
      config,
      registration: parent ? registrationFromParent(parent) : null,
    };
  } catch {
    return { parent: null, config: null, registration: null };
  }
}

export async function readProductionOperations(sql: Sql, mint: string): Promise<{
  lastWindow: string | null;
  reconciliation: "clear" | "outstanding" | "unknown";
}> {
  try {
    const windows = await sql<{ lastWindow: Date | string | null }[]>`
      select max(window_start) as "lastWindow"
      from reward_windows
      where scope = 'production'
        and parent_mint_address = ${mint}
        and status = 'allocated'
    `;
    const open = await sql<{ n: number }[]>`
      select count(*)::int as n
      from reward_intents
      where scope = 'production'
        and parent_mint_address = ${mint}
        and status in ('submitted', 'uncertain', 'unreconciled')
    `;
    const raw = windows[0]?.lastWindow ?? null;
    const parsed = raw ? new Date(raw).toISOString() : null;
    const lastWindow = parsed && !Number.isNaN(Date.parse(parsed)) ? parsed : null;
    return {
      lastWindow,
      reconciliation: (open[0]?.n ?? 0) > 0 ? "outstanding" : "clear",
    };
  } catch {
    return { lastWindow: null, reconciliation: "unknown" };
  }
}

export async function readProductionFlags(sql: Sql): Promise<{ launchesActive: boolean; childFeesActive: boolean }> {
  try {
    const rows = await sql<{ launchesActive: boolean | null; childFeesActive: boolean | null }[]>`
      select launches_active as "launchesActive", child_fees_active as "childFeesActive"
      from sdk_parent_config
      where id = 1
    `;
    return {
      launchesActive: rows[0]?.launchesActive === true,
      childFeesActive: rows[0]?.childFeesActive === true,
    };
  } catch {
    return { launchesActive: false, childFeesActive: false };
  }
}

export async function readChildFeeReconciliation(sql: Sql, mint: string): Promise<"clear" | "outstanding" | "unknown"> {
  try {
    const open = await sql<{ n: number }[]>`
      select count(*)::int as n
      from child_fee_distributions
      where scope = 'production'
        and quote_mint_address = ${mint}
        and status in ('submitted', 'uncertain', 'unreconciled')
    `;
    return (open[0]?.n ?? 0) > 0 ? "outstanding" : "clear";
  } catch {
    return "unknown";
  }
}

export function productionParentReady(input: {
  registration: ProductionRegistration | null;
  config: CanonicalParentConfig | null;
  signerAddress: string;
}): ReturnType<typeof resolveProductionParent> {
  return resolveProductionParent(input);
}
