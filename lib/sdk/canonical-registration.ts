import { createHash } from "node:crypto";

import { canonicalAddress } from "../auth/solana.ts";
import { publicChildLaunchesOpen } from "../launch/public-launch.ts";
import type { ParentFeeMode, ParentObservation } from "../launch/parent.ts";
import { TREST_MINT, TOKEN_2022_PROGRAM } from "../launch/verified-launch.ts";
import { publicSdkRequest } from "./rehearsal.ts";

export const CANONICAL_APPROVAL = "SDK-PROD-01-REGISTER";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const CURVE_CAP = 5;

const FEE_MODES = new Set<ParentFeeMode>(["single_recipient", "fee_sharing", "holder_rewards"]);
const TOKEN_PROGRAMS = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);

export type CanonicalFeeMode = ParentFeeMode;

export type CanonicalIdentity = {
  mint: string;
  tokenProgram: string;
  decimals: number;
  deployer: string;
  feeRecipient: string;
  feeMode: CanonicalFeeMode;
  quoteMint: string;
  bondingCurve: string | null;
  graduated: boolean;
  pool: string | null;
  creator: string;
  operator: string;
  evidenceHash: string;
};

export type ExistingCanonical = {
  config: null | {
    mint: string | null;
    tokenProgram: string | null;
    decimals: number | null;
    quoteMint: string | null;
  };
  production: null | {
    mint: string;
    tokenProgram: string;
    decimals: number;
    quoteMint: string;
    deployer: string;
    feeRecipient: string;
    feeMode: string;
  };
};

export type MintAccountFacts = {
  owner: string;
  decimals: number;
  initialized: boolean;
};

export type RegistrationCode =
  | "missing_mint"
  | "invalid_address"
  | "mint_not_found"
  | "token_program"
  | "mint_configuration"
  | "pump_incompatible"
  | "unavailable"
  | "fee_mode"
  | "fee_recipient"
  | "trest_mint"
  | "conflict"
  | "migration_required"
  | "config"
  | "args"
  | "approval"
  | "deployer"
  | "operator"
  | "rolled_back";

export type RegistrationDecision =
  | { ok: true; kind: "ready" | "idempotent"; identity: CanonicalIdentity }
  | { ok: false; code: RegistrationCode };

export type RegisterCommand =
  | {
      ok: true;
      mode: "dry-run" | "execute";
      mint: string;
      deployer: string;
      feeRecipient: string;
      feeMode: CanonicalFeeMode;
      operator: string;
    }
  | { ok: false; code: RegistrationCode };

export type RegisterIo = {
  readMintAccount(mint: string): Promise<{ owner: string; data: Uint8Array } | null | "unavailable">;
  observe(mint: string): Promise<
    | { ok: true; observation: ParentObservation }
    | { ok: false; code: "parent_ineligible" | "unavailable" }
  >;
  readExisting(): Promise<ExistingCanonical | "unavailable">;
  schemaReady(): Promise<boolean | "unavailable">;
  commit(identity: CanonicalIdentity): Promise<"ok" | "idempotent" | "blocked" | "rolled_back">;
  childLaunchesOpen(): boolean;
};

const EMPTY_EXISTING: ExistingCanonical = { config: null, production: null };

export function readMintAccount(owner: string, data: Uint8Array): MintAccountFacts | null {
  if (!TOKEN_PROGRAMS.has(owner) || data.length < 82) return null;
  const decimals = data[44];
  const initialized = data[45];
  if (decimals === undefined || initialized !== 1 || decimals > 9) return null;
  return { owner, decimals, initialized: true };
}

export function canonicalEvidenceHash(identity: Omit<CanonicalIdentity, "evidenceHash">): string {
  return createHash("sha256")
    .update(JSON.stringify({
      mint: identity.mint,
      tokenProgram: identity.tokenProgram,
      decimals: identity.decimals,
      deployer: identity.deployer,
      feeRecipient: identity.feeRecipient,
      feeMode: identity.feeMode,
      quoteMint: identity.quoteMint,
      creator: identity.creator,
      operator: identity.operator,
    }))
    .digest("hex");
}

export function registrationSchemaReady(input: { rewardsColumn: boolean; identityTrigger: boolean }): boolean {
  return input.rewardsColumn && input.identityTrigger;
}

function address(value: string | undefined): string | null {
  if (!value) return null;
  return canonicalAddress(value);
}

function feeMode(value: string | undefined): CanonicalFeeMode | null {
  if (!value || !FEE_MODES.has(value as CanonicalFeeMode)) return null;
  return value as CanonicalFeeMode;
}

export function parseRegisterArgs(argv: readonly string[]): RegisterCommand {
  const values = new Map<string, string>();
  let execute = false;
  const tokens = argv.slice(2);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const equals = token.indexOf("=");
    const name = equals === -1 ? token : token.slice(0, equals);
    if (name === "--execute") {
      if (execute || equals !== -1) return { ok: false, code: "args" };
      execute = true;
      continue;
    }
    if (name !== "--mint" && name !== "--deployer" && name !== "--fee-recipient" && name !== "--fee-mode" && name !== "--operator" && name !== "--approval") {
      return { ok: false, code: "args" };
    }
    if (values.has(name)) return { ok: false, code: "args" };
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
    const value = inline ?? tokens[index + 1];
    if (inline === undefined) index += 1;
    if (!value || value.startsWith("--")) return { ok: false, code: "args" };
    values.set(name, value);
  }
  if (!values.has("--mint")) return { ok: false, code: "missing_mint" };
  const mint = address(values.get("--mint"));
  if (!mint) return { ok: false, code: "invalid_address" };
  if (!values.has("--deployer")) return { ok: false, code: "deployer" };
  const deployer = address(values.get("--deployer"));
  if (!deployer) return { ok: false, code: "deployer" };
  if (!values.has("--fee-recipient")) return { ok: false, code: "fee_recipient" };
  const recipient = address(values.get("--fee-recipient"));
  if (!recipient) return { ok: false, code: "fee_recipient" };
  if (!values.has("--fee-mode")) return { ok: false, code: "fee_mode" };
  const mode = feeMode(values.get("--fee-mode"));
  if (!mode) return { ok: false, code: "fee_mode" };
  if (!values.has("--operator")) return { ok: false, code: "operator" };
  const operator = address(values.get("--operator"));
  if (!operator) return { ok: false, code: "operator" };
  const approval = values.get("--approval");
  if (execute && approval !== CANONICAL_APPROVAL) return { ok: false, code: "approval" };
  if (!execute && approval !== undefined && approval !== CANONICAL_APPROVAL) return { ok: false, code: "approval" };
  return {
    ok: true,
    mode: execute ? "execute" : "dry-run",
    mint,
    deployer,
    feeRecipient: recipient,
    feeMode: mode,
    operator,
  };
}

export function quoteParentCompatible(observation: ParentObservation, mintAccount: MintAccountFacts): boolean {
  if (observation.source !== "pumpCoin" || observation.mayhem || observation.cashback) return false;
  if (!Number.isInteger(observation.maxCurveDepth) || observation.maxCurveDepth <= 0) return false;
  const limit = Math.min(observation.maxCurveDepth, CURVE_CAP);
  if (!Number.isInteger(observation.depth) || observation.depth < 0 || observation.depth + 1 > limit) return false;
  if (observation.graduated !== observation.hasPool) return false;
  if (observation.graduated && !observation.pool) return false;
  if (!observation.graduated && observation.pool) return false;
  if (observation.decimals !== mintAccount.decimals || observation.tokenProgram !== mintAccount.owner) return false;
  if (!TOKEN_PROGRAMS.has(observation.tokenProgram)) return false;
  const quote = canonicalAddress(observation.quoteMint);
  if (!quote || quote === observation.mint) return false;
  return true;
}

function sameIdentity(identity: CanonicalIdentity, existing: ExistingCanonical): boolean {
  const config = existing.config;
  const production = existing.production;
  if (!config?.mint || !production) return false;
  return config.mint === identity.mint
    && config.tokenProgram === identity.tokenProgram
    && config.decimals === identity.decimals
    && config.quoteMint === identity.quoteMint
    && production.mint === identity.mint
    && production.tokenProgram === identity.tokenProgram
    && production.decimals === identity.decimals
    && production.quoteMint === identity.quoteMint
    && production.deployer === identity.deployer
    && production.feeRecipient === identity.feeRecipient
    && production.feeMode === identity.feeMode;
}

function occupied(existing: ExistingCanonical): boolean {
  return Boolean(existing.config?.mint || existing.production);
}

export function reviewCanonicalRegistration(input: {
  request: { mint: string; deployer: string; feeRecipient: string; feeMode: string; operator: string };
  mintAccount: MintAccountFacts | null;
  observation: ParentObservation | null;
  observationCode?: "parent_ineligible" | "unavailable";
  existing: ExistingCanonical;
}): RegistrationDecision {
  if (input.request.mint === TREST_MINT) return { ok: false, code: "trest_mint" };
  if (!input.mintAccount) return { ok: false, code: "mint_not_found" };
  if (!TOKEN_PROGRAMS.has(input.mintAccount.owner)) return { ok: false, code: "token_program" };
  if (!input.mintAccount.initialized || input.mintAccount.decimals < 0 || input.mintAccount.decimals > 9) {
    return { ok: false, code: "mint_configuration" };
  }
  if (input.observationCode === "unavailable") return { ok: false, code: "unavailable" };
  if (!input.observation || input.observationCode === "parent_ineligible") return { ok: false, code: "pump_incompatible" };
  if (input.observation.mint !== input.request.mint || !quoteParentCompatible(input.observation, input.mintAccount)) {
    return { ok: false, code: "pump_incompatible" };
  }
  if (input.request.feeMode !== input.observation.feeMode) return { ok: false, code: "fee_mode" };
  if (input.request.feeMode === "single_recipient" && input.request.feeRecipient !== input.request.deployer) {
    return { ok: false, code: "fee_recipient" };
  }
  const draft: Omit<CanonicalIdentity, "evidenceHash"> = {
    mint: input.request.mint,
    tokenProgram: input.mintAccount.owner,
    decimals: input.mintAccount.decimals,
    deployer: input.request.deployer,
    feeRecipient: input.request.feeRecipient,
    feeMode: input.observation.feeMode,
    quoteMint: input.observation.quoteMint,
    bondingCurve: input.observation.bondingCurve,
    graduated: input.observation.graduated,
    pool: input.observation.pool,
    creator: input.observation.creator,
    operator: input.request.operator,
  };
  const identity = { ...draft, evidenceHash: canonicalEvidenceHash(draft) };
  const kind = classifyCanonicalIdentity(identity, input.existing);
  if (kind === "conflict") return { ok: false, code: "conflict" };
  return { ok: true, kind, identity };
}

export function classifyCanonicalIdentity(
  identity: CanonicalIdentity,
  existing: ExistingCanonical,
): "ready" | "idempotent" | "conflict" {
  if (sameIdentity(identity, existing)) return "idempotent";
  if (occupied(existing)) return "conflict";
  return "ready";
}

export function memoryCanonicalStore(failAfter?: "config" | "production"): {
  commit(identity: CanonicalIdentity): "ok" | "rolled_back";
  snapshot(): { configMint: string; productionMint: string; rewardsActive: false } | null;
} {
  let state: { configMint: string; productionMint: string; rewardsActive: false } | null = null;
  return {
    commit(identity) {
      const previous = state;
      if (failAfter === "config") {
        state = previous;
        return "rolled_back";
      }
      const configMint = identity.mint;
      if (failAfter === "production") {
        state = previous;
        return "rolled_back";
      }
      state = { configMint, productionMint: identity.mint, rewardsActive: false };
      return "ok";
    },
    snapshot() {
      return state;
    },
  };
}

function lines(kind: string, fields: Record<string, string>): string {
  return [kind, ...Object.entries(fields).map(([key, value]) => `${key}=${value}`)].join("\n");
}

function isolation(io: RegisterIo): { rewards: "inactive"; child_launches: "inactive" | "active" } {
  return { rewards: "inactive", child_launches: io.childLaunchesOpen() ? "active" : "inactive" };
}

export async function runRegister(argv: readonly string[], io: RegisterIo): Promise<{ code: number; out: string }> {
  const command = parseRegisterArgs(argv);
  const gate = isolation(io);
  if (!command.ok) {
    return { code: 2, out: lines("blocked", { code: command.code, rewards: gate.rewards, child_launches: gate.child_launches, writes: "0" }) };
  }
  if (command.mint === TREST_MINT) {
    return { code: 2, out: lines("blocked", { code: "trest_mint", rewards: gate.rewards, child_launches: gate.child_launches, writes: "0" }) };
  }
  const account = await io.readMintAccount(command.mint);
  if (account === "unavailable") {
    return { code: 2, out: lines("blocked", { code: "unavailable", rewards: gate.rewards, child_launches: gate.child_launches, writes: "0" }) };
  }
  if (!account) {
    return { code: 2, out: lines("blocked", { code: "mint_not_found", rewards: gate.rewards, child_launches: gate.child_launches, writes: "0" }) };
  }
  const facts = readMintAccount(account.owner, account.data);
  if (!facts) {
    const code = account.owner === TOKEN_PROGRAM || account.owner === TOKEN_2022_PROGRAM ? "mint_configuration" : "token_program";
    return { code: 2, out: lines("blocked", { code, rewards: gate.rewards, child_launches: gate.child_launches, writes: "0" }) };
  }
  const observed = await io.observe(command.mint);
  const existing = await io.readExisting();
  if (existing === "unavailable") {
    return { code: 2, out: lines("blocked", { code: "unavailable", rewards: gate.rewards, child_launches: gate.child_launches, writes: "0" }) };
  }
  const decision = reviewCanonicalRegistration({
    request: command,
    mintAccount: facts,
    observation: observed.ok ? observed.observation : null,
    ...(observed.ok ? {} : { observationCode: observed.code }),
    existing,
  });
  if (!decision.ok) {
    return { code: 2, out: lines("blocked", { code: decision.code, rewards: gate.rewards, child_launches: gate.child_launches, writes: "0" }) };
  }
  const summary = {
    mint: decision.identity.mint,
    token_program: decision.identity.tokenProgram,
    decimals: String(decision.identity.decimals),
    quote_mint: decision.identity.quoteMint,
    deployer: decision.identity.deployer,
    fee_recipient: decision.identity.feeRecipient,
    fee_mode: decision.identity.feeMode,
    creator: decision.identity.creator,
    rewards: gate.rewards,
    child_launches: gate.child_launches,
  };
  if (command.mode === "dry-run") {
    return {
      code: 0,
      out: lines("dry-run", {
        ...summary,
        validation: decision.kind === "idempotent" ? "idempotent" : "ready",
        writes: "0",
      }),
    };
  }
  const ready = await io.schemaReady();
  if (ready !== true) {
    return { code: 2, out: lines("blocked", { code: ready === false ? "migration_required" : "unavailable", rewards: gate.rewards, child_launches: gate.child_launches, writes: "0" }) };
  }
  if (decision.kind === "idempotent") {
    return { code: 0, out: lines("registered", { mint: decision.identity.mint, verification: "idempotent", rewards: gate.rewards, child_launches: gate.child_launches, writes: "0" }) };
  }
  const committed = await io.commit(decision.identity);
  if (committed === "ok") {
    return { code: 0, out: lines("registered", { ...summary, verification: "matched", writes: "1" }) };
  }
  if (committed === "idempotent") {
    return { code: 0, out: lines("registered", { mint: decision.identity.mint, verification: "idempotent", rewards: gate.rewards, child_launches: gate.child_launches, writes: "0" }) };
  }
  return { code: 2, out: lines("blocked", { code: committed === "blocked" ? "conflict" : "rolled_back", rewards: gate.rewards, child_launches: gate.child_launches, writes: "0" }) };
}

export type CanonicalStatusInput = {
  database: "ok" | "unavailable";
  configMint: string | null;
  productionMint: string | null;
  chain: "matched" | "mismatch" | "unavailable" | "not_checked";
  rewardsActive: boolean;
  childLaunchesOpen: boolean;
};

export function presentCanonicalStatus(input: CanonicalStatusInput): { code: number; out: string } {
  const registered = Boolean(input.configMint || input.productionMint);
  const aligned = input.configMint === input.productionMint;
  const state = !registered ? "unregistered" : aligned ? "consistent" : "divergent";
  const mintState = input.configMint && aligned ? "registered" : registered ? "divergent" : "unregistered";
  return {
    code: state === "divergent" || mintState === "divergent" ? 2 : 0,
    out: lines("status", {
      canonical_mint: mintState === "registered" ? "registered" : mintState === "divergent" ? "divergent" : "unregistered",
      mint: input.configMint && aligned ? input.configMint : "",
      chain: registered ? input.chain : "not_checked",
      website: state,
      builder: state,
      rewards: input.rewardsActive ? "active" : "inactive",
      child_launches: input.childLaunchesOpen ? "active" : "inactive",
      trest_public: publicSdkRequest("test") === "denied" ? "retired" : "exposed",
      database: input.database,
    }),
  };
}

export function statusFromEnvironment(env: NodeJS.ProcessEnv = process.env): { childLaunchesOpen: boolean } {
  return { childLaunchesOpen: publicChildLaunchesOpen(env.PUBLIC_CHILD_LAUNCHES) };
}

export { EMPTY_EXISTING };
