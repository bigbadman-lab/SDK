import {
  PUMP_PROGRAM_ID,
  matchShareholderReceipts,
  pumpCreatorFeeDistribution,
  verifyChildSharing,
} from "../../../lib/rewards/child-fees.ts";
import {
  LAUNCHER,
  ONE_SHOT_KEY,
  PLATFORM,
  SHARING_CONFIG,
  TREST_MINT,
  VENT_MINT,
} from "./vent-fee.ts";

export const VENT_RECONCILE_APPROVAL = "TREST-05D-VENT-RECONCILE";
export const VENT_SIGNATURE =
  "kEF7JqpqgybWQAapWxkkEvoyaud2yNKb3FvNTNVtfy7au4Z1RYH2g4s62ZbNWpSk3gcv4PZs4w1se4a3Tjg3PGE";
export const VENT_DISTRIBUTED = "135936184193";
export const VENT_LAUNCHER_AMOUNT = "81561710516";
export const VENT_PLATFORM_AMOUNT = "54374473677";

const OPERATOR = /^[A-Za-z0-9_-]{1,80}$/;

export type QuoteDelta = {
  owner: string;
  mint: string;
  amount: string;
  sign: "credit" | "debit";
};

export type DistributionRecord = {
  idempotencyKey: string;
  status: string;
  signature: string | null;
  amount: string | null;
  childMint: string;
  quoteMint: string;
  scope: string;
};

export type ReceiptRecord = {
  address: string;
  amount: string;
  role: string;
  signature: string;
};

export type ReconciliationEvidence = {
  finalized: boolean;
  succeeded: boolean;
  slot: string | null;
  childInTransaction: boolean;
  parentInTransaction: boolean;
  instructionOk: boolean;
  sharingOk: boolean;
  deltas: readonly QuoteDelta[];
  row: DistributionRecord | null;
  receipts: readonly ReceiptRecord[];
};

export type ReconciliationPlan = {
  key: string;
  signature: string;
  slot: string | null;
  amount: string;
  receipts: readonly {
    address: string;
    amount: string;
    role: "launcher" | "platform";
  }[];
};

export type ReconciliationDecision =
  | { ready: true; plan: ReconciliationPlan; already: boolean }
  | { ready: false; blocks: string[] };

function sameReceipts(
  receipts: readonly ReceiptRecord[],
  plan: ReconciliationPlan
): boolean {
  if (receipts.length !== plan.receipts.length) return false;
  return plan.receipts.every((expected) =>
    receipts.some(
      (receipt) =>
        receipt.address === expected.address &&
        receipt.amount === expected.amount &&
        receipt.role === expected.role &&
        receipt.signature === plan.signature
    )
  );
}

export function assessReconciliation(
  evidence: ReconciliationEvidence
): ReconciliationDecision {
  const blocks: string[] = [];
  if (!evidence.finalized || !evidence.succeeded) blocks.push("transaction");
  if (!evidence.childInTransaction) blocks.push("child");
  if (!evidence.parentInTransaction) blocks.push("parent");
  if (!evidence.instructionOk) blocks.push("instruction");
  if (!evidence.sharingOk) blocks.push("sharing");
  const row = evidence.row;
  if (
    !row ||
    row.idempotencyKey !== ONE_SHOT_KEY ||
    row.signature !== VENT_SIGNATURE ||
    row.childMint !== VENT_MINT ||
    row.quoteMint !== TREST_MINT ||
    row.scope !== "test"
  ) {
    blocks.push("distribution");
  }
  const matched = matchShareholderReceipts({
    quoteMint: TREST_MINT,
    shareholders: [
      { address: LAUNCHER, shareBps: 6000 },
      { address: PLATFORM, shareBps: 4000 },
    ],
    distributed: VENT_DISTRIBUTED,
    deltas: evidence.deltas,
  });
  if (!matched.ok) blocks.push("matcher");
  const launcher = matched.ok
    ? matched.receipts.find((receipt) => receipt.address === LAUNCHER)
    : undefined;
  const platform = matched.ok
    ? matched.receipts.find((receipt) => receipt.address === PLATFORM)
    : undefined;
  if (
    !launcher ||
    launcher.amount !== VENT_LAUNCHER_AMOUNT ||
    !platform ||
    platform.amount !== VENT_PLATFORM_AMOUNT
  ) {
    blocks.push("amounts");
  }
  if (blocks.length > 0) return { ready: false, blocks };
  const plan: ReconciliationPlan = {
    key: ONE_SHOT_KEY,
    signature: VENT_SIGNATURE,
    slot: evidence.slot,
    amount: VENT_DISTRIBUTED,
    receipts: [
      { address: LAUNCHER, amount: VENT_LAUNCHER_AMOUNT, role: "launcher" },
      { address: PLATFORM, amount: VENT_PLATFORM_AMOUNT, role: "platform" },
    ],
  };
  if (
    row?.status === "confirmed" &&
    row.amount === VENT_DISTRIBUTED &&
    sameReceipts(evidence.receipts, plan)
  ) {
    return { ready: true, plan, already: true };
  }
  if (row?.status !== "unreconciled") blocks.push("status");
  if (evidence.receipts.length !== 0) blocks.push("receipts");
  if (blocks.length > 0) return { ready: false, blocks };
  return { ready: true, plan, already: false };
}

export function formatReconciliation(
  decision: ReconciliationDecision,
  write: boolean,
  written = false
): string {
  if (!decision.ready) {
    return `TREST-05D reconcile\nmode: ${write ? "execute" : "dry-run"}\nstatus: blocked\nblocked: ${decision.blocks.join(",")}\n`;
  }
  const receipts = decision.plan.receipts
    .map((receipt) => `${receipt.role} ${receipt.address} ${receipt.amount}`)
    .join(",");
  const state = decision.already
    ? "already-confirmed"
    : written
      ? "applied"
      : write
        ? "ready-to-write"
        : "ready";
  return (
    [
      "TREST-05D reconcile",
      `mode: ${write ? "execute" : "dry-run"}`,
      `status: ${state}`,
      `signature: ${decision.plan.signature}`,
      `amount: ${decision.plan.amount}`,
      `receipts: ${receipts}`,
      `writes: ${written ? "applied" : "none"}`,
    ].join("\n") + "\n"
  );
}

export function parseReconcileArgs(
  argv: readonly string[]
):
  | { ok: true; write: boolean; operator: string; reason: string }
  | { ok: false; code: string } {
  const flags = ["--execute", "--approval", "--operator", "--reason"] as const;
  const values = new Map<string, string>();
  let write = false;
  const tokens = argv.slice(2);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const equals = token.indexOf("=");
    const name = equals === -1 ? token : token.slice(0, equals);
    if (!flags.includes(name as (typeof flags)[number]))
      return { ok: false, code: "argument" };
    if (name === "--execute") {
      if (equals !== -1 || write) return { ok: false, code: "argument" };
      write = true;
      continue;
    }
    if (values.has(name)) return { ok: false, code: "argument" };
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
    const value = inline ?? tokens[index + 1];
    if (inline === undefined) index += 1;
    if (!value || value.startsWith("--"))
      return { ok: false, code: "argument" };
    values.set(name, value);
  }
  if (!write && values.size === 0)
    return { ok: true, write: false, operator: "", reason: "" };
  if (!write) return { ok: false, code: "argument" };
  const approval = values.get("--approval");
  const operator = values.get("--operator");
  const reason = values.get("--reason");
  if (approval !== VENT_RECONCILE_APPROVAL)
    return { ok: false, code: "approval" };
  if (
    !operator ||
    !reason ||
    !OPERATOR.test(operator) ||
    reason.trim().length === 0 ||
    reason.length > 240
  ) {
    return { ok: false, code: "argument" };
  }
  return { ok: true, write: true, operator, reason: reason.trim() };
}

export function soleCreatorFeeDistribution(input: {
  accountKeys: readonly string[];
  instructions: readonly { programIdIndex: number; data: readonly number[] }[];
}): boolean {
  const pump = input.instructions.filter(
    (instruction) =>
      input.accountKeys[instruction.programIdIndex] === PUMP_PROGRAM_ID
  );
  const instruction = pump[0];
  if (pump.length !== 1 || !instruction) return false;
  return pumpCreatorFeeDistribution(PUMP_PROGRAM_ID, instruction.data);
}

export function sharingMatches(
  input: {
    adminRevoked: boolean;
    shareholders: { address: string; shareBps: number }[];
  } | null
): boolean {
  if (!input) return false;
  const verified = verifyChildSharing({
    category: "official",
    launcherWallet: LAUNCHER,
    originatorWallet: null,
    observed: input.shareholders,
    adminRevoked: input.adminRevoked,
  });
  return verified.ok;
}

export { SHARING_CONFIG };
