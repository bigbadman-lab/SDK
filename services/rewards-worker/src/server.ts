// Rewards worker. Independent of the unsigned transaction builder.
// A raw TREST_DEPLOYER_PRIVATE_KEY, even as a Render secret, is unrestricted
// control of that wallet. The process derives the public key, then keeps the
// secret only when both REWARDS_LOOP_ENABLED and REWARDS_EXECUTION_AUTHORIZED
// are exactly "true". Otherwise it drops the variable and serves health only.
// Do not set SDK_DEPLOYER_PRIVATE_KEY. Do not read a key file. POST /v1/claims
// accepts an authenticated reservation and never an instruction list. It signs
// only through the claim transfer check, and only when the runtime is ready.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import { inspectDeployerSigner, rewardsExecutionEnabled, rewardsHealth, type SignerState } from "../../../lib/rewards/signer.ts";
import { settleClaimHttp, type ClaimBody } from "./claim-route.ts";

type ClaimExecutor = (claim: ClaimBody) => Promise<{ ok: boolean; code?: string; signature?: string }>;

let claimExecutor: ClaimExecutor | null = null;

function boot(): { ok: true; signer: SignerState; active: boolean } | { ok: false; code: string } {
  const secret = process.env.TREST_DEPLOYER_PRIVATE_KEY ?? null;
  const expectedAddress = process.env.TREST_DEPLOYER_ADDRESS ?? null;
  const suspended = process.env.TREST_SIGNER_SUSPENDED === "true";
  delete process.env.TREST_DEPLOYER_PRIVATE_KEY;
  const inspection = inspectDeployerSigner({ secret, expectedAddress, suspended });
  if (!inspection.ok) return inspection;
  const active = rewardsExecutionEnabled({
    loopEnabled: process.env.REWARDS_LOOP_ENABLED ?? null,
    executionAuthorised: process.env.REWARDS_EXECUTION_AUTHORIZED ?? null,
    suspended,
  }) && inspection.signer === "matched" && secret !== null && expectedAddress !== null;
  if (active && secret && expectedAddress) {
    const retained = { secret, expectedAddress, suspended };
    void import("./loop.ts").then((loaded) => loaded.startRewardsLoop(retained));
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

function listen(signer: SignerState, active: boolean): void {
  const port = Number(process.env.PORT ?? "8080");
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      if (request.method === "GET" && request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(rewardsHealth(signer, active)));
        return;
      }
      if (request.method === "POST" && request.url === "/v1/claims") {
        const settled = await settleClaimHttp({
          headerMatches: workerAuthorised(request),
          runtimeReady: active && claimExecutor !== null,
          raw: await readBody(request),
          execute: (claim) => claimExecutor?.(claim) ?? Promise.resolve({ ok: false, code: "inactive" }),
        });
        response.writeHead(settled.status, { "content-type": "application/json" });
        response.end(JSON.stringify(settled.body));
        return;
      }
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, code: "not_found" }));
    })();
  });
  server.listen(port);
}

const started = boot();
if (!started.ok) {
  console.error(`rewards-worker ${started.code}`);
  process.exit(1);
}
listen(started.signer, started.active);
