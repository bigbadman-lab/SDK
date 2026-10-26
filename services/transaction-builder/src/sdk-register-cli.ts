import { Connection, PublicKey } from "@solana/web3.js";

import {
  classifyCanonicalIdentity,
  runRegister,
  type CanonicalIdentity,
  type ExistingCanonical,
  type RegisterIo,
} from "../../../lib/sdk/canonical-registration.ts";
import { publicChildLaunchesOpen } from "../../../lib/launch/public-launch.ts";
import { observeQuoteParent } from "./chain.ts";
import { createSql } from "./store.ts";

type Sql = ReturnType<typeof createSql>;

function blocked(code: string): { code: number; out: string } {
  return { code: 2, out: `blocked\ncode=${code}\nrewards=inactive\nchild_launches=inactive\nwrites=0` };
}

function mapConfig(row: {
  mint: string | null;
  tokenProgram: string | null;
  decimals: number | null;
  quoteMint: string | null;
} | undefined): ExistingCanonical["config"] {
  if (!row) return null;
  return { mint: row.mint, tokenProgram: row.tokenProgram, decimals: row.decimals, quoteMint: row.quoteMint };
}

function mapProduction(row: {
  mint: string;
  tokenProgram: string;
  decimals: number;
  quoteMint: string;
  deployer: string;
  feeRecipient: string;
  feeMode: string;
} | undefined): ExistingCanonical["production"] {
  return row ?? null;
}

async function readExisting(sql: Sql): Promise<ExistingCanonical | "unavailable"> {
  try {
    const config = await sql<{
      mint: string | null;
      tokenProgram: string | null;
      decimals: number | null;
      quoteMint: string | null;
    }[]>`
      select mint_address as mint, token_program as "tokenProgram", decimals, quote_mint_address as "quoteMint"
      from sdk_parent_config
      where id = 1
    `;
    const production = await sql<{
      mint: string;
      tokenProgram: string;
      decimals: number;
      quoteMint: string;
      deployer: string;
      feeRecipient: string;
      feeMode: string;
    }[]>`
      select
        mint_address as mint,
        token_program as "tokenProgram",
        decimals,
        quote_mint_address as "quoteMint",
        deployer_address as deployer,
        fee_recipient_address as "feeRecipient",
        fee_mode as "feeMode"
      from parent_registrations
      where scope = 'production'
    `;
    return { config: mapConfig(config[0]), production: mapProduction(production[0]) };
  } catch {
    return "unavailable";
  }
}

async function schemaReady(sql: Sql): Promise<boolean | "unavailable"> {
  try {
    const rows = await sql<{ rewards: boolean; identity: boolean }[]>`
      select
        exists (
          select 1 from information_schema.columns
          where table_schema = 'public'
            and table_name = 'sdk_parent_config'
            and column_name = 'rewards_active'
        ) as rewards,
        exists (
          select 1 from pg_trigger
          where tgname = 'canonical_parent_identity'
            and not tgisinternal
        ) as identity
    `;
    return rows[0]?.rewards === true && rows[0]?.identity === true;
  } catch {
    return "unavailable";
  }
}

async function commitIdentity(sql: Sql, identity: CanonicalIdentity): Promise<"ok" | "idempotent" | "blocked" | "rolled_back"> {
  try {
    return await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(814201)`;
      const config = await tx<{
        mint: string | null;
        tokenProgram: string | null;
        decimals: number | null;
        quoteMint: string | null;
      }[]>`
        select mint_address as mint, token_program as "tokenProgram", decimals, quote_mint_address as "quoteMint"
        from sdk_parent_config
        where id = 1
        for update
      `;
      const production = await tx<{
        mint: string;
        tokenProgram: string;
        decimals: number;
        quoteMint: string;
        deployer: string;
        feeRecipient: string;
        feeMode: string;
      }[]>`
        select
          mint_address as mint,
          token_program as "tokenProgram",
          decimals,
          quote_mint_address as "quoteMint",
          deployer_address as deployer,
          fee_recipient_address as "feeRecipient",
          fee_mode as "feeMode"
        from parent_registrations
        where scope = 'production'
        for update
      `;
      const kind = classifyCanonicalIdentity(identity, {
        config: mapConfig(config[0]),
        production: mapProduction(production[0]),
      });
      if (kind === "idempotent") return "idempotent" as const;
      if (kind === "conflict") throw new Error("blocked");
      if (!config[0]) {
        await tx`
          insert into sdk_parent_config (
            id, mint_address, token_program, decimals, bonding_curve_address, quote_mint_address,
            eligible, eligibility_reason, graduated, pool_address, verified_at, rewards_active, alt_status
          ) values (
            1, ${identity.mint}, ${identity.tokenProgram}, ${identity.decimals}, ${identity.bondingCurve},
            ${identity.quoteMint}, true, 'canonical', ${identity.graduated}, ${identity.pool}, now(), false, 'absent'
          )
        `;
      } else {
        const updated = await tx<{ id: number }[]>`
          update sdk_parent_config
          set mint_address = ${identity.mint},
              token_program = ${identity.tokenProgram},
              decimals = ${identity.decimals},
              bonding_curve_address = ${identity.bondingCurve},
              quote_mint_address = ${identity.quoteMint},
              eligible = true,
              eligibility_reason = 'canonical',
              graduated = ${identity.graduated},
              pool_address = ${identity.pool},
              verified_at = now(),
              rewards_active = false,
              updated_at = now()
          where id = 1 and mint_address is null
          returning id
        `;
        if (!updated[0]) throw new Error("blocked");
      }
      await tx`
        insert into parent_registrations (
          scope, symbol, mint_address, deployer_address, fee_recipient_address, fee_mode,
          token_program, decimals, bonding_curve_address, graduated, pool_address, quote_mint_address,
          eligible, eligibility_reason, verified_at, registered_by, evidence_hash
        ) values (
          'production', 'SDK', ${identity.mint}, ${identity.deployer}, ${identity.feeRecipient}, ${identity.feeMode},
          ${identity.tokenProgram}, ${identity.decimals}, ${identity.bondingCurve}, ${identity.graduated}, ${identity.pool},
          ${identity.quoteMint}, true, 'canonical', now(), ${identity.operator}, ${identity.evidenceHash}
        )
      `;
      return "ok" as const;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "blocked") return "blocked";
    return "rolled_back";
  }
}

function liveIo(sql: Sql, rpcUrl: string): RegisterIo {
  const connection = new Connection(rpcUrl, "confirmed");
  return {
    async readMintAccount(mint) {
      try {
        const info = await connection.getAccountInfo(new PublicKey(mint), "confirmed");
        if (!info) return null;
        return { owner: info.owner.toBase58(), data: info.data };
      } catch {
        return "unavailable";
      }
    },
    observe(mint) {
      return observeQuoteParent(connection, mint);
    },
    readExisting: () => readExisting(sql),
    schemaReady: () => schemaReady(sql),
    commit: (identity) => commitIdentity(sql, identity),
    childLaunchesOpen: () => publicChildLaunchesOpen(process.env.PUBLIC_CHILD_LAUNCHES),
  };
}

const invoked = process.argv[1]?.endsWith("sdk-register-cli.ts") === true;
if (invoked) {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const rpcUrl = process.env.HELIUS_RPC_URL?.trim() ?? "";
  const ready = databaseUrl.startsWith("postgres") && rpcUrl.startsWith("http");
  if (!ready) {
    const result = blocked("config");
    process.stdout.write(`${result.out}\n`);
    process.exitCode = result.code;
  } else {
    const sql = createSql(databaseUrl);
    try {
      const result = await runRegister(process.argv, liveIo(sql, rpcUrl));
      process.stdout.write(`${result.out}\n`);
      process.exitCode = result.code;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}
