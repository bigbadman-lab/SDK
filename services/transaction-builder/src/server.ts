// Unsigned Pump transaction builder.
// Render root directory: the repository root. The service imports lib/launch.
// Node: 22.18 or newer. Set Render NODE_VERSION=22.21.0.
// Build: npm ci --include=dev --prefix services/transaction-builder && npm run typecheck --prefix services/transaction-builder
// Start: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --experimental-strip-types services/transaction-builder/src/server.ts
// Environment names: DATABASE_URL, HELIUS_RPC_URL, TX_BUILDER_SECRET, SDK_PLATFORM_FEE_WALLET, PORT.
// This process does not sign, broadcast, or read a deployer key.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Connection, PublicKey } from "@solana/web3.js";

import { PLATFORM_FEE_WALLET } from "../../../lib/launch/fees.ts";
import { handle, type HandlerPorts } from "./handle.ts";
import { observeQuoteParent } from "./chain.ts";
import { loadLaunchEvidence } from "./evidence.ts";
import { createLiveProducer } from "./live.ts";
import { simulateUnsignedTransaction } from "./simulate.ts";
import { createSql, postgresStores } from "./store.ts";
import { registeredTestParent } from "./test-parent.ts";

const unconfiguredStatus = {
  ok: true,
  configured: false,
  database: "unchecked",
  rpc: "unchecked",
  parent: "unregistered",
  building: false,
  signing: false,
  broadcast: false,
  transactionVersion: 1,
  addressLookupTable: "not_required",
};

async function probeRpc(rpcUrl: string): Promise<"ok" | "unavailable"> {
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: AbortSignal.timeout(4_000),
    });
    if (!response.ok) return "unavailable";
    const body = (await response.json()) as { error?: unknown };
    return body.error ? "unavailable" : "ok";
  } catch {
    return "unavailable";
  }
}

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

let activeSql: ReturnType<typeof createSql> | null = null;

function livePorts(databaseUrl: string, rpcUrl: string): HandlerPorts {
  const sql = createSql(databaseUrl);
  activeSql = sql;
  const stores = postgresStores(sql);
  const connection = new Connection(rpcUrl, "confirmed");
  return {
    now: () => Date.now(),
    launches: stores.launches,
    parent: stores.parent,
    builds: stores.builds,
    nonces: stores.nonces,
    confirmParent: async (mint) => {
      const row = await stores.parent.get();
      const test = await registeredTestParent(sql);
      const productionMint = row?.mintAddress ?? null;
      const allowed = (productionMint !== null && mint === productionMint) || (test !== null && mint === test.mint && mint !== productionMint);
      if (!allowed) return false;
      try {
        const account = await connection.getAccountInfo(new PublicKey(mint), "confirmed");
        return account !== null;
      } catch {
        return false;
      }
    },
    testParent: () => registeredTestParent(sql),
    readEvidence: async (input) => {
      try {
        const evidence = await loadLaunchEvidence(
          {
            async account(address) {
              const info = await connection.getAccountInfo(new PublicKey(address), "confirmed");
              return info ? { owner: info.owner.toBase58(), data: info.data } : null;
            },
            async transaction(signature) {
              const found = await connection.getTransaction(signature, {
                commitment: "confirmed",
                maxSupportedTransactionVersion: 1,
              });
              if (!found?.meta) {
                return {
                  status: found ? "uncertain" : "missing",
                  error: false,
                  slot: found ? String(found.slot) : null,
                  preTokenBalances: [],
                  postTokenBalances: [],
                };
              }
              const balances = (rows: typeof found.meta.preTokenBalances) =>
                (rows ?? []).map((row) => ({
                  mint: row.mint,
                  owner: row.owner ?? "",
                  amount: row.uiTokenAmount.amount,
                }));
              return {
                status: found.meta?.err ? "failed" : "confirmed",
                error: found.meta?.err !== null,
                slot: String(found.slot),
                preTokenBalances: balances(found.meta?.preTokenBalances ?? []),
                postTokenBalances: balances(found.meta?.postTokenBalances ?? []),
              };
            },
          },
          { signature: input.signature, childMint: input.childMint, launcher: "" },
        );
        return { ok: true, evidence };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
    resimulate: (transaction) => simulateUnsignedTransaction(connection.rpcEndpoint, transaction),
    connectivity: async () => {
      let database: "ok" | "unavailable" = "unavailable";
      try {
        await sql`select 1 as ok`;
        database = "ok";
      } catch {
        database = "unavailable";
      }
      return { database, rpc: await probeRpc(rpcUrl) };
    },
    observe: (mint) => observeQuoteParent(connection, mint),
    produce: async (input) => {
      const row = await stores.parent.get();
      const test = await registeredTestParent(sql);
      const program = test && input.identity.parentMint === test.mint ? test.tokenProgram : row?.tokenProgram ?? null;
      return createLiveProducer(connection)({
        launch: input.launch,
        identity: input.identity,
        mint: input.mint,
        parentMint: input.identity.parentMint,
        registeredTokenProgram: program,
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
        if (method === "GET" && path === "/status") {
          send(response, 200, unconfiguredStatus);
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
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  const port = Number(process.env.PORT ?? "8080");
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    process.stderr.write("transaction-builder port is invalid\n");
    process.exitCode = 1;
    return;
  }
  server.listen(port, "0.0.0.0");
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    server.close(() => {
      const pending = activeSql ? activeSql.end({ timeout: 5 }) : Promise.resolve();
      void pending.finally(() => process.exit(0));
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

start();
