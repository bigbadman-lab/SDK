import assert from "node:assert/strict";
import test from "node:test";

import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from "../../../lib/rewards/collect.ts";
import { TOKEN_2022_PROGRAM_ID } from "../../../lib/rewards/claim.ts";
import { reconcileBuyback } from "../../../lib/rewards/reconcile.ts";
import { creatorVaultAddress } from "./chain.ts";
import { buildCurveBuyback, buildSolCollection } from "./instructions.ts";

const TREST = "GyGKxMyg1p9SsHfm15MkNUu1u9TN2JtTspcdmrtGUdse";
const DEPLOYER = "EdmxWPmx2WH6WgFfTdu9xfkYf3k1g5wD1zccTVySEEh1";
const SDK = "AKkzLhjhyFtM9j7WAhbaqYpFe49cXeJBg2kzLRC2PnNa";
const CURVE = {
  virtualTokenReserves: "1000000000",
  virtualQuoteReserves: "1000000000",
  realTokenReserves: "1000000000",
  realQuoteReserves: "0",
  tokenTotalSupply: "1000000000",
  complete: false,
  creator: DEPLOYER,
};

test("SOL creator-fee collection uses the Pump vault instruction and adds the AMM leg only after graduation vaults exist", async () => {
  const curve = await buildSolCollection({ creator: DEPLOYER, ammVaultExists: false });
  assert.equal(curve.ok, true);
  if (!curve.ok) return;
  assert.equal(curve.spendsDeployer, false);
  assert.equal(curve.recipient, DEPLOYER);
  assert.equal(curve.instructions.some((instruction) => instruction.name === "collectCreatorFeeV2"), true);
  assert.equal(curve.instructions.some((instruction) => instruction.name === "collectCoinCreatorFee"), false);
  const collect = curve.instructions.find((instruction) => instruction.name === "collectCreatorFeeV2");
  assert.equal(collect?.programId, PUMP_PROGRAM_ID);
  assert.deepEqual(collect?.data.slice(0, 8), [207, 17, 138, 242, 4, 34, 19, 56]);
  assert.equal(collect?.keys[0]?.pubkey, DEPLOYER);
  assert.equal(collect?.keys[0]?.isSigner, false);
  assert.equal(collect?.keys[4]?.pubkey, "So11111111111111111111111111111111111111112");
  assert.equal(collect?.keys[2]?.pubkey, creatorVaultAddress(DEPLOYER));
  assert.equal(collect?.keys[5]?.pubkey, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
  assert.equal(collect?.keys[9]?.pubkey, PUMP_PROGRAM_ID);
  assert.equal(collect?.keys.length, 10);
  const graduated = await buildSolCollection({ creator: DEPLOYER, ammVaultExists: true });
  assert.equal(graduated.ok, true);
  if (!graduated.ok) return;
  const amm = graduated.instructions.find((instruction) => instruction.name === "collectCoinCreatorFee");
  assert.equal(amm?.programId, PUMP_AMM_PROGRAM_ID);
  assert.deepEqual(amm?.data.slice(0, 8), [160, 57, 89, 42, 181, 139, 43, 66]);
  const close = graduated.instructions.find((instruction) => instruction.name === "closeWsol");
  assert.equal(close?.data[0], 9);
  assert.equal(close?.keys[1]?.pubkey, DEPLOYER);
  assert.equal(graduated.instructions.some((instruction) => instruction.name === "collectCreatorFeeV2"), true);
  assert.equal(graduated.instructions.some((instruction) => instruction.data.slice(0, 8).join(",") === "20,22,86,123,198,28,219,132"), false);
});

test("a curve buyback is a real Pump buy and does not credit the quoted token amount", async () => {
  const bought = await buildCurveBuyback({
    parentMint: TREST,
    deployer: DEPLOYER,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    quoteLamports: "1000000",
    minimumTokens: "250000",
    slippageBps: 100,
    graduated: false,
    pool: null,
    curve: CURVE,
  });
  assert.equal(bought.ok, true);
  if (!bought.ok) return;
  assert.equal(bought.creditedTokenAmount, null);
  assert.equal(bought.quotedTokenAmount, "250000");
  const buy = bought.instructions.find((instruction) => instruction.name === "buyExactQuoteInV3");
  assert.equal(buy?.programId, PUMP_PROGRAM_ID);
  assert.equal(buy?.keys.some((key) => key.pubkey === TREST), true);
  assert.equal(buy?.keys.some((key) => key.pubkey === DEPLOYER && key.isSigner), true);
  assert.equal(buy?.keys.some((key) => key.pubkey === SDK), false);
  const wide = await buildCurveBuyback({
    parentMint: TREST,
    deployer: DEPLOYER,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    quoteLamports: "1000000",
    minimumTokens: "250000",
    slippageBps: 100,
    graduated: false,
    pool: null,
    curve: CURVE,
  });
  const tight = await buildCurveBuyback({
    parentMint: TREST,
    deployer: DEPLOYER,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    quoteLamports: "1000000",
    minimumTokens: "250000",
    slippageBps: 500,
    graduated: false,
    pool: null,
    curve: CURVE,
  });
  assert.equal(wide.ok, true);
  assert.equal(tight.ok, true);
  if (!wide.ok || !tight.ok) return;
  const wideData = wide.instructions.at(-1)?.data.join(",");
  const tightData = tight.instructions.at(-1)?.data.join(",");
  assert.notEqual(wideData, tightData);
  const graduated = await buildCurveBuyback({
    parentMint: TREST,
    deployer: DEPLOYER,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    quoteLamports: "1000000",
    minimumTokens: "250000",
    slippageBps: 100,
    graduated: true,
    pool: {
      address: "Hq2wp8uJ9jCPsYgNHex8RtqdvMPfVGoYwjvF1ATiwn2Y",
      baseVault: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
      quoteVault: "8Wf5TiAheLUqBrKXeYg2JtAFFMWtKdG2BSFgqUcPVwTt",
      baseReserve: "1000000000",
      quoteReserve: "1000000000",
      baseSupply: "1000000000000",
      quoteMint: "So11111111111111111111111111111111111111112",
      coinCreator: DEPLOYER,
      lpFeeBps: 25,
      protocolFeeBps: 5,
      creatorFeeBps: 0,
    },
    curve: null,
  });
  assert.equal(graduated.ok, true);
  if (!graduated.ok) return;
  assert.equal(graduated.creditedTokenAmount, null);
  assert.equal(graduated.quotedTokenAmount, null);
  const poolBuy = graduated.instructions.find((instruction) => instruction.name === "buyQuoteInput");
  assert.equal(poolBuy?.programId, PUMP_AMM_PROGRAM_ID);
  assert.equal(poolBuy?.keys.some((key) => key.pubkey === TREST), true);
  const failed = reconcileBuyback({ status: "failed", quotedTokenAmount: bought.quotedTokenAmount, tokenDelta: bought.quotedTokenAmount });
  assert.equal(failed.ok, false);
  const confirmed = reconcileBuyback({ status: "confirmed", quotedTokenAmount: bought.quotedTokenAmount, tokenDelta: "100" });
  assert.equal(confirmed.ok, true);
  if (!confirmed.ok) return;
  assert.equal(confirmed.credited, "100");
});
