export type ProductionSignReason =
  | "closed"
  | "parent_unregistered"
  | "not_ready"
  | "preflight"
  | "mint_lost"
  | "ready";

export function productionSignAllowed(input: {
  gateOpen: boolean;
  parentIsCanonical: boolean;
  persistenceReady: boolean;
  committedHash: string | null;
  preflightHash: string | null;
  mintAvailable: boolean;
}): { allowed: boolean; reason: ProductionSignReason } {
  if (!input.gateOpen) return { allowed: false, reason: "closed" };
  if (!input.parentIsCanonical) return { allowed: false, reason: "parent_unregistered" };
  if (!input.persistenceReady) return { allowed: false, reason: "not_ready" };
  if (!input.committedHash || input.preflightHash !== input.committedHash) {
    return { allowed: false, reason: "preflight" };
  }
  if (!input.mintAvailable) return { allowed: false, reason: "mint_lost" };
  return { allowed: true, reason: "ready" };
}
