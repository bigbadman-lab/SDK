import {
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
} from "../../../lib/rewards/claim.ts";
import {
  inspectRewardsTransaction,
  signedTransactionWire,
  type CompiledTransaction,
} from "../../../lib/rewards/inspect.ts";
import { signInspected } from "../../../lib/rewards/signer.ts";
import { heliusChain, heliusRpc } from "./chain.ts";
import type { ChildCandidate, ChildInstruction } from "./child-fees.ts";
import {
  buildDistribution,
  readChildFeeVault,
  readQuoteDeltas,
  readSharing,
} from "./child-distribution.ts";
import { createSql } from "./postgres.ts";
import {
  LAUNCH_ID,
  LAUNCHER,
  PAYER,
  PLATFORM,
  TREST_MINT,
  VENT_MINT,
  allowedDistributionInstructions,
  assessVentFee,
  executeOneShot,
  formatExecution,
  formatReport,
  parseVentFeeArgs,
  type DistributionLedger,
  type DistributionRow,
  type ExecuteRequest,
  type ExecuteResult,
  type VentSnapshot,
} from "./vent-fee.ts";

type Env = Record<string, string | undefined>;
type Sql = ReturnType<typeof createSql>;

export type VentFeeIo = {
  load?: () => Promise<VentSnapshot>;
  execute?: (request: ExecuteRequest) => Promise<ExecuteResult>;
};

const CHILD: ChildCandidate = {
  mint: VENT_MINT,
  quoteMint: TREST_MINT,
  scope: "test",
  category: "official",
  launcher: LAUNCHER,
  originator: null,
};

function rejected(code: string): { code: number; out: string } {
  return { code: 2, out: `rejected ${code}\n` };
}

function policy() {
  return {
    kind: "child_distribute" as const,
    scope: "test" as const,
    parentMint: TREST_MINT,
    deployer: PAYER,
    recipient: PAYER,
    maxLamports: "0",
    maxRentLamports: "50000000",
    tokenProgram: TOKEN_PROGRAM_ID,
  };
}

function compiled(
  instructions: readonly ChildInstruction[],
  blockhash: string
): CompiledTransaction {
  return {
    feePayer: PAYER,
    recentBlockhash: blockhash,
    instructions: instructions.map((instruction) => ({
      programId: instruction.programId,
      keys: instruction.keys,
      data: instruction.data,
    })),
  };
}

async function messageFee(
  rpcUrl: string,
  message: Uint8Array
): Promise<string | null> {
  const result = await heliusRpc(rpcUrl, "getFeeForMessage", [
    Buffer.from(message).toString("base64"),
    { commitment: "confirmed" },
  ]);
  if (!result || typeof result !== "object" || !("value" in result))
    return null;
  const value = result.value;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : null;
}

async function loadSnapshot(sql: Sql, rpcUrl: string): Promise<VentSnapshot> {
  const chain = heliusChain(
    (method, params) => heliusRpc(rpcUrl, method, params),
    rpcUrl
  );
  const [
    launchRows,
    parentRows,
    rehearsalRows,
    controlRows,
    distributionRows,
    sharing,
    vault,
    instructions,
    blockhash,
  ] = await Promise.all([
    sql<
      {
        id: string;
        attempt_status: string;
        attempt_mint_address: string | null;
        parent_mint_address: string | null;
        parent_scope: string | null;
        wallet_address: string;
        fee_category: string;
        originator_wallet: string | null;
      }[]
    >`
      select l.id::text,
             l.attempt_status,
             l.attempt_mint_address,
             l.parent_mint_address,
             l.parent_scope,
             l.wallet_address,
             l.fee_category,
             o.wallet_address as originator_wallet
      from token_launches l
      left join accounts o on o.id = l.originator_account_id
      where l.id = ${LAUNCH_ID}::uuid
    `,
    sql<
      {
        symbol: string;
        decimals: number;
        deployer_address: string;
        scope: string;
      }[]
    >`
      select symbol, decimals, deployer_address, scope
      from parent_registrations
      where mint_address = ${TREST_MINT} and scope = 'test'
    `,
    sql<{ status: string }[]>`
      select status
      from reward_rehearsals
      where parent_mint_address = ${TREST_MINT} and scope = 'test'
      order by case when status = 'open' then 0 else 1 end, generation desc
      limit 1
    `,
    sql<{ signer_suspended: boolean }[]>`
      select signer_suspended
      from reward_controls
      where parent_mint_address = ${TREST_MINT} and scope = 'test'
    `,
    sql<DistributionRow[]>`
      select idempotency_key as "idempotencyKey", status, signature
      from child_fee_distributions
      where child_mint_address = ${VENT_MINT}
    `,
    readSharing(rpcUrl, VENT_MINT),
    readChildFeeVault(rpcUrl, VENT_MINT, TREST_MINT),
    buildDistribution(rpcUrl, { ...CHILD, originator: null }, PAYER),
    chain.blockhash(),
  ]);
  const launch = launchRows[0];
  const parent = parentRows[0];
  const transaction = instructions ? compiled(instructions, blockhash) : null;
  const inspected = transaction
    ? inspectRewardsTransaction(transaction, policy())
    : { ok: false as const, code: "transaction" as const };
  const feeLamports = inspected.ok
    ? await messageFee(rpcUrl, inspected.message)
    : null;
  const tokenProgram = vault?.tokenProgram ?? "";
  const holders = [LAUNCHER, PLATFORM];
  const atas = holders.flatMap((holder) => {
    const address = tokenProgram
      ? associatedTokenAddress(holder, TREST_MINT, tokenProgram)
      : null;
    return address ? [{ holder, address }] : [];
  });
  const existing =
    atas.length === 0
      ? []
      : await Promise.all(
          atas.map(async (ata) => ({
            ...ata,
            account: await chain.account(ata.address),
          }))
        );
  const present = existing.find((ata) => ata.account);
  const missing = existing.filter((ata) => !ata.account);
  const rentEach =
    present && missing.length > 0
      ? BigInt(await chain.rent(present.account?.data.length ?? 0))
      : BigInt(0);
  const payer = await chain.account(PAYER);
  return {
    launch: launch
      ? {
          id: launch.id,
          mint: launch.attempt_mint_address ?? "",
          parentMint: launch.parent_mint_address ?? "",
          scope: launch.parent_scope ?? "",
          category: launch.fee_category,
          launcher: launch.wallet_address,
          originator: launch.originator_wallet,
          attemptStatus: launch.attempt_status,
        }
      : null,
    parent: parent
      ? {
          symbol: parent.symbol,
          decimals: parent.decimals,
          deployer: parent.deployer_address,
          scope: parent.scope,
        }
      : null,
    sharing,
    vault,
    payerLamports: payer ? payer.lamports : null,
    feeLamports,
    rentLamports:
      present || missing.length === 0
        ? (rentEach * BigInt(missing.length)).toString()
        : null,
    missingAtas: missing.map((ata) => ata.address),
    instructions: instructions
      ? instructions.map((instruction) => ({
          programId: instruction.programId,
          data: instruction.data,
          signers: instruction.keys.flatMap((key) =>
            key.isSigner ? [key.pubkey] : []
          ),
        }))
      : null,
    inspectOk: inspected.ok,
    rehearsalStatus: rehearsalRows[0]?.status ?? null,
    signerSuspended: controlRows[0]?.signer_suspended ?? null,
    distributions: distributionRows,
  };
}

function ledger(sql: Sql): DistributionLedger {
  return {
    async list(childMint) {
      return sql<DistributionRow[]>`
        select idempotency_key as "idempotencyKey", status, signature
        from child_fee_distributions
        where child_mint_address = ${childMint}
      `;
    },
    async reserve(input) {
      const reserved = await sql<{ idempotency_key: string }[]>`
        insert into child_fee_distributions (
          idempotency_key, child_mint_address, quote_mint_address, scope, status, signature
        ) values (
          ${input.key}, ${input.childMint}, ${input.quoteMint}, 'test', 'submitted', ${input.signature}
        )
        on conflict (idempotency_key) do nothing
        returning idempotency_key
      `;
      return reserved.length === 0 ? "conflict" : "reserved";
    },
    async mark(key, status) {
      await sql`update child_fee_distributions set status = ${status} where idempotency_key = ${key}`;
    },
    async receipts(input) {
      const ids = await sql<
        { id: string }[]
      >`select id::text from child_fee_distributions where idempotency_key = ${input.key}`;
      const distributionId = ids[0]?.id;
      if (!distributionId) return;
      for (const receipt of input.rows) {
        await sql`
          insert into child_fee_receipts (
            distribution_id, recipient_address, quote_mint_address, amount, role, signature, slot
          ) values (
            ${distributionId}::uuid, ${receipt.address}, ${input.quoteMint}, ${receipt.amount}, ${receipt.role}, ${input.signature}, ${input.slot}
          )
          on conflict (distribution_id, recipient_address) do nothing
        `;
      }
    },
    async confirm(key, amount) {
      const updated = await sql<{ idempotency_key: string }[]>`
        update child_fee_distributions
        set status = 'confirmed', amount = ${amount}
        where idempotency_key = ${key} and status = 'submitted'
        returning idempotency_key
      `;
      return updated.length === 1;
    },
  };
}

async function liveExecute(
  env: Env,
  request: ExecuteRequest
): Promise<ExecuteResult> {
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  const rpcUrl = env.HELIUS_RPC_URL?.trim() ?? "";
  const secret = env.TREST_DEPLOYER_PRIVATE_KEY?.trim() ?? "";
  if (
    !databaseUrl.startsWith("postgres") ||
    !rpcUrl.startsWith("https://") ||
    secret.length === 0
  ) {
    return { ok: false, code: "configuration", signature: null };
  }
  const sql = createSql(databaseUrl);
  const chain = heliusChain(
    (method, params) => heliusRpc(rpcUrl, method, params),
    rpcUrl
  );
  try {
    const snapshot = await loadSnapshot(sql, rpcUrl);
    const originator = snapshot.launch?.originator ?? null;
    let wire: Uint8Array | null = null;
    return await executeOneShot({
      snapshot,
      approval: { min: request.min, max: request.max },
      ledger: ledger(sql),
      sign: async () => {
        const [sharing, freshVault, instructions] = await Promise.all([
          readSharing(rpcUrl, VENT_MINT),
          readChildFeeVault(rpcUrl, VENT_MINT, TREST_MINT),
          buildDistribution(rpcUrl, { ...CHILD, originator }, PAYER),
        ]);
        const transaction = instructions
          ? compiled(instructions, await chain.blockhash())
          : null;
        const inspected = transaction
          ? inspectRewardsTransaction(transaction, policy())
          : { ok: false as const };
        const view =
          instructions?.map((instruction) => ({
            programId: instruction.programId,
            data: instruction.data,
            signers: instruction.keys.flatMap((key) =>
              key.isSigner ? [key.pubkey] : []
            ),
          })) ?? null;
        const fresh = assessVentFee(
          {
            ...snapshot,
            sharing,
            vault: freshVault,
            instructions: view,
            inspectOk:
              inspected.ok &&
              (view ? allowedDistributionInstructions(view) : false),
          },
          { min: request.min, max: request.max }
        );
        if (!fresh.ready || !transaction)
          return { ok: false, code: fresh.blocks[0] ?? "blocked" };
        const signed = signInspected({
          secret,
          expectedAddress: PAYER,
          suspended: false,
          transaction,
          policy: policy(),
        });
        if (!signed.ok) return signed;
        wire = signedTransactionWire(transaction, signed.signature);
        if (!wire) return { ok: false, code: "transaction" };
        return { ok: true, signature: signed.signature };
      },
      submit: async () => {
        if (!wire) return { status: "failed" };
        const sent = await chain.submit(wire);
        if (sent.status === "accepted") return { status: "accepted" };
        return { status: sent.status === "uncertain" ? "uncertain" : "failed" };
      },
      confirm: async (signature) => {
        const observed = await chain.transaction(signature, {
          creator: PAYER,
          solVault: PAYER,
          wsolVault: PAYER,
          parentMint: TREST_MINT,
          destination: PAYER,
        });
        if (observed?.status === "failed") return { status: "failed" };
        if (observed?.status !== "confirmed") return { status: "unconfirmed" };
        const deltas = await readQuoteDeltas(rpcUrl, signature, TREST_MINT);
        if (!deltas) return { status: "unconfirmed" };
        return { status: "confirmed", slot: observed.slot, deltas };
      },
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function cliMain(
  argv: readonly string[],
  env: Env,
  io: VentFeeIo = {}
): Promise<{ code: number; out: string }> {
  const parsed = parseVentFeeArgs(argv);
  if (!parsed.ok) return rejected(parsed.code);
  try {
    if (parsed.mode === "dry-run") {
      const snapshot = io.load ? await io.load() : await liveLoad(env);
      if (!snapshot) return rejected("configuration");
      const decision = assessVentFee(snapshot, null);
      return {
        code: decision.ready ? 0 : 2,
        out: formatReport(snapshot, decision),
      };
    }
    if (env.TREST_05B_VENT_FEE_AUTHORIZED !== "true")
      return rejected("authorisation");
    if (env.TREST_DEPLOYER_ADDRESS !== PAYER) return rejected("payer");
    if (
      !io.execute &&
      (env.TREST_DEPLOYER_PRIVATE_KEY?.trim() ?? "").length === 0
    )
      return rejected("signer");
    const result = io.execute
      ? await io.execute(parsed.request)
      : await liveExecute(env, parsed.request);
    return { code: result.ok ? 0 : 2, out: formatExecution(result) };
  } catch {
    return rejected("configuration");
  }
}

async function liveLoad(env: Env): Promise<VentSnapshot | null> {
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  const rpcUrl = env.HELIUS_RPC_URL?.trim() ?? "";
  if (!databaseUrl.startsWith("postgres") || !rpcUrl.startsWith("https://"))
    return null;
  const sql = createSql(databaseUrl);
  try {
    return await loadSnapshot(sql, rpcUrl);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const entry = process.argv[1] ?? "";
if (entry.endsWith("vent-fee-cli.ts") || entry.endsWith("vent-fee-cli.js")) {
  void cliMain(process.argv, process.env).then((result) => {
    process.stdout.write(result.out);
    process.exitCode = result.code;
  });
}
