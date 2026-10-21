// Rehearsal defaults for a newly registered TREST parent.
// signerSuspended stays true, so creating the row does not authorise collection,
// buyback, or claims. An operator must change that flag explicitly.
// The reserve is withheld once from the first confirmed creator fees so the
// deployer wallet keeps 0.005 SOL of fee proceeds for transaction fees. It is
// not an estimate of fee volume and it is not charged again on later windows.
// The cycle cap refuses a single buyback above 0.1 SOL. Slippage is 1%.

const AMOUNT = /^(0|[1-9][0-9]{0,18})$/;

export const REHEARSAL_RESERVE_LAMPORTS = "5000000";
export const REHEARSAL_CYCLE_CAP_LAMPORTS = "100000000";
export const REHEARSAL_SLIPPAGE_BPS = 100;

export type RehearsalControl = {
  suspended: true;
  reserveLamports: typeof REHEARSAL_RESERVE_LAMPORTS;
  cycleCapLamports: typeof REHEARSAL_CYCLE_CAP_LAMPORTS;
  slippageBps: typeof REHEARSAL_SLIPPAGE_BPS;
};

export function rehearsalControl(): { ok: true; control: RehearsalControl } | { ok: false; code: "control" } {
  if (!AMOUNT.test(REHEARSAL_RESERVE_LAMPORTS) || !AMOUNT.test(REHEARSAL_CYCLE_CAP_LAMPORTS)) {
    return { ok: false, code: "control" };
  }
  if (BigInt(REHEARSAL_CYCLE_CAP_LAMPORTS) <= BigInt(0)) return { ok: false, code: "control" };
  if (!Number.isInteger(REHEARSAL_SLIPPAGE_BPS) || REHEARSAL_SLIPPAGE_BPS < 1 || REHEARSAL_SLIPPAGE_BPS > 1000) {
    return { ok: false, code: "control" };
  }
  return {
    ok: true,
    control: {
      suspended: true,
      reserveLamports: REHEARSAL_RESERVE_LAMPORTS,
      cycleCapLamports: REHEARSAL_CYCLE_CAP_LAMPORTS,
      slippageBps: REHEARSAL_SLIPPAGE_BPS,
    },
  };
}

export function controlInitialisation(input: {
  scope: "production" | "test";
  symbol: "SDK" | "TREST";
  existing: boolean;
}): "create" | "preserve" | "reject" {
  if (input.scope !== "test" || input.symbol !== "TREST") return "reject";
  return input.existing ? "preserve" : "create";
}
