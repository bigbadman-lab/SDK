// Unsigned Pump transaction builder.
// Render root directory: the repository root.
// Build: npm install --prefix services/transaction-builder && npm run typecheck --prefix services/transaction-builder
// Start: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types services/transaction-builder/src/server.ts
// Environment names: DATABASE_URL, HELIUS_RPC_URL, TX_BUILDER_SECRET, SDK_PLATFORM_FEE_WALLET.
// This process does not sign, broadcast, or read a deployer key.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Connection, PublicKey } from "@solana/web3.js";

import { PLATFORM_FEE_WALLET } from "../../../lib/launch/fees.ts";
import { handle, type HandlerPorts } from "./handle.ts";
import { createLiveProducer } from "./live.ts";
import { simulateUnsignedTransaction } from "./simulate.ts";
import { createSql, postgresStores } from "./store.ts";

const BODY_LIMIT = 16_384;

function env(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function send(response: ServerResponse, status: number, body: Record<string, unknown>): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > BODY_LIMIT) throw new Error("body");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function livePorts(databaseUrl: string, rpcUrl: string): HandlerPorts {
  const stores = postgresStores(createSql(databaseUrl));
  const connection = new Connection(rpcUrl, "confirmed");
  return {
    now: () => Date.now(),
    launches: stores.launches,
    parent: stores.parent,
    builds: stores.builds,
    nonces: stores.nonces,
    confirmParent: async (mint) => {
      const row = await stores.parent.get();
      if (!row?.mintAddress || row.mintAddress !== mint) return false;
      try {
        const account = await connection.getAccountInfo(new PublicKey(mint), "confirmed");
        return account !== null;
      } catch {
        return false;
      }
    },
    resimulate: (transaction) => simulateUnsignedTransaction(connection.rpcEndpoint, transaction),
    produce: async (input) => {
      const row = await stores.parent.get();
      return createLiveProducer(connection)({
        launch: input.launch,
        identity: input.identity,
        mint: input.mint,
        parentMint: input.identity.parentMint,
        registeredTokenProgram: row?.tokenProgram ?? null,
      });
    },
  };
}

function start(): void {
  const secret = env("TX_BUILDER_SECRET");
  const databaseUrl = env("DATABASE_URL");
  const rpcUrl = env("HELIUS_RPC_URL");
  const platform = env("SDK_PLATFORM_FEE_WALLET");
  const ready = Boolean(secret && databaseUrl && rpcUrl && platform === PLATFORM_FEE_WALLET);
  const bound = ready && secret && databaseUrl && rpcUrl ? livePorts(databaseUrl, rpcUrl) : null;
  const server = createServer((request, response) => {
    const method = request.method ?? "GET";
    const url = request.url ?? "/";
    const path = url.split("?")[0] ?? "/";
    if (method !== "GET" && url.includes("?")) {
      send(response, 400, { ok: false, code: "body" });
      return;
    }
    void (async () => {
      const body = method === "GET" ? "" : await readBody(request);
      const headers: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        headers[key] = Array.isArray(value) ? value[0] : value;
      }
      if (!bound || !secret) {
        if (method === "GET" && path === "/health") {
          send(response, 200, { ok: true, service: "transaction-builder" });
          return;
        }
        send(response, 503, { ok: false, code: "config" });
        return;
      }
      const result = await handle({ method, path, headers, body, secret }, bound);
      send(response, result.status, result.body);
    })().catch((error: unknown) => {
      const code = error instanceof Error && error.message === "body" ? "body" : "unavailable";
      send(response, code === "body" ? 400 : 503, { ok: false, code });
    });
  });
  server.requestTimeout = 10_000;
  const port = Number(process.env.PORT ?? "8080");
  server.listen(port, "0.0.0.0");
}

start();
