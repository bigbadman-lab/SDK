import type { RewardScope } from "../../../lib/rewards/ledger.ts";
import { creatorVaultAddress, type Chain } from "./chain.ts";
import type { LegacyEvidence, LegacyRecovery, RewardsStore, StoredIntent } from "./store.ts";

export const LEGACY_RECOVERY_APPROVAL = "TREST-07F-LEGACY-RECOVERY";
export const BLOCKHASH_SLOTS = 150;

const TREST_MINT = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
const LEGACY = [
  {
    parentMint: TREST_MINT,
    scope: "test" as const,
    idempotencyKey: "collect-1792587300000",
    signature: "3QkoLCoC9xNnesUMksjxrEVx6UEvdMcZPo9NM8DZZBu4FXUUuqiAZvBvPGMjaZuHyNxyrjbdbLPSVDzbL3Ggi84m",
  },
  {
    parentMint: TREST_MINT,
    scope: "test" as const,
    idempotencyKey: "collect-1792587600000",
    signature: "Rh18WpUe1wkT8bV8eVev7uTg1SY4jf1tRqdjo6c6Zufmtqbs5n99Yq6kJ3HzLLnxXKdtcKuwjKhWPpQx5E3Cqu6",
  },
] as const;

export function legacyCollectionByKey(idempotencyKey: string): (typeof LEGACY)[number] | null {
  return LEGACY.find((row) => row.idempotencyKey === idempotencyKey) ?? null;
}

const OPERATOR = /^[A-Za-z0-9_-]{1,80}$/;

export type LegacyRecoveryCode = "approval" | "confirmed" | "duplicate" | "evidence" | "intent" | "legacy" | "parent" | "signature";

export function matchesLegacyCollection(input: {
  parentMint: string;
  scope: string;
  idempotencyKey: string;
  signature: string | null;
}): boolean {
  return LEGACY.some((row) =>
    row.parentMint === input.parentMint
    && row.scope === input.scope
    && row.idempotencyKey === input.idempotencyKey
    && row.signature === input.signature
  );
}

export function legacyCollectionRetired(intent: StoredIntent, recoveries: readonly LegacyRecovery[]): boolean {
  return recoveries.some((recovery) =>
    recovery.parentMint === intent.parentMint
    && recovery.scope === intent.scope
    && recovery.idempotencyKey === intent.idempotencyKey
    && recovery.signature === intent.signature
    && recovery.priorStatus === "uncertain"
    && recovery.approval === LEGACY_RECOVERY_APPROVAL
    && matchesLegacyCollection(intent)
  );
}

async function sampledBlock(chain: Chain, slot: number): Promise<{ slot: number; time: number } | null> {
  for (let offset = 0; offset <= 8; offset += 1) {
    for (const candidate of [slot + offset, slot - offset]) {
      if (candidate < 0) continue;
      const time = await chain.blockTime(String(candidate));
      if (time !== null) return { slot: candidate, time };
    }
  }
  return null;
}

export async function proveBlockhashWindow(
  chain: Chain,
  createdAtMs: string,
  currentSlot: string,
): Promise<{ ok: true; submissionSlot: string; slotsElapsed: string } | { ok: false }> {
  const created = Number(createdAtMs);
  const current = Number(currentSlot);
  if (!Number.isSafeInteger(created) || created < 0 || !Number.isSafeInteger(current) || current <= BLOCKHASH_SLOTS) return { ok: false };
  const target = Math.floor(created / 1000);
  let low = Math.max(0, current - 100_000);
  let high = current;
  let submissionSlot: number | null = null;
  for (let step = 0; step < 20 && low <= high; step += 1) {
    const sample = await sampledBlock(chain, Math.floor((low + high) / 2));
    if (!sample) return { ok: false };
    if (sample.time < target) low = sample.slot + 1;
    else {
      submissionSlot = sample.slot;
      high = sample.slot - 1;
    }
  }
  if (submissionSlot === null || current < submissionSlot + BLOCKHASH_SLOTS) return { ok: false };
  return { ok: true, submissionSlot: String(submissionSlot), slotsElapsed: String(current - submissionSlot) };
}

export async function reconcileLegacyCollection(input: {
  authorised: boolean;
  parentMint: string;
  scope: RewardScope;
  idempotencyKey: string;
  signature: string;
  approval: string;
  operator: string;
  reason: string;
  deployer: string;
  store: RewardsStore;
  chain: Chain;
}): Promise<{ ok: true; id: string; evidence: LegacyEvidence } | { ok: false; code: LegacyRecoveryCode }> {
  if (!input.authorised || input.approval !== LEGACY_RECOVERY_APPROVAL || !OPERATOR.test(input.operator) || input.reason.trim().length === 0 || input.reason.length > 240) {
    return { ok: false, code: "approval" };
  }
  const listed = LEGACY.find((row) => row.idempotencyKey === input.idempotencyKey);
  if (!listed) return { ok: false, code: "intent" };
  if (listed.parentMint !== input.parentMint || listed.scope !== input.scope) return { ok: false, code: "parent" };
  if (listed.signature !== input.signature) return { ok: false, code: "signature" };
  const intent = (await input.store.intents(input.parentMint, input.scope)).find((row) => row.idempotencyKey === input.idempotencyKey);
  if (!intent || intent.kind !== "collect") return { ok: false, code: "intent" };
  if (intent.signature !== input.signature) return { ok: false, code: "signature" };
  if (intent.status === "confirmed" || (await input.store.receipts(input.parentMint, input.scope)).some((receipt) => receipt.signature === input.signature)) {
    return { ok: false, code: "confirmed" };
  }
  if (intent.status !== "uncertain" || intent.recentBlockhash !== null) return { ok: false, code: "legacy" };
  const observed = await input.chain.transaction(input.signature, {
    creator: input.deployer,
    solVault: input.deployer,
    wsolVault: input.deployer,
    parentMint: input.parentMint,
    destination: input.deployer,
  });
  if (observed?.status === "confirmed") return { ok: false, code: "confirmed" };
  if (observed) return { ok: false, code: "evidence" };
  if (await input.chain.signatureState(input.signature) !== "absent") return { ok: false, code: "evidence" };
  const currentSlot = await input.chain.slot();
  const window = await proveBlockhashWindow(input.chain, intent.createdAtMs, currentSlot);
  if (!window.ok) return { ok: false, code: "evidence" };
  const vault = creatorVaultAddress(input.deployer);
  const deployer = await input.chain.account(input.deployer);
  const vaultAccount = vault ? await input.chain.account(vault) : null;
  if (!deployer || !vaultAccount) return { ok: false, code: "evidence" };
  const evidence: LegacyEvidence = {
    signatureState: "absent",
    transaction: "absent",
    currentSlot,
    submissionSlot: window.submissionSlot,
    slotsElapsed: window.slotsElapsed,
    blockhashSlots: "150",
    createdAtMs: intent.createdAtMs,
    deployerLamports: deployer.lamports,
    vaultLamports: vaultAccount.lamports,
  };
  const saved = await input.store.saveLegacyRecovery({
    parentMint: input.parentMint,
    scope: input.scope,
    idempotencyKey: input.idempotencyKey,
    signature: input.signature,
    priorStatus: "uncertain",
    operatorId: input.operator,
    approval: LEGACY_RECOVERY_APPROVAL,
    reason: input.reason.trim(),
    evidence,
  });
  if (!saved.ok) return { ok: false, code: saved.code === "duplicate" ? "duplicate" : "legacy" };
  const unchanged = (await input.store.intents(input.parentMint, input.scope)).find((row) => row.idempotencyKey === input.idempotencyKey);
  if (unchanged?.status !== "uncertain" || unchanged.signature !== input.signature) return { ok: false, code: "legacy" };
  return { ok: true, id: saved.id, evidence };
}
