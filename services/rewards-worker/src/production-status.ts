import { presentProductionStatus, type ProductionStatus } from "../../../lib/rewards/production.ts";

let current: ProductionStatus = presentProductionStatus({
  canonicalMint: null,
  signer: "missing",
  rewardsActive: false,
  loopRunning: false,
  broadcastsEnabled: false,
  lastWindow: null,
  reconciliation: "unknown",
  claimsReady: false,
});

export function productionStatus(): ProductionStatus {
  return current;
}

export function replaceProductionStatus(next: ProductionStatus): void {
  current = next;
}
