import { Connection, PublicKey } from "@solana/web3.js";

import { publicChildLaunchesOpen } from "../../../lib/launch/public-launch.ts";
import { presentCanonicalStatus, readMintAccount } from "../../../lib/sdk/canonical-registration.ts";
import { createSql } from "./store.ts";

type Sql = ReturnType<typeof createSql>;

async function readStatus(sql: Sql, rpcUrl: string): Promise<{ code: number; out: string }> {
  try {
    const config = await sql<{
      mint: string | null;
      tokenProgram: string | null;
      decimals: number | null;
    }[]>`
      select mint_address as mint, token_program as "tokenProgram", decimals
      from sdk_parent_config
      where id = 1
    `;
    const production = await sql<{ mint: string }[]>`
      select mint_address as mint
      from parent_registrations
      where scope = 'production'
    `;
    let rewardsActive = false;
    try {
      const flags = await sql<{ rewardsActive: boolean }[]>`
        select rewards_active as "rewardsActive"
        from sdk_parent_config
        where id = 1
      `;
      rewardsActive = flags[0]?.rewardsActive === true;
    } catch {
      rewardsActive = false;
    }
    const configMint = config[0]?.mint ?? null;
    const productionMint = production[0]?.mint ?? null;
    let chain: "matched" | "mismatch" | "unavailable" | "not_checked" = "not_checked";
    if (configMint && configMint === productionMint) {
      if (!rpcUrl.startsWith("http")) {
        chain = "unavailable";
      } else {
        try {
          const info = await new Connection(rpcUrl, "confirmed").getAccountInfo(new PublicKey(configMint), "confirmed");
          const facts = info ? readMintAccount(info.owner.toBase58(), info.data) : null;
          const storedProgram = config[0]?.tokenProgram ?? null;
          const storedDecimals = config[0]?.decimals ?? null;
          chain = facts && facts.owner === storedProgram && facts.decimals === storedDecimals ? "matched" : "mismatch";
        } catch {
          chain = "unavailable";
        }
      }
    }
    return presentCanonicalStatus({
      database: "ok",
      configMint,
      productionMint,
      chain,
      rewardsActive,
      childLaunchesOpen: publicChildLaunchesOpen(process.env.PUBLIC_CHILD_LAUNCHES),
    });
  } catch {
    return presentCanonicalStatus({
      database: "unavailable",
      configMint: null,
      productionMint: null,
      chain: "not_checked",
      rewardsActive: false,
      childLaunchesOpen: publicChildLaunchesOpen(process.env.PUBLIC_CHILD_LAUNCHES),
    });
  }
}

const invoked = process.argv[1]?.endsWith("sdk-status-cli.ts") === true;
if (invoked) {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  const rpcUrl = process.env.HELIUS_RPC_URL?.trim() ?? "";
  if (!databaseUrl.startsWith("postgres")) {
    const result = presentCanonicalStatus({
      database: "unavailable",
      configMint: null,
      productionMint: null,
      chain: "not_checked",
      rewardsActive: false,
      childLaunchesOpen: publicChildLaunchesOpen(process.env.PUBLIC_CHILD_LAUNCHES),
    });
    process.stdout.write(`${result.out}\n`);
    process.exitCode = result.code;
  } else {
    const sql = createSql(databaseUrl);
    try {
      const result = await readStatus(sql, rpcUrl);
      process.stdout.write(`${result.out}\n`);
      process.exitCode = result.code;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}
