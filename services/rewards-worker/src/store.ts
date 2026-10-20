import type { ExecutionIntent, IntentStatus } from "../../../lib/rewards/cycle.ts";
import type { FeeReceipt, RewardScope } from "../../../lib/rewards/ledger.ts";

export type RegisteredParent = {
  id: string;
  scope: RewardScope;
  symbol: "TREST" | "SDK";
  mintAddress: string;
  deployerAddress: string;
  feeRecipientAddress: string;
  feeMode: "single_recipient" | "fee_sharing" | "holder_rewards" | "unknown";
  tokenProgram: string;
  decimals: number;
  graduated: boolean;
  quoteMintAddress: string;
  eligible: boolean;
};

export type RewardControl = {
  suspended: boolean;
  reserveLamports: string;
  cycleCapLamports: string;
  slippageBps: number;
};

export type StoredIntent = ExecutionIntent & {
  amountLamports: string | null;
  tokenAmount: string | null;
  messageSha256: string | null;
};

export type StoredSnapshot = {
  owner: string;
  balance: string;
  solLamports: string;
  tokenAmount: string;
  cutoffSlot: string;
};

export type StoredClaim = {
  claimant: string;
  asset: "sol" | "trest";
  amount: string;
  idempotencyKey: string;
  status: IntentStatus;
  signature: string | null;
  scope: RewardScope;
  parentMint: string;
  proofHash: string;
};

export type RewardsStore = {
  parent(scope: RewardScope): Promise<RegisteredParent | null>;
  control(parentMint: string, scope: RewardScope): Promise<RewardControl | null>;
  intents(parentMint: string, scope: RewardScope): Promise<StoredIntent[]>;
  recordIntent(intent: Omit<StoredIntent, "status" | "signature"> & { amountLamports: string | null }): Promise<"ok" | "duplicate">;
  markIntent(parentMint: string, scope: RewardScope, idempotencyKey: string, status: IntentStatus, signature: string | null): Promise<"ok" | "order" | "duplicate">;
  receipts(parentMint: string, scope: RewardScope): Promise<FeeReceipt[]>;
  saveReceipt(receipt: FeeReceipt & { gross: string; fee: string; native: string; wsolConverted: string; rentExcluded: string }): Promise<"ok" | "duplicate">;
  windows(parentMint: string, scope: RewardScope): Promise<{ windowKey: string; collected: string; holders: string; buyback: string; deployer: string }[]>;
  saveWindow(input: {
    parentMint: string;
    scope: RewardScope;
    windowKey: string;
    collected: string;
    holders: string;
    buyback: string;
    deployer: string;
  }): Promise<"ok" | "duplicate">;
  snapshots(parentMint: string, scope: RewardScope, windowKey: string): Promise<StoredSnapshot[]>;
  saveSnapshots(parentMint: string, scope: RewardScope, windowKey: string, rows: StoredSnapshot[]): Promise<"ok" | "duplicate">;
  creditSnapshotTokens(parentMint: string, scope: RewardScope, windowKey: string, rows: { owner: string; tokenAmount: string }[]): Promise<"ok" | "missing">;
  claims(parentMint: string, scope: RewardScope): Promise<StoredClaim[]>;
  saveClaim(claim: StoredClaim): Promise<"ok" | "duplicate" | "uncertain" | "amount">;
  markClaim(parentMint: string, scope: RewardScope, idempotencyKey: string, status: IntentStatus, signature: string | null): Promise<"ok" | "order">;
  tryLock(parentMint: string, scope: RewardScope, holder: string, nowMs: number): Promise<"ok" | "locked">;
  unlock(parentMint: string, scope: RewardScope, holder: string): Promise<void>;
};

const LEASE_MS = 5 * 60 * 1000;

export function memoryStore(seed: { parent: RegisteredParent; control: RewardControl }): RewardsStore {
  const intents: StoredIntent[] = [];
  const receipts: Array<FeeReceipt & { gross: string; fee: string; native: string; wsolConverted: string; rentExcluded: string }> = [];
  const windows: Array<{ parentMint: string; scope: RewardScope; windowKey: string; collected: string; holders: string; buyback: string; deployer: string }> = [];
  const snapshots: Array<StoredSnapshot & { parentMint: string; scope: RewardScope; windowKey: string }> = [];
  const claims: StoredClaim[] = [];
  let lock: { parentMint: string; scope: RewardScope; holder: string; expiresAt: number } | null = null;
  let tail = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T> | T): Promise<T> => {
    const run = tail.then(work, work);
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  return {
    async parent(scope) {
      return seed.parent.scope === scope ? seed.parent : null;
    },
    async control(parentMint, scope) {
      if (seed.parent.mintAddress !== parentMint || seed.parent.scope !== scope) return null;
      return seed.control;
    },
    async intents(parentMint, scope) {
      return intents.filter((intent) => intent.parentMint === parentMint && intent.scope === scope);
    },
    async recordIntent(intent) {
      return exclusive(() => {
        if (intents.some((row) => row.parentMint === intent.parentMint && row.scope === intent.scope && row.idempotencyKey === intent.idempotencyKey)) {
          return "duplicate";
        }
        intents.push({ ...intent, status: "recorded", signature: null });
        return "ok";
      });
    },
    async markIntent(parentMint, scope, idempotencyKey, status, signature) {
      return exclusive(() => {
        const current = intents.find((intent) => intent.parentMint === parentMint && intent.scope === scope && intent.idempotencyKey === idempotencyKey);
        if (!current) return "order";
        if (status === "recorded") return "order";
        if (current.status === "recorded" && !signature) return "order";
        if (current.status !== "recorded" && current.status !== "submitted" && current.status !== "uncertain") return "order";
        if (signature && intents.some((intent) => intent.signature === signature && intent.idempotencyKey !== idempotencyKey)) return "duplicate";
        current.status = status;
        current.signature = signature ?? current.signature;
        return "ok";
      });
    },
    async receipts(parentMint, scope) {
      return receipts.filter((receipt) => receipt.parentMint === parentMint && receipt.scope === scope);
    },
    async saveReceipt(receipt) {
      return exclusive(() => {
        if (receipts.some((row) => row.signature === receipt.signature)) return "duplicate";
        receipts.push(receipt);
        return "ok";
      });
    },
    async windows(parentMint, scope) {
      return windows.filter((row) => row.parentMint === parentMint && row.scope === scope);
    },
    async saveWindow(input) {
      return exclusive(() => {
        if (windows.some((row) => row.windowKey === input.windowKey)) return "duplicate";
        windows.push(input);
        return "ok";
      });
    },
    async snapshots(parentMint, scope, windowKey) {
      return snapshots.filter((row) => row.parentMint === parentMint && row.scope === scope && row.windowKey === windowKey);
    },
    async saveSnapshots(parentMint, scope, windowKey, rows) {
      return exclusive(() => {
        if (snapshots.some((row) => row.parentMint === parentMint && row.scope === scope && row.windowKey === windowKey)) return "duplicate";
        snapshots.push(...rows.map((row) => ({ ...row, parentMint, scope, windowKey })));
        return "ok";
      });
    },
    async creditSnapshotTokens(parentMint, scope, windowKey, rows) {
      return exclusive(() => {
        const existing = snapshots.filter((row) => row.parentMint === parentMint && row.scope === scope && row.windowKey === windowKey);
        if (existing.length === 0) return "missing";
        for (const row of rows) {
          const snapshot = existing.find((item) => item.owner === row.owner);
          if (!snapshot) return "missing";
          snapshot.tokenAmount = row.tokenAmount;
        }
        return "ok";
      });
    },
    async claims(parentMint, scope) {
      return claims.filter((claim) => claim.parentMint === parentMint && claim.scope === scope);
    },
    async saveClaim(claim) {
      return exclusive(() => {
        if (claims.some((row) => row.parentMint === claim.parentMint && row.scope === claim.scope && row.idempotencyKey === claim.idempotencyKey)) {
          return "duplicate";
        }
        if (claims.some((row) => row.parentMint === claim.parentMint && row.scope === claim.scope && row.claimant === claim.claimant && row.asset === claim.asset && (row.status === "uncertain" || row.status === "unreconciled" || row.status === "submitted"))) {
          return "uncertain";
        }
        const entitlement = snapshots
          .filter((row) => row.parentMint === claim.parentMint && row.scope === claim.scope && row.owner === claim.claimant)
          .reduce((sum, row) => sum + BigInt(claim.asset === "sol" ? row.solLamports : row.tokenAmount), BigInt(0));
        const already = claims
          .filter((row) => row.parentMint === claim.parentMint && row.scope === claim.scope && row.claimant === claim.claimant && row.asset === claim.asset && row.status !== "failed")
          .reduce((sum, row) => sum + BigInt(row.amount), BigInt(0));
        if (already + BigInt(claim.amount) > entitlement) return "amount";
        claims.push(claim);
        return "ok";
      });
    },
    async markClaim(parentMint, scope, idempotencyKey, status, signature) {
      return exclusive(() => {
        const claim = claims.find((row) => row.parentMint === parentMint && row.scope === scope && row.idempotencyKey === idempotencyKey);
        if (!claim || (claim.status !== "recorded" && claim.status !== "submitted" && claim.status !== "uncertain" && claim.status !== "unreconciled")) return "order";
        claim.status = status;
        claim.signature = signature ?? claim.signature;
        return "ok";
      });
    },
    async tryLock(parentMint, scope, holder, nowMs) {
      return exclusive(() => {
        if (lock && lock.expiresAt > nowMs && (lock.parentMint !== parentMint || lock.scope !== scope || lock.holder !== holder)) {
          return "locked";
        }
        lock = { parentMint, scope, holder, expiresAt: nowMs + LEASE_MS };
        return "ok";
      });
    },
    async unlock(parentMint, scope, holder) {
      await exclusive(() => {
        if (lock && lock.parentMint === parentMint && lock.scope === scope && lock.holder === holder) lock = null;
      });
    },
  };
}
