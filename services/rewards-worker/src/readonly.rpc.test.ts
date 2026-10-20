import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { PublicKey } from "@solana/web3.js";

import { PUMP_PROGRAM_ID } from "../../../lib/rewards/collect.ts";
import { creatorVaultAddress, heliusChain, heliusRpc } from "./chain.ts";
import { buildCurveBuyback } from "./instructions.ts";

function rpcUrl(): string {
  const fromEnv = process.env.HELIUS_RPC_URL?.trim() ?? "";
  return fromEnv;
}

async function loadRpcUrl(): Promise<string> {
  const current = rpcUrl();
  if (current) return current;
  const file = await readFile(path.resolve(import.meta.dirname, "../../../.env.local"), "utf8");
  for (const line of file.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("HELIUS_RPC_URL=")) continue;
    return trimmed.slice("HELIUS_RPC_URL=".length).replace(/^"|"$/g, "");
  }
  return "";
}

test("read-only Helius checks decode public Pump accounts and build both buyback stages", async () => {
  const url = await loadRpcUrl();
  assert.equal(url.startsWith("https://"), true);
  const rpc = (method: string, params: unknown[]) => heliusRpc(url, method, params);
  const chain = heliusChain(rpc);
  const invalid = await chain.account("not-a-public-key");
  assert.equal(invalid, null);
  const curveSignatures = await rpc("getSignaturesForAddress", [PUMP_PROGRAM_ID, { limit: 20, commitment: "confirmed" }]);
  const poolSignatures = await rpc("getSignaturesForAddress", ["pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA", { limit: 8, commitment: "confirmed" }]);
  assert.equal(Array.isArray(curveSignatures) && Array.isArray(poolSignatures), true);
  let curveMint = "";
  let poolMint = "";
  let versionSeen = false;
  const consider = async (rows: { signature?: string }[], want: "curve" | "pool") => {
    for (const row of rows) {
      if (!row.signature) continue;
      if (want === "curve" && curveMint) return;
      if (want === "pool" && poolMint) return;
      const transaction = await rpc("getTransaction", [row.signature, { encoding: "jsonParsed", commitment: "confirmed", maxSupportedTransactionVersion: 0 }]);
      if (!transaction || typeof transaction !== "object") continue;
      const record = transaction as { version?: unknown; slot?: number; meta?: { postTokenBalances?: { mint?: string }[] } };
      if (typeof record.slot === "number" && record.meta && (record.version === 0 || record.version === "legacy")) versionSeen = true;
      for (const balance of record.meta?.postTokenBalances ?? []) {
        const mint = balance.mint;
        if (!mint || mint === "So11111111111111111111111111111111111111112") continue;
        try {
          new PublicKey(mint);
        } catch {
          continue;
        }
        const market = await chain.market(mint);
        if (!market) continue;
        if (!market.graduated && want === "curve") curveMint = mint;
        if (market.graduated && want === "pool") poolMint = mint;
        if ((want === "curve" && curveMint) || (want === "pool" && poolMint)) return;
      }
    }
  };
  await consider(curveSignatures as { signature?: string }[], "curve");
  await consider(poolSignatures as { signature?: string }[], "pool");
  assert.equal(versionSeen, true);
  assert.equal(curveMint.length > 0, true);
  assert.equal(poolMint.length > 0, true);
  const curve = await chain.market(curveMint);
  const pool = await chain.market(poolMint);
  assert.equal(curve?.graduated, false);
  assert.equal(pool?.graduated, true);
  if (!curve || curve.graduated || !pool || !pool.graduated) return;
  const curveMintInfo = await chain.mint(curveMint);
  const poolMintInfo = await chain.mint(poolMint);
  assert.equal(typeof curveMintInfo?.decimals, "number");
  assert.equal(curveMintInfo?.tokenProgram === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" || curveMintInfo?.tokenProgram === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb", true);
  assert.equal(pool.pool.quoteMint, "So11111111111111111111111111111111111111112");
  const vault = creatorVaultAddress(curve.curve.creator);
  assert.ok(vault);
  const vaultAccount = await chain.account(vault);
  assert.equal(vaultAccount?.owner, "11111111111111111111111111111111");
  assert.equal(Number(vaultAccount?.lamports) > 0, true);
  const quoteVault = await chain.account(pool.pool.quoteVault);
  assert.equal(quoteVault?.owner, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  const curveBuy = await buildCurveBuyback({
    parentMint: curveMint,
    deployer: curve.curve.creator,
    tokenProgram: curveMintInfo?.tokenProgram ?? "",
    quoteLamports: "1000000",
    minimumTokens: "1",
    slippageBps: 100,
    graduated: false,
    pool: null,
    curve: curve.curve,
  });
  assert.equal(curveBuy.ok, true);
  if (!curveBuy.ok) return;
  assert.equal(curveBuy.instructions.some((instruction) => instruction.programId === PUMP_PROGRAM_ID), true);
  const poolBuy = await buildCurveBuyback({
    parentMint: poolMint,
    deployer: pool.pool.coinCreator,
    tokenProgram: poolMintInfo?.tokenProgram ?? "",
    quoteLamports: "1000000",
    minimumTokens: "1",
    slippageBps: 100,
    graduated: true,
    pool: pool.pool,
    curve: null,
  });
  assert.equal(poolBuy.ok, true);
  if (!poolBuy.ok) return;
  assert.equal(poolBuy.instructions.some((instruction) => instruction.programId === "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"), true);
  console.log(JSON.stringify({
    curveMint,
    curveCreator: curve.curve.creator,
    curveVirtualQuote: curve.curve.virtualQuoteReserves,
    vault,
    vaultLamports: vaultAccount?.lamports,
    poolMint,
    pool: pool.pool.address,
    quoteMint: pool.pool.quoteMint,
    coinCreator: pool.pool.coinCreator,
    baseReserve: pool.pool.baseReserve,
    quoteReserve: pool.pool.quoteReserve,
    lpFeeBps: pool.pool.lpFeeBps,
    protocolFeeBps: pool.pool.protocolFeeBps,
    creatorFeeBps: pool.pool.creatorFeeBps,
    tokenProgram: poolMintInfo?.tokenProgram,
  }));
});
