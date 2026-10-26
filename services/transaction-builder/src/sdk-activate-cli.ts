import { Connection, PublicKey } from "@solana/web3.js";

import { canonicalAddress } from "../../../lib/auth/solana.ts";
import { publicChildLaunchesOpen } from "../../../lib/launch/public-launch.ts";
import { TREST_MINT } from "../../../lib/launch/verified-launch.ts";
import {
  parseWorkerHealth,
  presentRewardsStatus,
  runActivation,
  type ActivationChain,
  type ActivationSnapshot,
  type ActivationWorker,
} from "../../../lib/rewards/activation.ts";
import type { ProductionRegistration } from "../../../lib/rewards/production.ts";
import { readMintAccount } from "../../../lib/sdk/canonical-registration.ts";
import { createSql } from "./store.ts";

type Sql = ReturnType<typeof createSql>;

const PUBLIC_WORKER = "https://sdk-rewards-worker.onrender.com";

function feeMode(value: string): ProductionRegistration["feeMode"] | null {
  if (value === "single_recipient" || value === "fee_sharing" || value === "holder_rewards" || value === "unknown") return value;
  return null;
}

export async function commitRewardsActivation(sql: Sql, mint: string): Promise<"ok" | "idempotent" | "blocked" | "rolled_back"> {
  const expected = canonicalAddress(mint);
  if (!expected) return "blocked";
  try {
    return await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(814202)`;
      const configs = await tx<{
        mint: string | null;
        tokenProgram: string | null;
        decimals: number | null;
        rewardsActive: boolean;
      }[]>`
        select mint_address as mint, token_program as "tokenProgram", decimals, rewards_active as "rewardsActive"
        from sdk_parent_config
        where id = 1
        for update
      `;
      const parents = await tx<{ mint: string; tokenProgram: string; decimals: number }[]>`
        select mint_address as mint, token_program as "tokenProgram", decimals
        from parent_registrations
        where scope = 'production' and symbol = 'SDK'
        for update
      `;
      const config = configs[0];
      const parent = parents.length === 1 ? parents[0] : null;
      if (!config?.mint || !parent || canonicalAddress(config.mint) !== expected || canonicalAddress(parent.mint) !== expected) {
        throw new Error("blocked");
      }
      if (parent.tokenProgram !== config.tokenProgram || parent.decimals !== config.decimals) throw new Error("blocked");
      if (config.rewardsActive === true) return "idempotent" as const;
      const updated = await tx<{ mint: string }[]>`
        update sdk_parent_config
        set rewards_active = true, updated_at = now()
        where id = 1
          and rewards_active = false
          and mint_address = ${expected}
          and mint_address is not null
        returning mint_address as mint
      `;
      const returned = updated[0]?.mint;
      if (!returned || canonicalAddress(returned) !== expected) throw new Error("blocked");
      return "ok" as const;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "blocked") return "blocked";
    return "rolled_back";
  }
}

export async function commitRewardsDeactivation(sql: Sql, mint: string): Promise<"ok" | "idempotent" | "blocked" | "rolled_back"> {
  const expected = canonicalAddress(mint);
  if (!expected || expected === TREST_MINT) return "blocked";
  try {
    return await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(814202)`;
      const configs = await tx<{
        mint: string | null;
        tokenProgram: string | null;
        decimals: number | null;
        rewardsActive: boolean;
        launchesActive: boolean;
        childFeesActive: boolean;
      }[]>`
        select
          mint_address as mint,
          token_program as "tokenProgram",
          decimals,
          rewards_active as "rewardsActive",
          launches_active as "launchesActive",
          child_fees_active as "childFeesActive"
        from sdk_parent_config
        where id = 1
        for update
      `;
      const parents = await tx<{ mint: string; tokenProgram: string; decimals: number }[]>`
        select mint_address as mint, token_program as "tokenProgram", decimals
        from parent_registrations
        where scope = 'production' and symbol = 'SDK'
        for update
      `;
      const config = configs[0];
      const parent = parents.length === 1 ? parents[0] : null;
      if (!config?.mint || !parent || canonicalAddress(config.mint) !== expected || canonicalAddress(parent.mint) !== expected) {
        throw new Error("blocked");
      }
      if (parent.tokenProgram !== config.tokenProgram || parent.decimals !== config.decimals) throw new Error("blocked");
      if (config.rewardsActive !== true) return "idempotent" as const;
      const updated = await tx<{
        mint: string;
        rewardsActive: boolean;
        launchesActive: boolean;
        childFeesActive: boolean;
      }[]>`
        update sdk_parent_config
        set rewards_active = false, updated_at = now()
        where id = 1
          and rewards_active = true
          and launches_active = ${config.launchesActive}
          and child_fees_active = ${config.childFeesActive}
          and mint_address = ${expected}
          and token_program = ${config.tokenProgram}
          and decimals = ${config.decimals}
        returning
          mint_address as mint,
          rewards_active as "rewardsActive",
          launches_active as "launchesActive",
          child_fees_active as "childFeesActive"
      `;
      const row = updated[0];
      if (!row || canonicalAddress(row.mint) !== expected || row.rewardsActive !== false) throw new Error("blocked");
      if (row.launchesActive !== config.launchesActive || row.childFeesActive !== config.childFeesActive) throw new Error("blocked");
      return "ok" as const;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "blocked") return "blocked";
    return "rolled_back";
  }
}

async function readChain(rpcUrl: string, mint: string | null): Promise<ActivationChain> {
  if (!mint) return { ok: false, code: "not_checked" };
  if (!rpcUrl.startsWith("http")) return { ok: false, code: "unavailable" };
  try {
    const info = await new Connection(rpcUrl, "confirmed").getAccountInfo(new PublicKey(mint), "confirmed");
    if (!info) return { ok: false, code: "missing" };
    const facts = readMintAccount(info.owner.toBase58(), info.data);
    if (!facts) return { ok: false, code: "missing" };
    return { ok: true, owner: facts.owner, decimals: facts.decimals };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

async function readWorker(url: string): Promise<ActivationWorker | { ok: false; code: "unavailable" }> {
  try {
    const response = await fetch(new URL("/health", url), { cache: "no-store", signal: AbortSignal.timeout(2_000) });
    if (!response.ok) return { ok: false, code: "unavailable" };
    return parseWorkerHealth(await response.json());
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export async function loadActivationSnapshot(sql: Sql, env: NodeJS.ProcessEnv = process.env): Promise<ActivationSnapshot> {
  const signerAddress = env.SDK_DEPLOYER_ADDRESS ? canonicalAddress(env.SDK_DEPLOYER_ADDRESS) : null;
  const childLaunchesOpen = publicChildLaunchesOpen(env.PUBLIC_CHILD_LAUNCHES);
  const workerUrl = env.REWARDS_WORKER_URL?.trim() || PUBLIC_WORKER;
  try {
    const configs = await sql<{
      mint: string | null;
      tokenProgram: string | null;
      decimals: number | null;
      rewardsActive: boolean;
    }[]>`
      select mint_address as mint, token_program as "tokenProgram", decimals, rewards_active as "rewardsActive"
      from sdk_parent_config
      where id = 1
    `;
    const parents = await sql<{
      scope: string;
      symbol: string;
      mint: string;
      tokenProgram: string;
      decimals: number;
      deployer: string;
      feeRecipient: string;
      feeMode: string;
      quoteMint: string;
      eligible: boolean;
    }[]>`
      select
        scope, symbol, mint_address as mint, token_program as "tokenProgram", decimals,
        deployer_address as deployer, fee_recipient_address as "feeRecipient",
        fee_mode as "feeMode", quote_mint_address as "quoteMint", eligible
      from parent_registrations
      where scope = 'production' and symbol = 'SDK'
      limit 2
    `;
    const unresolved = await sql<{ n: number }[]>`
      select count(*)::int as n
      from reward_intents
      where scope = 'production' and status in ('submitted', 'uncertain', 'unreconciled')
    `;
    const windows = await sql<{ lastWindow: Date | string | null }[]>`
      select max(window_start) as "lastWindow"
      from reward_windows
      where scope = 'production' and status = 'allocated'
    `;
    const trest = await sql<{ suspended: boolean | null; open: number }[]>`
      select
        (
          select signer_suspended
          from reward_controls
          where scope = 'test' and parent_mint_address = ${TREST_MINT}
        ) as suspended,
        (
          select count(*)::int
          from reward_rehearsals rehearsal
          join parent_registrations parent on parent.mint_address = rehearsal.parent_mint_address
          where parent.scope = 'test' and parent.symbol = 'TREST' and rehearsal.status = 'open'
        ) as open
    `;
    const config = configs[0] ?? null;
    const row = parents.length === 1 ? parents[0] : null;
    const mode = row ? feeMode(row.feeMode) : null;
    const registration: ProductionRegistration | null = row && mode
      ? {
          scope: row.scope,
          symbol: row.symbol,
          mint: row.mint,
          tokenProgram: row.tokenProgram,
          decimals: row.decimals,
          deployer: row.deployer,
          feeRecipient: row.feeRecipient,
          feeMode: mode,
          quoteMint: row.quoteMint,
          eligible: row.eligible === true,
        }
      : null;
    const rawWindow = windows[0]?.lastWindow ?? null;
    const parsedWindow = rawWindow ? new Date(rawWindow).toISOString() : null;
    const [chain, worker] = await Promise.all([
      readChain(env.HELIUS_RPC_URL?.trim() ?? "", config?.mint ?? null),
      readWorker(workerUrl),
    ]);
    return {
      database: "ok",
      config: config
        ? {
            mint: config.mint,
            tokenProgram: config.tokenProgram,
            decimals: config.decimals,
            rewardsActive: config.rewardsActive === true,
          }
        : null,
      registration,
      chain,
      signerAddress,
      worker,
      unresolved: unresolved[0]?.n ?? null,
      lastWindow: parsedWindow && !Number.isNaN(Date.parse(parsedWindow)) ? parsedWindow : null,
      childLaunchesOpen,
      trestSuspended: trest[0]?.suspended ?? null,
      trestRehearsalOpen: trest[0] ? trest[0].open > 0 : null,
    };
  } catch {
    return {
      database: "unavailable",
      config: null,
      registration: null,
      chain: { ok: false, code: "not_checked" },
      signerAddress,
      worker: { ok: false, code: "unavailable" },
      unresolved: null,
      lastWindow: null,
      childLaunchesOpen,
      trestSuspended: null,
      trestRehearsalOpen: null,
    };
  }
}

export async function rewardsStatus(sql: Sql, env: NodeJS.ProcessEnv = process.env): Promise<{ code: number; out: string }> {
  return presentRewardsStatus(await loadActivationSnapshot(sql, env));
}

const invoked = process.argv[1]?.endsWith("sdk-activate-cli.ts") === true;
if (invoked) {
  delete process.env.SDK_DEPLOYER_PRIVATE_KEY;
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!databaseUrl.startsWith("postgres")) {
    const result = await runActivation(process.argv, {
      snapshot: async () => ({
        database: "unavailable",
        config: null,
        registration: null,
        chain: { ok: false, code: "not_checked" },
        signerAddress: null,
        worker: { ok: false, code: "unavailable" },
        unresolved: null,
        lastWindow: null,
        childLaunchesOpen: publicChildLaunchesOpen(process.env.PUBLIC_CHILD_LAUNCHES),
        trestSuspended: null,
        trestRehearsalOpen: null,
      }),
      commit: async () => "blocked",
      commitDeactivate: async () => "blocked",
    });
    process.stdout.write(`${result.out}\n`);
    process.exitCode = result.code;
  } else {
    const sql = createSql(databaseUrl);
    try {
      const result = await runActivation(process.argv, {
        snapshot: () => loadActivationSnapshot(sql),
        commit: (mint) => commitRewardsActivation(sql, mint),
        commitDeactivate: (mint) => commitRewardsDeactivation(sql, mint),
      });
      process.stdout.write(`${result.out}\n`);
      process.exitCode = result.code;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
}
