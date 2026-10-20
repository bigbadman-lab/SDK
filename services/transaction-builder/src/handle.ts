import { PublicKey } from "@solana/web3.js";

import { bindingDecision, payloadHash, type BuildIdentity } from "../../../lib/launch/build-binding.ts";
import { PLATFORM_FEE_WALLET, allocateCreatorFees } from "../../../lib/launch/fees.ts";
import { feeCategory } from "../../../lib/launch/prepare.ts";
import { parseUnsignedBuildRequest } from "../../../lib/launch/builder-request.ts";
import { verifyServiceRequest } from "../../../lib/launch/service-auth.ts";
import { slippagePercent } from "../../../lib/launch/slippage.ts";
import type { BuildRow, BuildStore, LaunchRecord, LaunchStore, NonceStore, ParentStore } from "./domain.ts";

export const ROUTES = [
  "GET /health",
  "GET /status",
  "POST /v1/diagnose",
  "POST /v1/build",
  "POST /v1/inspect",
] as const;

const BUILD_TTL_MS = 60_000;

export type Produced = {
  transaction: string;
  transactionVersion: 1;
  encoding: "base64";
  messageHash: string;
  byteLength: number;
  accountCount: number;
  fitsPacket: boolean;
  roles: string[];
  signers: string[];
  blockhash: string;
  coverage: "live" | "fixture";
  simulationOk: boolean;
  parentMint: string;
};

export type HandlerPorts = {
  now: () => number;
  launches: LaunchStore;
  parent: ParentStore;
  builds: BuildStore;
  nonces: NonceStore;
  produce: (input: {
    launch: LaunchRecord;
    identity: BuildIdentity;
    mint: PublicKey;
  }) => Promise<{ ok: true; produced: Produced } | { ok: false; code: string }>;
  confirmParent: (mint: string) => Promise<boolean>;
  resimulate: (transaction: string) => Promise<boolean>;
  connectivity?: () => Promise<{ database: "ok" | "unavailable"; rpc: "ok" | "unavailable" }>;
};

export type HandlerResult = { status: number; body: Record<string, unknown> };

function header(headers: Record<string, string | undefined>, name: string): string {
  return headers[name] ?? headers[name.toLowerCase()] ?? "";
}

function failure(status: number, code: string): HandlerResult {
  return { status, body: { ok: false, code } };
}

async function identityFor(
  launch: LaunchRecord,
  mintPublicKey: string,
  parentMint: string,
): Promise<{ ok: true; identity: BuildIdentity } | { ok: false; code: string }> {
  const category = feeCategory({
    sourceOrigin: launch.origin,
    launcherAccountId: launch.accountId,
    originatorAccountId: launch.originatorAccountId,
  });
  if (category !== launch.feeCategory) return { ok: false, code: "lineage" };
  const fees = allocateCreatorFees({
    category,
    launcherWallet: launch.walletAddress,
    originatorWallet: launch.originatorWallet,
    platformWallet: PLATFORM_FEE_WALLET,
  });
  if (!fees.ok) return { ok: false, code: fees.code };
  if (!launch.metadataHash || !launch.metadataUri) return { ok: false, code: "not_ready" };
  const identity: BuildIdentity = {
    launchId: launch.launchId,
    idempotencyKey: launch.idempotencyKey,
    mintPublicKey,
    launcherWallet: launch.walletAddress,
    category,
    originatorWallet: launch.originatorWallet,
    metadataUri: launch.metadataUri,
    metadataHash: launch.metadataHash,
    contentHash: launch.contentHash,
    sourceKind: launch.sourceKind,
    sourceId: launch.sourceId,
    versionId: launch.versionId,
    buyAmount: launch.buyAmount,
    slippageBps: launch.slippageBps,
    parentMint,
    shareholders: fees.shareholders,
  };
  return { ok: true, identity };
}

async function serviceStatus(ports: HandlerPorts): Promise<HandlerResult> {
  let database: "ok" | "unavailable" | "unchecked" = "unchecked";
  let rpc: "ok" | "unavailable" | "unchecked" = "unchecked";
  if (ports.connectivity) {
    try {
      const link = await ports.connectivity();
      database = link.database;
      rpc = link.rpc;
    } catch {
      database = "unavailable";
      rpc = "unavailable";
    }
  }
  let parent: "registered" | "unregistered" = "unregistered";
  try {
    const row = await ports.parent.get();
    if (!ports.connectivity) database = "ok";
    parent = row?.mintAddress ? "registered" : "unregistered";
  } catch {
    database = "unavailable";
    parent = "unregistered";
  }
  return {
    status: 200,
    body: {
      ok: true,
      configured: true,
      database,
      rpc,
      parent,
      building: database === "ok" && rpc === "ok" && parent === "registered",
      signing: false,
      broadcast: false,
      transactionVersion: 1,
      addressLookupTable: "not_required",
    },
  };
}

function ready(launch: LaunchRecord): boolean {
  return launch.status === "ready_for_transaction" && Boolean(launch.metadataHash) && Boolean(launch.metadataUri);
}

export async function handle(
  request: {
    method: string;
    path: string;
    headers: Record<string, string | undefined>;
    body: string;
    secret: string;
  },
  ports: HandlerPorts,
): Promise<HandlerResult> {
  if (request.method === "GET" && request.path === "/health") {
    return { status: 200, body: { ok: true, service: "transaction-builder" } };
  }
  if (request.method === "GET" && request.path === "/status") {
    return serviceStatus(ports);
  }
  if (request.method !== "POST" || (request.path !== "/v1/build" && request.path !== "/v1/inspect" && request.path !== "/v1/diagnose")) {
    return failure(404, "not_found");
  }
  const auth = verifyServiceRequest({
    secret: request.secret,
    timestamp: header(request.headers, "x-sdk-timestamp"),
    nonce: header(request.headers, "x-sdk-nonce"),
    method: request.method,
    path: request.path,
    body: request.body,
    signature: header(request.headers, "x-sdk-signature"),
    nowSeconds: Math.floor(ports.now() / 1000),
  });
  if (!auth.ok) return failure(401, auth.code);
  const nonce = await ports.nonces.use(header(request.headers, "x-sdk-nonce"), ports.now());
  if (nonce === "replay") return failure(401, "replay");
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(request.body) as unknown;
  } catch {
    return failure(400, "body");
  }
  if (request.path === "/v1/diagnose") {
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return failure(400, "body");
    }
    if (Object.keys(parsedBody as Record<string, unknown>).length !== 0) return failure(400, "body");
    return serviceStatus(ports);
  }
  const parsed = parseUnsignedBuildRequest(parsedBody);
  if (!parsed.ok) return failure(400, "body");
  const launch = await ports.launches.get(parsed.value.launchId);
  if (!launch || launch.idempotencyKey !== parsed.value.idempotencyKey) return failure(404, "not_found");
  if (!ready(launch)) return failure(409, "not_ready");
  let mint: PublicKey;
  try {
    mint = new PublicKey(parsed.value.mintPublicKey);
  } catch {
    return failure(400, "body");
  }
  if (mint.toBase58() === launch.walletAddress) return failure(400, "mint");
  const parent = await ports.parent.get();
  const parentMint = parent?.mintAddress ?? null;
  if (!parentMint) return failure(503, "parent_unregistered");
  if (mint.toBase58() === parentMint) return failure(400, "mint");
  const identified = await identityFor(launch, mint.toBase58(), parentMint);
  if (!identified.ok) return failure(422, identified.code);
  if (launch.buyAmount === "0") {
    if (launch.slippageBps !== null) return failure(422, "slippage");
  } else if (!slippagePercent(launch.slippageBps ?? 0).ok) {
    return failure(422, "slippage");
  }
  const hash = payloadHash(identified.identity);
  if (request.path === "/v1/inspect") {
    return {
      status: 200,
      body: {
        ok: true,
        authorized: false,
        transaction: null,
        parent: "registered",
        shareholders: identified.identity.shareholders,
        payloadHash: hash,
      },
    };
  }
  const now = ports.now();
  const existing = await ports.builds.find(launch.accountId, launch.idempotencyKey);
  const otherOpen = await ports.builds.openLaunchIds(launch.walletAddress, launch.idempotencyKey, now);
  const decision = bindingDecision({
    now,
    launchId: launch.launchId,
    idempotencyKey: launch.idempotencyKey,
    payloadHash: hash,
    existing,
    otherOpenLaunchIds: otherOpen,
  });
  if (decision === "conflict") return failure(409, "conflict");
  if (decision === "reuse" && existing) {
    const stillEligible = await ports.confirmParent(existing.parentMint);
    if (!stillEligible || existing.parentMint !== parentMint) return failure(503, "parent_ineligible");
    const simulated = await ports.resimulate(existing.transaction);
    if (!simulated) return failure(422, "simulation_failed");
    return {
      status: 200,
      body: accepted(existing, identified.identity.shareholders, true),
    };
  }
  const produced = await ports.produce({ launch, identity: identified.identity, mint });
  if (!produced.ok) return failure(produced.code === "parent_ineligible" ? 503 : 422, produced.code);
  if (produced.produced.coverage !== "live") return failure(422, "coverage");
  if (produced.produced.transactionVersion !== 1 || produced.produced.encoding !== "base64") {
    return failure(422, "version");
  }
  if (produced.produced.signers.length !== 2) return failure(422, "signer");
  if (!produced.produced.fitsPacket) return failure(422, "transaction_too_large");
  if (!produced.produced.simulationOk) return failure(422, "simulation_failed");
  if (produced.produced.parentMint !== parentMint) return failure(503, "parent_ineligible");
  const row: BuildRow = {
    accountId: launch.accountId,
    walletAddress: launch.walletAddress,
    launchId: launch.launchId,
    idempotencyKey: launch.idempotencyKey,
    payloadHash: hash,
    messageHash: produced.produced.messageHash,
    transaction: produced.produced.transaction,
    expiresAt: now + BUILD_TTL_MS,
    parentMint,
    mintAddress: mint.toBase58(),
    blockhash: produced.produced.blockhash,
    contentHash: launch.contentHash,
    metadataHash: launch.metadataHash ?? "",
    metadataUri: launch.metadataUri ?? "",
    buyAmount: launch.buyAmount,
    shareholdersJson: JSON.stringify(identified.identity.shareholders),
  };
  const saved = decision === "rebuild" ? await ports.builds.replace(row) : await ports.builds.insert(row);
  if (saved === "conflict") return failure(409, "conflict");
  return {
    status: 200,
    body: {
      ...accepted(row, identified.identity.shareholders, false),
      byteLength: produced.produced.byteLength,
      roles: produced.produced.roles,
      sigVerify: false,
    },
  };
}

function accepted(
  row: Pick<BuildRow, "transaction" | "messageHash" | "expiresAt">,
  shareholders: BuildIdentity["shareholders"],
  reused: boolean,
): Record<string, unknown> {
  return {
    ok: true,
    authorized: false,
    sigVerify: false,
    coverage: "live",
    transactionVersion: 1,
    encoding: "base64",
    reused,
    messageHash: row.messageHash,
    transaction: row.transaction,
    expiresAt: new Date(row.expiresAt).toISOString(),
    shareholders,
  };
}
