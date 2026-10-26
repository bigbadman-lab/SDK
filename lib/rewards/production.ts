import { canonicalAddress } from "../auth/solana.ts";
import { TREST_MINT } from "../launch/verified-launch.ts";
import { collectionPlan } from "./collect.ts";

export const PRODUCTION_ACTIVATION_APPROVAL = "SDK-PROD-02-ACTIVATE";

export type ProductionRegistration = {
  scope: string;
  symbol: string;
  mint: string;
  tokenProgram: string;
  decimals: number;
  deployer: string;
  feeRecipient: string;
  feeMode: "single_recipient" | "fee_sharing" | "holder_rewards" | "unknown";
  quoteMint: string;
  eligible: boolean;
};

export type CanonicalParentConfig = {
  mint: string | null;
  tokenProgram: string | null;
  decimals: number | null;
  rewardsActive: boolean;
};

export type ProductionResolveCode =
  | "unregistered"
  | "mismatch"
  | "trest"
  | "ineligible"
  | "fee"
  | "signer";

export type ResolvedProductionParent = {
  ok: true;
  mint: string;
  tokenProgram: string;
  decimals: number;
  deployer: string;
  feeRecipient: string;
  quoteMint: string;
  rewardsActive: boolean;
};

export function registrationFromParent(parent: {
  scope: string;
  symbol: string;
  mintAddress: string;
  tokenProgram: string;
  decimals: number;
  deployerAddress: string;
  feeRecipientAddress: string;
  feeMode: ProductionRegistration["feeMode"];
  quoteMintAddress: string;
  eligible: boolean;
}): ProductionRegistration {
  return {
    scope: parent.scope,
    symbol: parent.symbol,
    mint: parent.mintAddress,
    tokenProgram: parent.tokenProgram,
    decimals: parent.decimals,
    deployer: parent.deployerAddress,
    feeRecipient: parent.feeRecipientAddress,
    feeMode: parent.feeMode,
    quoteMint: parent.quoteMintAddress,
    eligible: parent.eligible,
  };
}

export function resolveProductionParent(input: {
  registration: ProductionRegistration | null;
  config: CanonicalParentConfig | null;
  signerAddress: string | null;
}): ResolvedProductionParent | { ok: false; code: ProductionResolveCode } {
  const registration = input.registration;
  const config = input.config;
  if (!registration || !config?.mint) return { ok: false, code: "unregistered" };
  const mint = canonicalAddress(registration.mint);
  const configMint = canonicalAddress(config.mint);
  if (!mint || !configMint) return { ok: false, code: "unregistered" };
  if (mint === TREST_MINT || configMint === TREST_MINT) return { ok: false, code: "trest" };
  if (registration.scope !== "production" || registration.symbol !== "SDK") return { ok: false, code: "unregistered" };
  if (mint !== configMint) return { ok: false, code: "mismatch" };
  const program = canonicalAddress(registration.tokenProgram);
  const configProgram = config.tokenProgram ? canonicalAddress(config.tokenProgram) : null;
  if (!program || !configProgram || program !== configProgram) return { ok: false, code: "mismatch" };
  if (!Number.isInteger(registration.decimals) || registration.decimals < 0 || registration.decimals > 9) {
    return { ok: false, code: "mismatch" };
  }
  if (config.decimals !== registration.decimals) return { ok: false, code: "mismatch" };
  if (registration.eligible !== true) return { ok: false, code: "ineligible" };
  const deployer = canonicalAddress(registration.deployer);
  const recipient = canonicalAddress(registration.feeRecipient);
  const quote = canonicalAddress(registration.quoteMint);
  if (!deployer || !recipient || !quote || recipient !== deployer) return { ok: false, code: "fee" };
  if (registration.feeMode !== "single_recipient") return { ok: false, code: "fee" };
  const plan = collectionPlan({ feeMode: "single_recipient", creator: deployer, quoteMint: quote });
  if (!plan.ok) return { ok: false, code: "fee" };
  const signer = input.signerAddress ? canonicalAddress(input.signerAddress) : null;
  if (!signer || signer !== deployer) return { ok: false, code: "signer" };
  return {
    ok: true,
    mint,
    tokenProgram: program,
    decimals: registration.decimals,
    deployer,
    feeRecipient: recipient,
    quoteMint: quote,
    rewardsActive: config.rewardsActive === true,
  };
}

export type ProductionSignerLabel = "matched" | "missing" | "suspended";
export type ProductionReconciliation = "clear" | "outstanding" | "unknown";

export type ProductionStatus = {
  canonicalMint: string | null;
  signer: ProductionSignerLabel;
  rewards: "active" | "inactive";
  loop: "running" | "stopped";
  broadcasts: "enabled" | "disabled";
  lastWindow: string | null;
  reconciliation: ProductionReconciliation;
  claims: "ready" | "closed";
  distributor: "present";
  childFees: "enabled" | "disabled";
  launches: "active" | "inactive";
  childFeeReconciliation: ProductionReconciliation;
  emergencyFence: "active" | "inactive";
};

export function presentProductionStatus(input: {
  canonicalMint: string | null;
  signer: ProductionSignerLabel;
  rewardsActive: boolean;
  loopRunning: boolean;
  broadcastsEnabled: boolean;
  lastWindow: string | null;
  reconciliation: ProductionReconciliation;
  claimsReady: boolean;
  childFeesEnabled?: boolean;
  launchesActive?: boolean;
  childFeeReconciliation?: ProductionReconciliation;
  emergencyFence?: boolean;
}): ProductionStatus {
  const mint = input.canonicalMint && input.canonicalMint !== TREST_MINT ? canonicalAddress(input.canonicalMint) : null;
  const rewardsActive = input.rewardsActive === true && mint !== null;
  const broadcasting = rewardsActive && input.signer === "matched" && input.loopRunning && input.broadcastsEnabled;
  return {
    canonicalMint: mint,
    signer: input.signer,
    rewards: rewardsActive ? "active" : "inactive",
    loop: input.loopRunning ? "running" : "stopped",
    broadcasts: broadcasting ? "enabled" : "disabled",
    lastWindow: input.lastWindow,
    reconciliation: input.reconciliation,
    claims: broadcasting && input.claimsReady ? "ready" : "closed",
    distributor: "present",
    childFees: input.childFeesEnabled === true && input.emergencyFence !== true && mint !== null && input.signer === "matched" && input.loopRunning ? "enabled" : "disabled",
    launches: input.launchesActive === true && mint !== null ? "active" : "inactive",
    childFeeReconciliation: input.childFeeReconciliation ?? "unknown",
    emergencyFence: input.emergencyFence === true ? "active" : "inactive",
  };
}

export function workerConfirmsProductionRewards(body: {
  runtime?: unknown;
  executionAuthorised?: unknown;
  production?: { rewards?: unknown; broadcasts?: unknown } | null;
}): boolean {
  return body.runtime === "ready"
    && body.executionAuthorised === true
    && body.production?.rewards === "active"
    && body.production?.broadcasts === "enabled";
}

export function claimScopeAllowed(mode: "test" | "production", scope: "test" | "production"): boolean {
  return mode === scope;
}

export function admitTick(state: { stopping: boolean; busy: boolean }): "run" | "overlap" | "shutdown" {
  if (state.stopping) return "shutdown";
  if (state.busy) return "overlap";
  return "run";
}

export type ActivationPrerequisite = {
  id: string;
  requirement: string;
};

export function productionActivationPrerequisites(): readonly ActivationPrerequisite[] {
  return [
    {
      id: "mint",
      requirement: "The canonical production mint is registered and resolveProductionParent matches sdk_parent_config.",
    },
    {
      id: "inactive",
      requirement: "sdk_parent_config.rewards_active is false and public child launches stay closed.",
    },
    {
      id: "worker",
      requirement: "Deploy the rewards worker with SDK_DEPLOYER_ADDRESS, the matching SDK_DEPLOYER_PRIVATE_KEY, SDK_SIGNER_SUSPENDED=false, REWARDS_LOOP_ENABLED=true, and REWARDS_EXECUTION_AUTHORIZED=true.",
    },
    {
      id: "health",
      requirement: "GET /health reports signer matched, rewards inactive, broadcasts disabled, and claims closed.",
    },
    {
      id: "activate",
      requirement: `Set rewards_active true only with approval ${PRODUCTION_ACTIVATION_APPROVAL}. The following tick may broadcast.`,
    },
    {
      id: "display",
      requirement: "The website shows live rewards only after /health reports rewards active and broadcasts enabled.",
    },
  ];
}
