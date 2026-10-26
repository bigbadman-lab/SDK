import { createRequire } from "node:module";

import { quoteDeltaRows, readSharing } from "./child-distribution.ts";
import { heliusRpc } from "./chain.ts";
import { createSql } from "./postgres.ts";
import {
  SHARING_CONFIG,
  VENT_SIGNATURE,
  assessReconciliation,
  formatReconciliation,
  parseReconcileArgs,
  sharingMatches,
  soleCreatorFeeDistribution,
  type DistributionRecord,
  type QuoteDelta,
  type ReceiptRecord,
  type ReconciliationEvidence,
  type ReconciliationPlan,
} from "./vent-reconcile.ts";
import { TREST_MINT, VENT_MINT } from "./vent-fee.ts";

const require = createRequire(import.meta.url);
const decodeBase58 = require("bs58").decode as (value: string) => Uint8Array;

type Env = Record<string, string | undefined>;
type Sql = ReturnType<typeof createSql>;

export type ReconcileIo = {
  load?: () => Promise<ReconciliationEvidence>;
  apply?: (
    plan: ReconciliationPlan
  ) => Promise<"applied" | "already" | "conflict">;
};

function rejected(code: string): { code: number; out: string } {
  return { code: 2, out: `rejected ${code}\n` };
}

function accountKeys(
  message: { accountKeys?: unknown[] } | undefined
): string[] {
  return (message?.accountKeys ?? []).flatMap((key) => {
    if (typeof key === "string") return [key];
    if (
      key &&
      typeof key === "object" &&
      "pubkey" in key &&
      typeof key.pubkey === "string"
    )
      return [key.pubkey];
    return [];
  });
}

async function loadEvidence(
  sql: Sql,
  rpcUrl: string
): Promise<ReconciliationEvidence> {
  const [status, transaction, sharing, distributions, receipts] =
    await Promise.all([
      heliusRpc(rpcUrl, "getSignatureStatuses", [
        [VENT_SIGNATURE],
        { searchTransactionHistory: true },
      ]),
      heliusRpc(rpcUrl, "getTransaction", [
        VENT_SIGNATURE,
        {
          encoding: "json",
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        },
      ]),
      readSharing(rpcUrl, VENT_MINT),
      sql<DistributionRecord[]>`
      select idempotency_key as "idempotencyKey",
             status,
             signature,
             amount,
             child_mint_address as "childMint",
             quote_mint_address as "quoteMint",
             scope
      from child_fee_distributions
      where signature = ${VENT_SIGNATURE}
    `,
      sql<ReceiptRecord[]>`
      select receipt.recipient_address as address,
             receipt.amount,
             receipt.role,
             receipt.signature
      from child_fee_receipts receipt
      join child_fee_distributions distribution on distribution.id = receipt.distribution_id
      where distribution.signature = ${VENT_SIGNATURE}
    `,
    ]);
  const statusRow =
    (
      status as {
        value?: { err?: unknown; confirmationStatus?: string }[];
      } | null
    )?.value?.[0] ?? null;
  const tx = transaction as {
    slot?: number;
    meta?: {
      err?: unknown;
      preTokenBalances?: {
        mint: string;
        owner?: string;
        uiTokenAmount: { amount: string };
      }[];
      postTokenBalances?: {
        mint: string;
        owner?: string;
        uiTokenAmount: { amount: string };
      }[];
    } | null;
    transaction?: {
      message?: {
        accountKeys?: unknown[];
        instructions?: { programIdIndex: number; data: string }[];
      };
    };
  } | null;
  const keys = accountKeys(tx?.transaction?.message);
  const balances = [
    ...(tx?.meta?.preTokenBalances ?? []),
    ...(tx?.meta?.postTokenBalances ?? []),
  ];
  const deltas = tx?.meta
    ? quoteDeltaRows(
        TREST_MINT,
        tx.meta.preTokenBalances ?? [],
        tx.meta.postTokenBalances ?? []
      )
    : [];
  return {
    finalized:
      statusRow?.confirmationStatus === "finalized" && statusRow.err == null,
    succeeded: Boolean(tx?.meta) && tx?.meta?.err == null,
    slot: tx?.slot === undefined ? null : String(tx.slot),
    childInTransaction: keys.includes(VENT_MINT),
    parentInTransaction:
      keys.includes(TREST_MINT) &&
      balances.length > 0 &&
      balances.every((row) => row.mint === TREST_MINT),
    instructionOk: soleCreatorFeeDistribution({
      accountKeys: keys,
      instructions: (tx?.transaction?.message?.instructions ?? []).flatMap(
        (instruction) => {
          try {
            return [
              {
                programIdIndex: instruction.programIdIndex,
                data: [...decodeBase58(instruction.data)],
              },
            ];
          } catch {
            return [];
          }
        }
      ),
    }),
    sharingOk: sharing?.address === SHARING_CONFIG && sharingMatches(sharing),
    deltas: deltas as QuoteDelta[],
    row: distributions.length === 1 ? (distributions[0] ?? null) : null,
    receipts,
  };
}

async function applyPlan(
  sql: Sql,
  plan: ReconciliationPlan
): Promise<"applied" | "already" | "conflict"> {
  return sql.begin(async (tx) => {
    const rows = await tx<
      {
        id: string;
        status: string;
        amount: string | null;
        signature: string | null;
      }[]
    >`
      select id::text, status, amount, signature
      from child_fee_distributions
      where idempotency_key = ${plan.key}
      for update
    `;
    const row = rows[0];
    if (!row || row.signature !== plan.signature) return "conflict" as const;
    const receipts = await tx<ReceiptRecord[]>`
      select recipient_address as address, amount, role, signature
      from child_fee_receipts
      where distribution_id = ${row.id}::uuid
    `;
    const recorded = plan.receipts.every((expected) =>
      receipts.some(
        (receipt) =>
          receipt.address === expected.address &&
          receipt.amount === expected.amount &&
          receipt.role === expected.role &&
          receipt.signature === plan.signature
      )
    );
    if (
      row.status === "confirmed" &&
      row.amount === plan.amount &&
      receipts.length === plan.receipts.length &&
      recorded
    ) {
      return "already" as const;
    }
    if (row.status !== "unreconciled" || receipts.length !== 0)
      return "conflict" as const;
    const updated = await tx<{ id: string }[]>`
      update child_fee_distributions
      set status = 'confirmed', amount = ${plan.amount}
      where id = ${row.id}::uuid
        and status = 'unreconciled'
        and signature = ${plan.signature}
        and amount is null
      returning id
    `;
    if (updated.length !== 1) return "conflict" as const;
    for (const receipt of plan.receipts) {
      await tx`
        insert into child_fee_receipts (
          distribution_id, recipient_address, quote_mint_address, amount, role, signature, slot
        ) values (
          ${row.id}::uuid, ${receipt.address}, ${TREST_MINT}, ${receipt.amount}, ${receipt.role}, ${plan.signature}, ${plan.slot}
        )
      `;
    }
    return "applied" as const;
  });
}

async function open(
  env: Env
): Promise<{ sql: Sql; rpcUrl: string; close: () => Promise<void> } | null> {
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  const rpcUrl = env.HELIUS_RPC_URL?.trim() ?? "";
  if (!databaseUrl.startsWith("postgres") || !rpcUrl.startsWith("https://"))
    return null;
  const sql = createSql(databaseUrl);
  return { sql, rpcUrl, close: () => sql.end({ timeout: 5 }) };
}

export async function cliMain(
  argv: readonly string[],
  env: Env,
  io: ReconcileIo = {}
): Promise<{ code: number; out: string }> {
  const parsed = parseReconcileArgs(argv);
  if (!parsed.ok) return rejected(parsed.code);
  if (parsed.write && env.TREST_05D_RECONCILE_AUTHORIZED !== "true")
    return rejected("authorisation");
  const live = io.load ? null : await open(env);
  try {
    const evidence = io.load
      ? await io.load()
      : live
        ? await loadEvidence(live.sql, live.rpcUrl)
        : null;
    if (!evidence) return rejected("configuration");
    const decision = assessReconciliation(evidence);
    if (!parsed.write || !decision.ready || decision.already) {
      return {
        code: decision.ready ? 0 : 2,
        out: formatReconciliation(decision, parsed.write),
      };
    }
    const apply =
      io.apply ??
      (live ? (plan: ReconciliationPlan) => applyPlan(live.sql, plan) : null);
    if (!apply) return rejected("configuration");
    const result = await apply(decision.plan);
    if (result === "conflict") return rejected("conflict");
    return {
      code: 0,
      out: formatReconciliation(
        { ...decision, already: result === "already" },
        true,
        result === "applied"
      ),
    };
  } catch {
    return rejected("configuration");
  } finally {
    await live?.close();
  }
}

const entry = process.argv[1] ?? "";
if (
  entry.endsWith("vent-reconcile-cli.ts") ||
  entry.endsWith("vent-reconcile-cli.js")
) {
  void cliMain(process.argv, process.env).then((result) => {
    process.stdout.write(result.out);
    process.exitCode = result.code;
  });
}
