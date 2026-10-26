import { canonicalAddress } from "../auth/solana.ts";
import { PLATFORM_FEE_WALLET } from "./fees.ts";
import { TREST_MINT } from "./verified-launch.ts";
import { resolveProductionParent, type ProductionRegistration } from "../rewards/production.ts";

export const LAUNCH_ACTIVATION_APPROVAL = "SDK-PROD-03-ACTIVATE";
export const CHILD_FEE_ENABLE_APPROVAL = "SDK-PROD-03-ENABLE-CHILD-FEES";
export const LAUNCH_CLOSE_APPROVAL = "SDK-PROD-03-CLOSE-LAUNCHES";
export const CHILD_FEE_DISABLE_APPROVAL = "SDK-PROD-03-DISABLE-CHILD-FEES";
export const LAUNCH_ACTIVATION_LOCK = 814203;

const REVISION = /^[0-9a-f]{40}$/;

export type LaunchAction = "preflight" | "enable-child-fees" | "activate" | "close-launches" | "disable-child-fees";

export type LaunchActivationStep = {
  id:
    | "canonical_mint"
    | "on_chain_match"
    | "builder_revision"
    | "website_revision"
    | "worker_revision"
    | "preflight"
    | "child_fee_distributor"
    | "gate_closed"
    | "approval"
    | "atomic_write"
    | "emergency_close";
  requirement: string;
};

export type LaunchCommand =
  | { ok: true; action: LaunchAction; mode: "dry-run" | "execute"; revision: string }
  | { ok: false; code: "args" | "approval" | "revision" };

export type ServiceProbe =
  | {
      ok: true;
      revision: string;
      customQuote?: "production";
      signing?: false;
      broadcast?: false;
      launchGate?: "database";
      trestFallback?: false;
      launches?: "closed" | "active" | "unavailable";
      canonicalMint?: string | null;
    }
  | { ok: false; code: "unavailable" };

export type WorkerProbe =
  | {
      ok: true;
      revision: string;
      runtime: string;
      signer: string;
      executionAuthorised: boolean;
      production: {
        canonicalMint: string | null;
        signer: string;
        rewards: string;
        loop: string;
        broadcasts: string;
        distributor: string;
        childFees: string;
        launches: string;
        childFeeReconciliation: string;
        emergencyFence: string;
      } | null;
    }
  | { ok: false; code: "unavailable" };

export type LaunchControlSnapshot = {
  database: "ok" | "unavailable" | "schema";
  config: {
    mint: string | null;
    tokenProgram: string | null;
    decimals: number | null;
    rewardsActive: boolean;
    launchesActive: boolean;
    childFeesActive: boolean;
  } | null;
  registration: ProductionRegistration | null;
  chain: { ok: true; owner: string; decimals: number } | { ok: false; code: "unavailable" | "missing" | "not_checked" };
  signerAddress: string | null;
  builder: ServiceProbe;
  website: ServiceProbe;
  worker: WorkerProbe;
  unresolvedChildFees: number | null;
  trestSuspended: boolean | null;
  trestRehearsalOpen: boolean | null;
};

export type LaunchBlock =
  | "approval"
  | "args"
  | "builder_quote"
  | "builder_revision"
  | "builder_unavailable"
  | "chain"
  | "child_fees_inactive"
  | "child_fees_pending"
  | "database"
  | "distributor"
  | "fee"
  | "fence"
  | "mismatch"
  | "reconciliation"
  | "revision"
  | "rolled_back"
  | "schema"
  | "service_unready"
  | "signer"
  | "trest"
  | "unregistered"
  | "website_revision"
  | "website_unavailable"
  | "worker_execution"
  | "worker_revision"
  | "worker_unavailable";

export type LaunchReview =
  | { ok: true; kind: "ready" | "idempotent"; mint: string; action: LaunchAction }
  | { ok: false; code: LaunchBlock };

export function launchActivationContract(): readonly LaunchActivationStep[] {
  return [
    {
      id: "canonical_mint",
      requirement: "sdk_parent_config.mint_address is the registered canonical $SDK mint and is not the historical TREST mint.",
    },
    {
      id: "on_chain_match",
      requirement: "The on-chain mint, token program, and decimals match that registration.",
    },
    {
      id: "builder_revision",
      requirement: "The transaction builder health revision equals the approved revision and advertises production custom-quote creation.",
    },
    {
      id: "website_revision",
      requirement: "The website health revision equals the approved revision. Builder health is not evidence for the website.",
    },
    {
      id: "worker_revision",
      requirement: "The rewards worker health revision equals the approved revision. Builder health is not evidence for the worker.",
    },
    {
      id: "preflight",
      requirement: "Public build, submit, and preflight stay behind the database launch gate.",
    },
    {
      id: "child_fee_distributor",
      requirement: "Child fees are enabled with SDK-PROD-03-ENABLE-CHILD-FEES, and worker health reports child-fee execution enabled, before launches open.",
    },
    {
      id: "gate_closed",
      requirement: "launches_active stays false until that child-fee health check passes. rewards_active is not changed.",
    },
    {
      id: "approval",
      requirement: `Opening launches requires --execute and ${LAUNCH_ACTIVATION_APPROVAL}. Enabling child fees requires ${CHILD_FEE_ENABLE_APPROVAL}.`,
    },
    {
      id: "atomic_write",
      requirement: "Each command updates one flag under advisory lock 814203. A second run is idempotent. The mint and rewards_active stay unchanged.",
    },
    {
      id: "emergency_close",
      requirement: "SDK-PROD-03-CLOSE-LAUNCHES sets launches_active false. SDK-PROD-03-DISABLE-CHILD-FEES sets child_fees_active false. Submitted work stays reconcilable.",
    },
  ];
}

export function launchEmergencyCommands(): readonly { command: string; effect: string }[] {
  return [
    {
      command: "npm run sdk:activate-launches -- --close-launches --execute --approval SDK-PROD-03-CLOSE-LAUNCHES --revision <40-hex-git-sha>",
      effect: "Sets launches_active false for the canonical parent. New builds and submissions stop. An already submitted launch can still be reconciled. rewards_active is unchanged.",
    },
    {
      command: "npm run sdk:activate-launches -- --disable-child-fees --execute --approval SDK-PROD-03-DISABLE-CHILD-FEES --revision <40-hex-git-sha>",
      effect: "Sets child_fees_active false. New creator-fee payouts stop. Submitted and uncertain distributions stay recorded for signature reconciliation. Confirmed receipts stay in place. rewards_active is unchanged.",
    },
  ];
}

const APPROVAL: Record<LaunchAction, string> = {
  preflight: LAUNCH_ACTIVATION_APPROVAL,
  activate: LAUNCH_ACTIVATION_APPROVAL,
  "enable-child-fees": CHILD_FEE_ENABLE_APPROVAL,
  "close-launches": LAUNCH_CLOSE_APPROVAL,
  "disable-child-fees": CHILD_FEE_DISABLE_APPROVAL,
};

export function parseLaunchActivationArgs(argv: readonly string[]): LaunchCommand {
  let execute = false;
  let approval: string | undefined;
  let revision: string | undefined;
  let action: LaunchAction = "preflight";
  let actions = 0;
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
    if (name === "--enable-child-fees" || name === "--close-launches" || name === "--disable-child-fees") {
      if (inline !== undefined) return { ok: false, code: "args" };
      actions += 1;
      action = name === "--enable-child-fees" ? "enable-child-fees" : name === "--close-launches" ? "close-launches" : "disable-child-fees";
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
  if (actions > 1) return { ok: false, code: "args" };
  if (execute) action = action === "preflight" ? "activate" : action;
  if (!revision || !REVISION.test(revision)) return { ok: false, code: "revision" };
  const expected = APPROVAL[action];
  if (execute && approval !== expected) return { ok: false, code: "approval" };
  if (!execute && approval !== undefined && approval !== expected) return { ok: false, code: "approval" };
  return { ok: true, action, mode: execute ? "execute" : "dry-run", revision };
}

function alignedParent(snapshot: LaunchControlSnapshot):
  | { ok: true; mint: string; tokenProgram: string; decimals: number }
  | { ok: false; code: LaunchBlock } {
  if (snapshot.database === "schema") return { ok: false, code: "schema" };
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
    if (resolved.code === "unregistered") return { ok: false, code: "unregistered" };
    return { ok: false, code: "mismatch" };
  }
  if (resolved.deployer !== PLATFORM_FEE_WALLET || snapshot.signerAddress !== PLATFORM_FEE_WALLET) {
    return { ok: false, code: "signer" };
  }
  if (resolved.mint === TREST_MINT) return { ok: false, code: "mismatch" };
  return { ok: true, mint: resolved.mint, tokenProgram: resolved.tokenProgram, decimals: resolved.decimals };
}

function liveServices(snapshot: LaunchControlSnapshot, revision: string, mint: string): LaunchBlock | null {
  if (!snapshot.chain.ok || snapshot.chain.owner !== snapshot.registration?.tokenProgram || snapshot.chain.decimals !== snapshot.registration?.decimals) {
    return "chain";
  }
  if (!snapshot.builder.ok) return "builder_unavailable";
  if (snapshot.builder.revision !== revision || snapshot.builder.customQuote !== "production" || snapshot.builder.signing !== false || snapshot.builder.broadcast !== false) {
    return snapshot.builder.revision !== revision ? "builder_revision" : "builder_quote";
  }
  if (!snapshot.website.ok) return "website_unavailable";
  if (
    snapshot.website.revision !== revision
    || snapshot.website.launchGate !== "database"
    || snapshot.website.trestFallback !== false
    || (snapshot.website.canonicalMint !== null && snapshot.website.canonicalMint !== mint)
  ) {
    return "website_revision";
  }
  if (!snapshot.worker.ok) return "worker_unavailable";
  const worker = snapshot.worker;
  const production = worker.production;
  if (!production || production.distributor !== "present") return "distributor";
  if (worker.revision !== revision || !REVISION.test(worker.revision) || production.canonicalMint !== mint) return "worker_revision";
  if (worker.signer !== "matched" || production.signer !== "matched" || worker.runtime === "suspended") return "signer";
  if (production.emergencyFence === "active") return "fence";
  if (snapshot.trestSuspended !== true || snapshot.trestRehearsalOpen !== false) return "trest";
  if (snapshot.unresolvedChildFees === null || snapshot.unresolvedChildFees !== 0 || production.childFeeReconciliation !== "clear") {
    return "reconciliation";
  }
  if (worker.executionAuthorised !== true || production.loop !== "running") return "worker_execution";
  return null;
}

export function reviewLaunchActivation(snapshot: LaunchControlSnapshot, command: { action: LaunchAction; revision: string }): LaunchReview {
  const parent = alignedParent(snapshot);
  if (!parent.ok) return parent;
  if (command.action === "close-launches") {
    return snapshot.config?.launchesActive === true
      ? { ok: true, kind: "ready", mint: parent.mint, action: command.action }
      : { ok: true, kind: "idempotent", mint: parent.mint, action: command.action };
  }
  if (command.action === "disable-child-fees") {
    return snapshot.config?.childFeesActive === true
      ? { ok: true, kind: "ready", mint: parent.mint, action: command.action }
      : { ok: true, kind: "idempotent", mint: parent.mint, action: command.action };
  }
  const blocked = liveServices(snapshot, command.revision, parent.mint);
  if (blocked) return { ok: false, code: blocked };
  const worker = snapshot.worker.ok ? snapshot.worker.production : null;
  const childOperational = snapshot.config?.childFeesActive === true && worker?.childFees === "enabled";
  if (command.action === "enable-child-fees") {
    if (childOperational) return { ok: true, kind: "idempotent", mint: parent.mint, action: command.action };
    if (snapshot.config?.childFeesActive === true) return { ok: false, code: "child_fees_pending" };
    return { ok: true, kind: "ready", mint: parent.mint, action: command.action };
  }
  if (!childOperational) return { ok: false, code: "child_fees_inactive" };
  const launchesOperational = snapshot.config?.launchesActive === true
    && snapshot.website.ok
    && snapshot.website.launches === "active"
    && worker?.launches === "active";
  if (launchesOperational) return { ok: true, kind: "idempotent", mint: parent.mint, action: command.action };
  if (snapshot.config?.launchesActive === true) return { ok: false, code: "service_unready" };
  return { ok: true, kind: "ready", mint: parent.mint, action: command.action };
}

export function presentLaunchResult(input: {
  mode: "dry-run" | "execute";
  action: LaunchAction;
  review: LaunchReview;
  rewardsActive: boolean;
  childFeesActive: boolean;
  launchesActive: boolean;
  writes: 0 | 1;
}): { code: number; out: string } {
  const pending = !input.review.ok && input.review.code === "child_fees_pending";
  const unready = !input.review.ok && input.review.code === "service_unready";
  const fields = {
    action: input.action,
    rewards: input.rewardsActive ? "active" : "inactive",
    child_fees: pending ? "pending" : input.childFeesActive ? "enabled" : "disabled",
    launches: unready ? "closed" : input.launchesActive ? "active" : "closed",
    writes: String(input.writes),
  };
  if (!input.review.ok) {
    return { code: 2, out: ["blocked", `code=${input.review.code}`, ...Object.entries(fields).map(([key, value]) => `${key}=${value}`)].join("\n") };
  }
  const kind = input.mode === "dry-run" ? "preflight" : input.review.kind === "idempotent" ? "idempotent" : "activated";
  return {
    code: 0,
    out: [
      kind,
      `mint=${input.review.mint}`,
      `verification=${input.review.kind}`,
      ...Object.entries(fields).map(([key, value]) => `${key}=${value}`),
    ].join("\n"),
  };
}

export function presentLaunchStatus(snapshot: LaunchControlSnapshot, revision: string): { code: number; out: string } {
  const parent = alignedParent(snapshot);
  const review = parent.ok ? reviewLaunchActivation(snapshot, { action: "preflight", revision }) : parent;
  const worker = snapshot.worker.ok ? snapshot.worker : null;
  const production = worker?.production ?? null;
  const childConfig = snapshot.config?.childFeesActive === true;
  const childOperational = childConfig && production?.childFees === "enabled" && production.emergencyFence !== "active";
  const childState = !childConfig ? "disabled" : childOperational ? "enabled" : "unhealthy";
  const launchesConfig = snapshot.config?.launchesActive === true;
  const launchesOperational = Boolean(review.ok && review.kind === "idempotent");
  return {
    code: parent.ok && snapshot.database === "ok" ? 0 : 2,
    out: [
      "launch-status",
      `canonical=${parent.ok ? "registered" : snapshot.config?.mint ? "divergent" : "unregistered"}`,
      `rewards=${snapshot.config?.rewardsActive ? "active" : "inactive"}`,
      `child_fees=${childState}`,
      `child_fees_config=${childConfig ? "active" : "inactive"}`,
      `launches=${launchesOperational ? "active" : "closed"}`,
      `launches_config=${launchesConfig ? "active" : "inactive"}`,
      `website_revision=${snapshot.website.ok ? snapshot.website.revision : ""}`,
      `builder_revision=${snapshot.builder.ok ? snapshot.builder.revision : ""}`,
      `worker_revision=${worker?.revision ?? ""}`,
      `signer=${production?.signer || worker?.signer || "missing"}`,
      `child_fee_reconciliation=${production?.childFeeReconciliation || (snapshot.unresolvedChildFees === null ? "unknown" : snapshot.unresolvedChildFees === 0 ? "clear" : "outstanding")}`,
      `emergency_fence=${production?.emergencyFence || "unknown"}`,
      `operational=${review.ok ? "ready" : "blocked"}`,
      `database=${snapshot.database}`,
    ].join("\n"),
  };
}

export function parseBuilderHealth(body: unknown): ServiceProbe {
  if (!body || typeof body !== "object") return { ok: false, code: "unavailable" };
  const record = body as Record<string, unknown>;
  if (record.ok !== true || record.service !== "transaction-builder") return { ok: false, code: "unavailable" };
  const probe: ServiceProbe = {
    ok: true,
    revision: typeof record.revision === "string" ? record.revision : "unverified",
  };
  if (record.customQuote === "production") probe.customQuote = "production";
  if (record.signing === false) probe.signing = false;
  if (record.broadcast === false) probe.broadcast = false;
  return probe;
}

export function parseWebsiteHealth(body: unknown): ServiceProbe {
  if (!body || typeof body !== "object") return { ok: false, code: "unavailable" };
  const record = body as Record<string, unknown>;
  if (record.ok !== true || record.service !== "website") return { ok: false, code: "unavailable" };
  const launches = record.launches === "active" || record.launches === "closed" || record.launches === "unavailable" ? record.launches : "unavailable";
  const probe: ServiceProbe = {
    ok: true,
    revision: typeof record.revision === "string" ? record.revision : "unverified",
    launches,
    canonicalMint: typeof record.canonicalMint === "string" ? canonicalAddress(record.canonicalMint) : null,
  };
  if (record.launchGate === "database") probe.launchGate = "database";
  if (record.trestFallback === false) probe.trestFallback = false;
  return probe;
}

export function parseLaunchWorkerHealth(body: unknown): WorkerProbe {
  if (!body || typeof body !== "object") return { ok: false, code: "unavailable" };
  const record = body as Record<string, unknown>;
  if (record.ok !== true || record.service !== "rewards-worker") return { ok: false, code: "unavailable" };
  const production = record.production;
  const parsed = production && typeof production === "object" ? production as Record<string, unknown> : null;
  return {
    ok: true,
    revision: typeof record.revision === "string" ? record.revision : "unverified",
    runtime: typeof record.runtime === "string" ? record.runtime : "",
    signer: typeof record.signer === "string" ? record.signer : "",
    executionAuthorised: record.executionAuthorised === true,
    production: parsed
      ? {
          canonicalMint: typeof parsed.canonicalMint === "string" ? parsed.canonicalMint : null,
          signer: typeof parsed.signer === "string" ? parsed.signer : "",
          rewards: typeof parsed.rewards === "string" ? parsed.rewards : "",
          loop: typeof parsed.loop === "string" ? parsed.loop : "",
          broadcasts: typeof parsed.broadcasts === "string" ? parsed.broadcasts : "",
          distributor: typeof parsed.distributor === "string" ? parsed.distributor : "",
          childFees: typeof parsed.childFees === "string" ? parsed.childFees : "",
          launches: typeof parsed.launches === "string" ? parsed.launches : "",
          childFeeReconciliation: typeof parsed.childFeeReconciliation === "string" ? parsed.childFeeReconciliation : "",
          emergencyFence: typeof parsed.emergencyFence === "string" ? parsed.emergencyFence : "",
        }
      : null,
  };
}

export async function runLaunchActivation(
  argv: readonly string[],
  io: {
    snapshot: () => Promise<LaunchControlSnapshot>;
    commitChildFees: (mint: string) => Promise<"ok" | "idempotent" | "blocked" | "rolled_back">;
    commitLaunches: (mint: string) => Promise<"ok" | "idempotent" | "blocked" | "rolled_back">;
    closeLaunches: (mint: string) => Promise<"ok" | "idempotent" | "blocked" | "rolled_back">;
    disableChildFees: (mint: string) => Promise<"ok" | "idempotent" | "blocked" | "rolled_back">;
  },
): Promise<{ code: number; out: string }> {
  const command = parseLaunchActivationArgs(argv);
  if (!command.ok) {
    return presentLaunchResult({
      mode: "dry-run",
      action: "preflight",
      review: { ok: false, code: command.code },
      rewardsActive: false,
      childFeesActive: false,
      launchesActive: false,
      writes: 0,
    });
  }
  const snapshot = await io.snapshot();
  const review = reviewLaunchActivation(snapshot, command);
  const rewardsActive = snapshot.config?.rewardsActive === true;
  const childFeesActive = snapshot.config?.childFeesActive === true;
  const launchesActive = snapshot.config?.launchesActive === true;
  if (!review.ok || command.mode === "dry-run" || review.kind === "idempotent") {
    return presentLaunchResult({
      mode: command.mode,
      action: command.action,
      review,
      rewardsActive,
      childFeesActive: review.ok && command.action === "enable-child-fees" && review.kind === "idempotent" ? true : childFeesActive,
      launchesActive: review.ok && command.action === "activate" && review.kind === "idempotent" ? true : launchesActive,
      writes: 0,
    });
  }
  const commit = command.action === "enable-child-fees"
    ? io.commitChildFees
    : command.action === "activate"
      ? io.commitLaunches
      : command.action === "close-launches"
        ? io.closeLaunches
        : io.disableChildFees;
  const committed = await commit(review.mint);
  const again = await io.snapshot();
  const confirmed = reviewLaunchActivation(again, command);
  if (committed === "rolled_back" || committed === "blocked") {
    return presentLaunchResult({
      mode: "execute",
      action: command.action,
      review: { ok: false, code: committed === "blocked" ? "mismatch" : "rolled_back" },
      rewardsActive: again.config?.rewardsActive === true,
      childFeesActive: again.config?.childFeesActive === true,
      launchesActive: again.config?.launchesActive === true,
      writes: 0,
    });
  }
  if (command.action === "enable-child-fees" && !confirmed.ok) {
    return presentLaunchResult({
      mode: "execute",
      action: command.action,
      review: confirmed,
      rewardsActive: again.config?.rewardsActive === true,
      childFeesActive: again.config?.childFeesActive === true,
      launchesActive: again.config?.launchesActive === true,
      writes: committed === "ok" ? 1 : 0,
    });
  }
  if (command.action === "activate" && !confirmed.ok) {
    return presentLaunchResult({
      mode: "execute",
      action: command.action,
      review: confirmed.ok ? confirmed : { ok: false, code: confirmed.code === "child_fees_inactive" ? "service_unready" : confirmed.code },
      rewardsActive: again.config?.rewardsActive === true,
      childFeesActive: again.config?.childFeesActive === true,
      launchesActive: again.config?.launchesActive === true,
      writes: committed === "ok" ? 1 : 0,
    });
  }
  return presentLaunchResult({
    mode: "execute",
    action: command.action,
    review: confirmed.ok ? confirmed : review,
    rewardsActive: again.config?.rewardsActive === true,
    childFeesActive: command.action === "disable-child-fees" ? false : again.config?.childFeesActive === true,
    launchesActive: command.action === "close-launches" ? false : command.action === "activate" ? true : again.config?.launchesActive === true,
    writes: committed === "ok" ? 1 : 0,
  });
}
