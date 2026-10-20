// Rewards worker. Independent of the unsigned transaction builder.
// A raw TREST_DEPLOYER_PRIVATE_KEY, even as a Render secret, is unrestricted
// control of that wallet. The process derives the public key, then keeps the
// secret only when both REWARDS_LOOP_ENABLED and REWARDS_EXECUTION_AUTHORIZED
// are exactly "true". Otherwise it drops the variable and serves health only.
// Do not set SDK_DEPLOYER_PRIVATE_KEY. Do not read a key file. There is no
// signing HTTP route.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { inspectDeployerSigner, rewardsExecutionEnabled, rewardsHealth, type SignerState } from "../../../lib/rewards/signer.ts";

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
  }
  return { ok: true, signer: inspection.signer, active };
}

function listen(signer: SignerState, active: boolean): void {
  const port = Number(process.env.PORT ?? "8080");
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(rewardsHealth(signer, active)));
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, code: "not_found" }));
  });
  server.listen(port);
}

const started = boot();
if (!started.ok) {
  console.error(`rewards-worker ${started.code}`);
  process.exit(1);
}
listen(started.signer, started.active);
