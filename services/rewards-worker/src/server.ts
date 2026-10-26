// Production rewards worker. Independent of the unsigned transaction builder.
// This entrypoint always runs the SDK production loop. It does not inspect
// TREST credentials and it does not start the historical TREST loop.
// A raw deployer key, even as a Render secret, is unrestricted control of
// that wallet. The process derives the public key and deletes the variable.
// Financial work starts only when REWARDS_LOOP_ENABLED and
// REWARDS_EXECUTION_AUTHORIZED are exactly "true", the signer matches, and
// sdk_parent_config.rewards_active is true. A saved key, a resumed process,
// or a finished deploy does not authorise a broadcast.
// POST /v1/claims accepts an authenticated reservation and never an
// instruction list.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import { presentProductionStatus } from "../../../lib/rewards/production.ts";
import { inspectDeployerSigner, rewardsExecutionEnabled, rewardsHealth, type SignerState } from "../../../lib/rewards/signer.ts";
import { settleClaimHttp, type ClaimBody } from "./claim-route.ts";
import { requestShutdown } from "./lifecycle.ts";
import { productionStatus, replaceProductionStatus } from "./production-status.ts";

type ClaimExecutor = (claim: ClaimBody) => Promise<{ ok: boolean; code?: string; signature?: string }>;

let claimExecutor: ClaimExecutor | null = null;
let loopStop: (() => void) | null = null;

function takeSecret(name: "SDK_DEPLOYER_PRIVATE_KEY"): string | null {
  const secret = process.env[name] ?? null;
  delete process.env[name];
  return secret;
}

function boot(): { ok: true; signer: SignerState; active: boolean } | { ok: false; code: string } {
  delete process.env.TREST_DEPLOYER_PRIVATE_KEY;
  const secret = takeSecret("SDK_DEPLOYER_PRIVATE_KEY");
  const expectedAddress = process.env.SDK_DEPLOYER_ADDRESS ?? null;
  const suspended = process.env.SDK_SIGNER_SUSPENDED === "true";
  const inspection = inspectDeployerSigner({ secret, expectedAddress, suspended });
  if (!inspection.ok) return inspection;
  const active = rewardsExecutionEnabled({
    loopEnabled: process.env.REWARDS_LOOP_ENABLED ?? null,
    executionAuthorised: process.env.REWARDS_EXECUTION_AUTHORIZED ?? null,
    suspended,
  }) && inspection.signer === "matched" && secret !== null && expectedAddress !== null;
  replaceProductionStatus(presentProductionStatus({
    canonicalMint: null,
    signer: inspection.signer === "matched"
      ? "matched"
      : inspection.signer === "suspended"
        ? "suspended"
        : "missing",
    rewardsActive: false,
    loopRunning: active,
    broadcastsEnabled: false,
    lastWindow: null,
    reconciliation: "unknown",
    claimsReady: false,
  }));
  if (active && secret && expectedAddress) {
    const retained = { secret, expectedAddress, suspended, mode: "production" as const };
    const started = import("./production-loop.ts").then((loaded) => loaded.startProductionLoop(retained));
    void started.then((control) => {
      loopStop = control.stop;
    });
    void import("./claim-execute.ts").then((loaded) => {
      claimExecutor = (claim) => loaded.executeClaim(retained, claim);
    });
  }
  return { ok: true, signer: inspection.signer, active };
}

function workerAuthorised(request: IncomingMessage): boolean {
  const configured = process.env.REWARDS_WORKER_SECRET ?? "";
  const header = request.headers["x-sdk-worker-auth"];
  if (!configured || typeof header !== "string") return false;
  const left = Buffer.from(configured);
  const right = Buffer.from(header);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function workerRevision(): string {
  const revision = process.env.RENDER_GIT_COMMIT?.trim() ?? "";
  return /^[0-9a-f]{40}$/.test(revision) ? revision : "unverified";
}

function listen(signer: SignerState, active: boolean): void {
  const port = Number(process.env.PORT ?? "8080");
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      if (request.method === "GET" && request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json", "cache-control": "private, no-store" });
        response.end(JSON.stringify({ ...rewardsHealth(signer, active), revision: workerRevision(), production: productionStatus() }));
        return;
      }
      if (request.method === "POST" && request.url === "/v1/claims") {
        const settled = await settleClaimHttp({
          headerMatches: workerAuthorised(request),
          runtimeReady: active && claimExecutor !== null,
          productionReady: active && claimExecutor !== null,
          raw: await readBody(request),
          execute: (claim) => claimExecutor?.(claim) ?? Promise.resolve({ ok: false, code: "inactive" }),
        });
        response.writeHead(settled.status, { "content-type": "application/json", "cache-control": "private, no-store" });
        response.end(JSON.stringify(settled.body));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, code: "not_found" }));
    })();
  });
  server.listen(port);
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    requestShutdown();
    loopStop?.();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2_000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

const started = boot();
if (!started.ok) {
  console.error(`rewards-worker ${started.code}`);
  process.exit(1);
}
listen(started.signer, started.active);
