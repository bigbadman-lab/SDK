import { accountingWindow, splitCreatorFees, type RewardScope } from "./ledger.ts";

export const REWARDS_LOOP_ENABLED = false;

export type IntentKind = "collect" | "buyback" | "claim_sol" | "claim_token";
export type IntentStatus = "recorded" | "submitted" | "confirmed" | "failed" | "uncertain" | "unreconciled";

export type ExecutionIntent = {
  idempotencyKey: string;
  parentMint: string;
  scope: RewardScope;
  kind: IntentKind;
  status: IntentStatus;
  signature: string | null;
};

export function windowKey(parentMint: string, scope: RewardScope, timestampMs: number): string | null {
  const window = accountingWindow(timestampMs);
  if (!window) return null;
  return `${scope}:${parentMint}:${window.startMs}`;
}

export function acquireCycleLock(
  lock: { parentMint: string; scope: RewardScope; holder: string } | null,
  next: { parentMint: string; scope: RewardScope; holder: string },
): { ok: true; lock: { parentMint: string; scope: RewardScope; holder: string } } | { ok: false; code: "locked" } {
  if (lock && (lock.parentMint !== next.parentMint || lock.scope !== next.scope || lock.holder !== next.holder)) {
    return { ok: false, code: "locked" };
  }
  if (lock) return { ok: false, code: "locked" };
  return { ok: true, lock: next };
}

export function releaseCycleLock(
  lock: { parentMint: string; scope: RewardScope; holder: string } | null,
  holder: string,
): { ok: true; lock: null } | { ok: false; code: "locked" } {
  if (!lock || lock.holder !== holder) return { ok: false, code: "locked" };
  return { ok: true, lock: null };
}

export function recordIntent(input: {
  existing: readonly ExecutionIntent[];
  intent: Omit<ExecutionIntent, "status" | "signature">;
}): { ok: true; intents: ExecutionIntent[] } | { ok: false; code: "duplicate" | "uncertain" } {
  const sameParent = input.existing.filter(
    (intent) => intent.parentMint === input.intent.parentMint && intent.scope === input.intent.scope,
  );
  if (sameParent.some((intent) => intent.idempotencyKey === input.intent.idempotencyKey)) {
    return { ok: false, code: "duplicate" };
  }
  const blocking = new Set<IntentStatus>(["uncertain", "unreconciled"]);
  if (input.intent.kind === "buyback" && sameParent.some((intent) => intent.kind === "buyback" && blocking.has(intent.status))) {
    return { ok: false, code: "uncertain" };
  }
  if (
    (input.intent.kind === "claim_sol" || input.intent.kind === "claim_token") &&
    sameParent.some((intent) => intent.kind === input.intent.kind && blocking.has(intent.status))
  ) {
    return { ok: false, code: "uncertain" };
  }
  return {
    ok: true,
    intents: [...input.existing, { ...input.intent, status: "recorded", signature: null }],
  };
}

export function markSubmitted(
  intents: readonly ExecutionIntent[],
  idempotencyKey: string,
  signature: string,
): { ok: true; intents: ExecutionIntent[] } | { ok: false; code: "order" | "duplicate" } {
  const current = intents.find((intent) => intent.idempotencyKey === idempotencyKey);
  if (!current || current.status !== "recorded" || current.signature !== null) return { ok: false, code: "order" };
  if (intents.some((intent) => intent.signature === signature)) return { ok: false, code: "duplicate" };
  return {
    ok: true,
    intents: intents.map((intent) =>
      intent.idempotencyKey === idempotencyKey ? { ...intent, status: "submitted", signature } : intent,
    ),
  };
}

export function observeIntent(
  intents: readonly ExecutionIntent[],
  idempotencyKey: string,
  status: "confirmed" | "failed" | "uncertain" | "unreconciled",
): { ok: true; intents: ExecutionIntent[] } | { ok: false; code: "order" } {
  const current = intents.find((intent) => intent.idempotencyKey === idempotencyKey);
  if (!current || (current.status !== "submitted" && current.status !== "uncertain") || !current.signature) {
    return { ok: false, code: "order" };
  }
  return {
    ok: true,
    intents: intents.map((intent) => (intent.idempotencyKey === idempotencyKey ? { ...intent, status } : intent)),
  };
}

export function allocateWindow(input: {
  parentMint: string;
  scope: RewardScope;
  timestampMs: number;
  netLamports: string;
  reserveLamports: string;
  receiptSignatures: readonly string[];
  allocatedSignatures: readonly string[];
  existingWindowKeys: readonly string[];
}):
  | {
      ok: true;
      duplicate: boolean;
      windowKey: string;
      holders: string;
      buyback: string;
      deployer: string;
      base: string;
    }
  | { ok: false; code: "amount" | "duplicate" | "window" } {
  const key = windowKey(input.parentMint, input.scope, input.timestampMs);
  if (!key) return { ok: false, code: "window" };
  if (input.existingWindowKeys.includes(key)) {
    return { ok: true, duplicate: true, windowKey: key, holders: "0", buyback: "0", deployer: "0", base: "0" };
  }
  if (input.receiptSignatures.some((signature) => input.allocatedSignatures.includes(signature))) {
    return { ok: false, code: "duplicate" };
  }
  if (!/^(0|[1-9][0-9]{0,18})$/.test(input.netLamports) || !/^(0|[1-9][0-9]{0,18})$/.test(input.reserveLamports)) {
    return { ok: false, code: "amount" };
  }
  const net = BigInt(input.netLamports);
  const reserve = BigInt(input.reserveLamports);
  const base = net > reserve ? net - reserve : BigInt(0);
  const split = splitCreatorFees(base.toString());
  if (!split.ok) return { ok: false, code: "amount" };
  return {
    ok: true,
    duplicate: false,
    windowKey: key,
    holders: split.holders,
    buyback: split.buyback,
    deployer: split.deployer,
    base: base.toString(),
  };
}

export function buybackBlocked(intents: readonly ExecutionIntent[], parentMint: string, scope: RewardScope): boolean {
  return intents.some(
    (intent) =>
      intent.parentMint === parentMint &&
      intent.scope === scope &&
      intent.kind === "buyback" &&
      (intent.status === "uncertain" || intent.status === "unreconciled"),
  );
}
