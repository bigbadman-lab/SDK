import { canonicalAddress } from "../../../lib/auth/solana.ts";
import { derivedDeployerAddress } from "../../../lib/rewards/signer.ts";
import { openSweep, planSweep, sweepExecutionAuthorised, sweepLiabilityAuthorised, type SweepAudit, type SweepLiabilities, type SweepParent, type SweepPlan } from "../../../lib/rewards/sweep.ts";

type Env = Record<string, string | undefined>;

const ZERO: SweepLiabilities = {
  claimableSol: "0",
  claimableToken: "0",
  deployerRetained: "0",
  unspentBuyback: "0",
  unallocated: "0",
};

export type SweepIo = {
  solBalance?: string;
  rentMinimum?: string;
  tokenBalance?: string;
  liabilities?: SweepLiabilities;
  inFlightClaim?: boolean;
  inFlightBuyback?: boolean;
  alreadyExecuted?: boolean;
  locked?: boolean;
  parentMint?: string;
  tokenProgram?: string;
  decimals?: number;
  record?: (audit: SweepAudit) => Promise<void>;
  broadcast?: () => Promise<"confirmed" | "failed" | "uncertain">;
  fence?: () => Promise<void>;
};

function parentOf(value: string | undefined): SweepParent | null {
  if (value === "trest" || value === "sdk") return value;
  return null;
}

export async function cliMain(argv: string[], env: Env, io: SweepIo = {}): Promise<{ code: number; out: string }> {
  const args = argv.slice(2);
  if (args.some((arg) => arg.startsWith("--destination") || arg.startsWith("--to"))) {
    return { code: 2, out: "destination_argument" };
  }
  let parentArg: string | undefined;
  let execute = false;
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--execute") execute = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--parent") parentArg = args[index + 1];
    else if (arg?.startsWith("--parent=")) parentArg = arg.slice("--parent=".length);
  }
  if (execute && dryRun) return { code: 2, out: "mode" };
  const parent = parentOf(parentArg);
  if (!parent) return { code: 2, out: "parent_rejected" };
  if (parent === "sdk") return { code: 2, out: "parent_rejected" };
  const destination = canonicalAddress(env.KILL_WALLET ?? "");
  if (!destination) return { code: 2, out: "destination_unconfigured" };
  const signer = canonicalAddress(env.TREST_DEPLOYER_ADDRESS ?? "");
  if (!signer) return { code: 2, out: "signer_unbound" };
  if (env.TREST_DEPLOYER_PRIVATE_KEY) {
    const derived = derivedDeployerAddress(env.TREST_DEPLOYER_PRIVATE_KEY);
    if (!derived || derived !== signer) return { code: 2, out: "signer_mismatch" };
  }
  const liabilities = io.liabilities ?? await deferredSweepHold(env);
  if (!liabilities) return { code: 2, out: "deferred_unprotected" };
  const planned = planSweep({
    parent,
    destination,
    signer,
    solBalance: io.solBalance ?? "0",
    rentMinimum: io.rentMinimum ?? "0",
    feeReserve: "5000",
    tokenBalance: io.tokenBalance ?? "0",
    liabilities,
    inFlightClaim: io.inFlightClaim === true,
    inFlightBuyback: io.inFlightBuyback === true,
    suspended: env.TREST_SIGNER_SUSPENDED === "true",
    alreadyExecuted: io.alreadyExecuted === true,
    locked: io.locked === true,
  });
  if (!("solLamports" in planned)) return { code: 2, out: planned.code };
  const opened = openSweep({
    requested: execute ? "execute" : "dry-run",
    executionEnabled: sweepExecutionAuthorised(env.KILL_WALLET_EXECUTION_AUTHORIZED),
    liabilityAuthorised: sweepLiabilityAuthorised(env.KILL_WALLET_LIABILITY_AUTHORITY),
    approval: env.KILL_WALLET_APPROVAL ?? null,
    plan: planned,
  });
  if (opened.fence) await (io.fence ?? (() => suspendRewards(env)))();
  const parentMint = io.parentMint ?? env.TREST_PARENT_MINT ?? "";
  const record = io.record ?? ((audit: SweepAudit) => persistSweep(env, planned, audit, parentMint));
  if (opened.broadcast) {
    try {
      await record(opened.audit);
    } catch {
      return { code: 2, out: summarise(planned, "record_failed") };
    }
  } else {
    await io.record?.(opened.audit);
  }
  let outcome = opened.code;
  if (opened.broadcast) {
    let evidence: string | null = null;
    const broadcast = await (io.broadcast ?? (async () => {
      const result = await broadcastControlledSweep(env, planned, io);
      evidence = result.signature;
      return result.status;
    }))();
    const settled = broadcast === "confirmed" ? "confirmed" : broadcast === "failed" ? "failed" : "uncertain";
    try {
      await record({ ...opened.audit, status: settled, signature: evidence });
    } catch {
      outcome = "uncertain";
    }
    if (settled === "confirmed") await (io.fence ?? (() => suspendRewards(env)))();
    if (outcome !== "uncertain") outcome = settled;
  }
  const summary = summarise(planned, outcome);
  if (opened.code === "execution_disabled") return { code: 3, out: summary };
  if (!opened.broadcast && opened.code !== "dry-run") return { code: 2, out: summary };
  return { code: outcome === "failed" || outcome === "uncertain" ? 2 : 0, out: summary };
}

function summarise(plan: SweepPlan, mode: string): string {
  return [
    `mode=${mode}`,
    `parent=${plan.parent}`,
    `destination=${plan.destination}`,
    `signer=${plan.signer}`,
    `sol=${plan.solLamports}`,
    `token=${plan.tokenAmount}`,
    `claimableSol=${plan.liabilities.claimableSol}`,
    `claimableToken=${plan.liabilities.claimableToken}`,
    `shortfall=${plan.shortfall}`,
    `inFlight=${plan.inFlight}`,
    `suspended=${plan.suspended}`,
    `locked=${plan.locked}`,
    "ledger=recorded",
    "custody=deployer_wallet",
  ].join("\n");
}

async function deferredSweepHold(env: Env): Promise<SweepLiabilities | null> {
  const url = env.DATABASE_URL?.trim() ?? "";
  if (!url) return ZERO;
  const { createSql } = await import("./postgres.ts");
  const sql = createSql(url);
  try {
    const rows = await sql<{ held: string }[]>`
      select coalesce(sum(recovery.holder_lamports + recovery.buyback_lamports + recovery.deployer_lamports), 0)::text as held
      from reward_collection_recoveries recovery
      join reward_collections receipt on receipt.signature = recovery.signature
      where receipt.allocation_deferred = true
        and receipt.allocated_at is null
        and receipt.status = 'confirmed'
        and receipt.credited = true
        and recovery.scope = 'test'
    `;
    return { ...ZERO, unallocated: rows[0]?.held ?? "0" };
  } catch {
    return null;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function persistSweep(env: Env, plan: SweepPlan, audit: SweepAudit, parentMint: string): Promise<void> {
  const url = env.DATABASE_URL?.trim() ?? "";
  if (!url || !parentMint) throw new Error("record_unavailable");
  const status = audit.status === "confirmed" && !audit.signature ? "uncertain" : audit.status;
  const { createSql } = await import("./postgres.ts");
  const sql = createSql(url);
  try {
    await sql`
      insert into emergency_sweeps (
        parent_mint_address, scope, destination_address, signer_address, mode, status,
        sol_lamports, token_amount, claimable_sol, claimable_token, shortfall, signature
      ) values (
        ${parentMint}, 'test', ${plan.destination}, ${plan.signer}, ${audit.mode}, ${status},
        ${audit.solLamports}, ${audit.tokenAmount}, ${plan.liabilities.claimableSol}, ${plan.liabilities.claimableToken},
        ${audit.shortfall}, ${audit.signature}
      )
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function suspendRewards(env: Env): Promise<void> {
  const url = env.DATABASE_URL?.trim() ?? "";
  if (!url) return;
  const { createSql } = await import("./postgres.ts");
  const sql = createSql(url);
  try {
    await sql`update reward_controls set signer_suspended = true, updated_at = now() where scope = 'test'`;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function broadcastControlledSweep(
  env: Env,
  plan: SweepPlan,
  io: SweepIo,
): Promise<{ status: "confirmed" | "failed" | "uncertain"; signature: string | null }> {
  const secret = env.TREST_DEPLOYER_PRIVATE_KEY ?? "";
  const rpc = env.HELIUS_RPC_URL?.trim() ?? "";
  const parentMint = io.parentMint ?? env.TREST_PARENT_MINT ?? "";
  if (!secret || !rpc || !parentMint) return { status: "uncertain", signature: null };
  if (plan.solLamports === "0" && plan.tokenAmount === "0") return { status: "failed", signature: null };
  const { buildSolClaim, buildTokenClaim } = await import("../../../lib/rewards/claim.ts");
  const { signedTransactionWire } = await import("../../../lib/rewards/inspect.ts");
  const { signInspected } = await import("../../../lib/rewards/signer.ts");
  const { heliusChain, heliusRpc } = await import("./chain.ts");
  const chain = heliusChain((method, params) => heliusRpc(rpc, method, params), rpc);
  const blockhash = await chain.blockhash();
  const legs: { kind: "claim_sol" | "claim_token"; amount: string; instruction: { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: number[] } }[] = [];
  if (plan.solLamports !== "0") {
    const sol = buildSolClaim({
      parentMint,
      claimParentMint: parentMint,
      deployer: plan.signer,
      claimant: plan.destination,
      amountLamports: plan.solLamports,
      entitlementLamports: plan.solLamports,
      alreadyClaimedLamports: "0",
      idempotencyKey: "sweep-sol-trest-0001",
      uncertainKeys: [],
    });
    if (!sol.ok) return { status: "failed", signature: null };
    legs.push({ kind: "claim_sol", amount: plan.solLamports, instruction: sol.instruction });
  }
  if (plan.tokenAmount !== "0") {
    const token = buildTokenClaim({
      parentMint,
      claimMint: parentMint,
      tokenProgram: io.tokenProgram ?? "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      deployer: plan.signer,
      claimant: plan.destination,
      amount: plan.tokenAmount,
      decimals: io.decimals ?? 6,
      entitlement: plan.tokenAmount,
      alreadyClaimed: "0",
      idempotencyKey: "sweep-token-trest-001",
      uncertainKeys: [],
    });
    if (!token.ok) return { status: "failed", signature: null };
    legs.push({ kind: "claim_token", amount: plan.tokenAmount, instruction: token.instruction });
  }
  let confirmed = 0;
  let signature: string | null = null;
  for (const leg of legs) {
    const transaction = { feePayer: plan.signer, recentBlockhash: blockhash, instructions: [leg.instruction] };
    const signed = signInspected({
      secret,
      expectedAddress: plan.signer,
      suspended: false,
      transaction,
      policy: {
        kind: leg.kind,
        scope: "test",
        parentMint,
        deployer: plan.signer,
        recipient: plan.destination,
        maxLamports: leg.amount,
        maxRentLamports: "0",
        tokenProgram: io.tokenProgram ?? "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
      },
    });
    if (!signed.ok) return { status: "failed", signature };
    const wire = signedTransactionWire(transaction, signed.signature);
    if (!wire) return { status: "failed", signature };
    signature = signed.signature;
    const sent = await chain.submit(wire);
    if (sent.status === "uncertain") return { status: "uncertain", signature };
    if (sent.status !== "accepted") return { status: "failed", signature };
    const observed = await chain.transaction(signed.signature, {
      creator: plan.signer,
      solVault: plan.signer,
      wsolVault: plan.signer,
      parentMint,
      destination: plan.destination,
    });
    if (!observed || observed.status === "uncertain") return { status: "uncertain", signature };
    if (observed.status === "failed") return { status: "failed", signature };
    confirmed += 1;
  }
  return { status: confirmed === legs.length && signature ? "confirmed" : "uncertain", signature };
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("kill-wallet.ts") || entry.endsWith("kill-wallet.js")) {
  void cliMain(process.argv, process.env).then((result) => {
    process.stdout.write(`${result.out}\n`);
    process.exitCode = result.code;
  });
}
