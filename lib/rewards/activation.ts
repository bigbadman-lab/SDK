import { PRODUCTION_ACTIVATION_APPROVAL, resolveProductionParent, workerConfirmsProductionRewards, type ProductionRegistration } from "./production.ts";

export { PRODUCTION_ACTIVATION_APPROVAL };

const REVISION = /^[0-9a-f]{40}$/;

export type ActivationMode = "dry-run" | "execute";

export type ActivationCommand =
  | { ok: true; mode: ActivationMode; revision: string }
  | { ok: false; code: "args" | "approval" | "revision" };

export type ActivationChain =
  | { ok: true; owner: string; decimals: number }
  | { ok: false; code: "unavailable" | "missing" | "not_checked" };

export type ActivationWorker = {
  ok: true;
  service: string;
  runtime: string;
  signer: string;
  executionAuthorised: boolean;
  revision: string;
  production: {
    canonicalMint: string | null;
    signer: string;
    rewards: string;
    loop: string;
    broadcasts: string;
    lastWindow: string | null;
    reconciliation: string;
    claims: string;
  } | null;
};

export type ActivationSnapshot = {
  database: "ok" | "unavailable";
  config: {
    mint: string | null;
    tokenProgram: string | null;
    decimals: number | null;
    rewardsActive: boolean;
  } | null;
  registration: ProductionRegistration | null;
  chain: ActivationChain;
  signerAddress: string | null;
  worker: ActivationWorker | { ok: false; code: "unavailable" };
  unresolved: number | null;
  lastWindow: string | null;
  childLaunchesOpen: boolean;
  trestSuspended: boolean | null;
  trestRehearsalOpen: boolean | null;
};

export type ActivationBlock =
  | "approval"
  | "args"
  | "chain"
  | "child_launches"
  | "database"
  | "fee"
  | "ineligible"
  | "mismatch"
  | "reconciliation"
  | "revision"
  | "rolled_back"
  | "signer"
  | "trest"
  | "unregistered"
  | "worker_execution"
  | "worker_revision"
  | "worker_unavailable";

export type ActivationReview =
  | { ok: true; kind: "ready" | "idempotent"; mint: string }
  | { ok: false; code: ActivationBlock };

export function parseActivationArgs(argv: readonly string[]): ActivationCommand {
  let execute = false;
  let approval: string | undefined;
  let revision: string | undefined;
  const tokens = argv.slice(2);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const equals = token.indexOf("=");
    const name = equals === -1 ? token : token.slice(0, equals);
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
    if (name === "--execute") {
      if (execute || inline !== undefined) return { ok: false, code: "args" };
      execute = true;
      continue;
    }
    if (name !== "--approval" && name !== "--revision") return { ok: false, code: "args" };
    const value = inline ?? tokens[index + 1];
    if (inline === undefined) index += 1;
    if (!value || value.startsWith("--")) return { ok: false, code: "args" };
    if (name === "--approval") {
      if (approval !== undefined) return { ok: false, code: "args" };
      approval = value;
    } else {
      if (revision !== undefined) return { ok: false, code: "args" };
      revision = value;
    }
  }
  if (execute && approval !== PRODUCTION_ACTIVATION_APPROVAL) return { ok: false, code: "approval" };
  if (!execute && approval !== undefined && approval !== PRODUCTION_ACTIVATION_APPROVAL) return { ok: false, code: "approval" };
  if (!revision || !REVISION.test(revision)) return { ok: false, code: "revision" };
  return { ok: true, mode: execute ? "execute" : "dry-run", revision };
}

export function parseWorkerHealth(body: unknown): ActivationWorker | { ok: false; code: "unavailable" } {
  if (!body || typeof body !== "object") return { ok: false, code: "unavailable" };
  const record = body as Record<string, unknown>;
  if (record.service !== "rewards-worker" || record.ok !== true) return { ok: false, code: "unavailable" };
  const production = record.production;
  const parsedProduction = production && typeof production === "object"
    ? {
        canonicalMint: typeof (production as { canonicalMint?: unknown }).canonicalMint === "string"
          ? (production as { canonicalMint: string }).canonicalMint
          : null,
        signer: text((production as { signer?: unknown }).signer),
        rewards: text((production as { rewards?: unknown }).rewards),
        loop: text((production as { loop?: unknown }).loop),
        broadcasts: text((production as { broadcasts?: unknown }).broadcasts),
        lastWindow: typeof (production as { lastWindow?: unknown }).lastWindow === "string"
          ? (production as { lastWindow: string }).lastWindow
          : null,
        reconciliation: text((production as { reconciliation?: unknown }).reconciliation),
        claims: text((production as { claims?: unknown }).claims),
      }
    : null;
  return {
    ok: true,
    service: "rewards-worker",
    runtime: text(record.runtime),
    signer: text(record.signer),
    executionAuthorised: record.executionAuthorised === true,
    revision: typeof record.revision === "string" ? record.revision : "unverified",
    production: parsedProduction,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function reviewActivation(snapshot: ActivationSnapshot, revision: string): ActivationReview {
  if (snapshot.database !== "ok") return { ok: false, code: "database" };
  const registration = snapshot.registration;
  const config = snapshot.config;
  if (!registration || !config?.mint) return { ok: false, code: "unregistered" };
  const resolved = resolveProductionParent({
    registration,
    config: {
      mint: config.mint,
      tokenProgram: config.tokenProgram,
      decimals: config.decimals,
      rewardsActive: config.rewardsActive,
    },
    signerAddress: snapshot.signerAddress,
  });
  if (!resolved.ok) {
    if (resolved.code === "signer") return { ok: false, code: "signer" };
    if (resolved.code === "fee") return { ok: false, code: "fee" };
    if (resolved.code === "mismatch" || resolved.code === "trest" || resolved.code === "ineligible") {
      return { ok: false, code: resolved.code === "trest" ? "mismatch" : resolved.code };
    }
    return { ok: false, code: "unregistered" };
  }
  if (!snapshot.chain.ok) return { ok: false, code: "chain" };
  if (snapshot.chain.owner !== resolved.tokenProgram || snapshot.chain.decimals !== resolved.decimals) {
    return { ok: false, code: "chain" };
  }
  if (!snapshot.worker.ok) return { ok: false, code: "worker_unavailable" };
  const worker = snapshot.worker;
  const production = worker.production;
  if (
    worker.service !== "rewards-worker"
    || !production
    || worker.revision !== revision
    || !REVISION.test(worker.revision)
    || production.canonicalMint !== resolved.mint
  ) {
    return { ok: false, code: "worker_revision" };
  }
  if (worker.signer !== "matched" || production.signer !== "matched" || worker.runtime === "suspended") {
    return { ok: false, code: "signer" };
  }
  if (snapshot.unresolved === null || snapshot.unresolved !== 0 || production.reconciliation !== "clear") {
    return { ok: false, code: "reconciliation" };
  }
  if (snapshot.childLaunchesOpen) return { ok: false, code: "child_launches" };
  if (snapshot.trestSuspended !== true || snapshot.trestRehearsalOpen !== false) return { ok: false, code: "trest" };
  if (config.rewardsActive) return { ok: true, kind: "idempotent", mint: resolved.mint };
  if (
    worker.executionAuthorised !== true
    || production.loop !== "running"
    || production.broadcasts !== "disabled"
    || production.rewards !== "inactive"
    || production.claims !== "closed"
  ) {
    return { ok: false, code: "worker_execution" };
  }
  return { ok: true, kind: "ready", mint: resolved.mint };
}

export function rewardsAreLive(input: {
  rewardsActive: boolean;
  worker: ActivationWorker | { ok: false; code: "unavailable" };
}): boolean {
  if (!input.rewardsActive || !input.worker.ok) return false;
  return workerConfirmsProductionRewards({
    runtime: input.worker.runtime,
    executionAuthorised: input.worker.executionAuthorised,
    production: input.worker.production,
  });
}

function lines(kind: string, fields: Record<string, string>): string {
  return [kind, ...Object.entries(fields).map(([key, value]) => `${key}=${value}`)].join("\n");
}

export function presentActivationResult(input: {
  mode: ActivationMode;
  review: ActivationReview;
  rewardsActive: boolean;
  writes: 0 | 1;
}): { code: number; out: string } {
  if (!input.review.ok) {
    return {
      code: 2,
      out: lines("blocked", {
        code: input.review.code,
        rewards: input.rewardsActive ? "active" : "inactive",
        rewards_live: "false",
        writes: "0",
      }),
    };
  }
  return {
    code: 0,
    out: lines(input.mode === "dry-run" ? "preflight" : "activated", {
      mint: input.review.mint,
      verification: input.review.kind,
      rewards: input.review.kind === "idempotent" || input.writes === 1 ? "active" : "inactive",
      rewards_live: "false",
      writes: String(input.writes),
    }),
  };
}

export function presentRewardsStatus(snapshot: ActivationSnapshot): { code: number; out: string } {
  const review = snapshot.database === "ok" && snapshot.config?.mint && snapshot.registration
    ? resolveProductionParent({
        registration: snapshot.registration,
        config: {
          mint: snapshot.config.mint,
          tokenProgram: snapshot.config.tokenProgram,
          decimals: snapshot.config.decimals,
          rewardsActive: snapshot.config.rewardsActive,
        },
        signerAddress: snapshot.signerAddress,
      })
    : { ok: false as const, code: "unregistered" as const };
  const aligned = review.ok;
  const worker = snapshot.worker.ok ? snapshot.worker : null;
  const live = rewardsAreLive({
    rewardsActive: snapshot.config?.rewardsActive === true,
    worker: snapshot.worker,
  });
  return {
    code: snapshot.database === "ok" && (aligned || !snapshot.config?.mint) ? 0 : 2,
    out: lines("rewards-status", {
      canonical_mint: !snapshot.config?.mint ? "unregistered" : aligned ? "registered" : "divergent",
      mint: aligned ? review.mint : "",
      parent: !snapshot.registration && !snapshot.config?.mint ? "unregistered" : aligned ? "consistent" : "divergent",
      chain: snapshot.chain.ok ? "matched" : snapshot.chain.code,
      worker: worker ? "ready" : "unavailable",
      revision: worker?.revision ?? "",
      signer: worker?.production?.signer || worker?.signer || "unverified",
      database_rewards: snapshot.database !== "ok" ? "unknown" : snapshot.config?.rewardsActive ? "active" : "inactive",
      financial: !worker ? "unknown" : worker.production?.broadcasts === "enabled" ? "enabled" : "disabled",
      rewards_live: live ? "true" : "false",
      last_window: snapshot.lastWindow ?? "",
      unresolved: snapshot.unresolved === null ? "unknown" : String(snapshot.unresolved),
      claims: worker?.production?.claims || "unknown",
      child_launches: snapshot.childLaunchesOpen ? "open" : "closed",
      trest: snapshot.trestSuspended === true && snapshot.trestRehearsalOpen === false ? "inactive" : snapshot.trestSuspended === null ? "unknown" : "active",
      database: snapshot.database,
    }),
  };
}

export function emergencyStopProcedure(): readonly { step: string; effect: string }[] {
  return [
    {
      step: "Create a new Render deploy of sdk-rewards-worker with REWARDS_LOOP_ENABLED=false, REWARDS_EXECUTION_AUTHORIZED=false, and SDK_SIGNER_SUSPENDED=true.",
      effect: "A restart keeps the previous environment snapshot, so only a new deploy stops new collections and claims.",
    },
    {
      step: "Leave submitted and uncertain production intents in place.",
      effect: "Those idempotency keys stay blocked until reconciliation. The worker must not broadcast them again.",
    },
    {
      step: "Leave reward liabilities, snapshots, and confirmed claims in place.",
      effect: "Existing holder entitlements remain on the ledger and are not deleted or reduced.",
    },
    {
      step: "Clear rewards_active only after the worker health shows broadcasts disabled.",
      effect: "The website leaves the live phase when the worker no longer confirms broadcasts, even if the database flag is still true.",
    },
  ];
}

export async function runActivation(
  argv: readonly string[],
  io: {
    snapshot: () => Promise<ActivationSnapshot>;
    commit: (mint: string) => Promise<"ok" | "idempotent" | "blocked" | "rolled_back">;
  },
): Promise<{ code: number; out: string }> {
  const command = parseActivationArgs(argv);
  if (!command.ok) {
    return presentActivationResult({
      mode: "dry-run",
      review: { ok: false, code: command.code },
      rewardsActive: false,
      writes: 0,
    });
  }
  const snapshot = await io.snapshot();
  const review = reviewActivation(snapshot, command.revision);
  const rewardsActive = snapshot.config?.rewardsActive === true;
  if (!review.ok || command.mode === "dry-run") {
    return presentActivationResult({ mode: command.mode, review, rewardsActive, writes: 0 });
  }
  const committed = await io.commit(review.mint);
  if (committed === "ok") {
    return presentActivationResult({ mode: "execute", review, rewardsActive: true, writes: 1 });
  }
  if (committed === "idempotent") {
    return presentActivationResult({
      mode: "execute",
      review: { ok: true, kind: "idempotent", mint: review.mint },
      rewardsActive: true,
      writes: 0,
    });
  }
  return presentActivationResult({
    mode: "execute",
    review: { ok: false, code: committed === "blocked" ? "mismatch" : "rolled_back" },
    rewardsActive,
    writes: 0,
  });
}
