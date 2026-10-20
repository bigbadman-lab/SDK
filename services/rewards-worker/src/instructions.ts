import { createRequire } from "node:module";
import { PublicKey, type AccountInfo, type TransactionInstruction } from "@solana/web3.js";

import { PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from "../../../lib/rewards/collect.ts";
import { associatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "../../../lib/rewards/claim.ts";

const require = createRequire(import.meta.url);
const amm = require("@pump-fun/pump-swap-sdk") as {
  PUMP_AMM_SDK: {
    buyQuoteInput(state: Record<string, unknown>, quote: object, slippage: number): Promise<TransactionInstruction[]>;
  };
};
const { NATIVE_MINT, TOKEN_PROGRAM_ID: SPL_TOKEN_PROGRAM } = require("@solana/spl-token") as {
  NATIVE_MINT: PublicKey;
  TOKEN_PROGRAM_ID: PublicKey;
};
const pump = require("@pump-fun/pump-sdk") as {
  OnlinePumpSdk: new (connection: {
    getMultipleAccountsInfo(keys: PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]>;
  }) => {
    collectCoinCreatorFeeV2Instructions(
      creator: PublicKey,
      quoteMint: PublicKey,
      quoteTokenProgram: PublicKey,
    ): Promise<TransactionInstruction[]>;
  };
  PumpSdk: new () => {
    buyExactQuoteInV3Instructions(input: Record<string, unknown>): Promise<TransactionInstruction[]>;
  };
  PUMP_FEE_PROGRAM_ID: PublicKey;
};
const BN = require("bn.js") as new (value: string | number) => { toString(): string };

const COLLECT_DISCRIMINATOR = Buffer.from([20, 22, 86, 123, 198, 28, 219, 132]);
const COLLECT_V2_DISCRIMINATOR = Buffer.from([207, 17, 138, 242, 4, 34, 19, 56]);
const AMM_DISCRIMINATOR = Buffer.from([160, 57, 89, 42, 181, 139, 43, 66]);
const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
const BUYBACK_FEE_RECIPIENT = "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD";

const ALLOWED_PROGRAMS = new Set([
  PUMP_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
]);

export type BuiltInstruction = {
  programId: string;
  name: "collectCreatorFeeV2" | "collectCoinCreatorFee" | "closeWsol" | "buyExactQuoteInV3" | "buyQuoteInput" | "account";
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: number[];
};

function describe(instruction: TransactionInstruction, name: BuiltInstruction["name"]): BuiltInstruction {
  return {
    programId: instruction.programId.toBase58(),
    name,
    keys: instruction.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: [...instruction.data],
  };
}

function allowed(instructions: BuiltInstruction[]): boolean {
  return instructions.every((instruction) => ALLOWED_PROGRAMS.has(instruction.programId) || instruction.programId === pump.PUMP_FEE_PROGRAM_ID.toBase58());
}

function collectionName(
  instruction: TransactionInstruction,
  ammVaultExists: boolean,
): BuiltInstruction["name"] | "legacy" | null {
  const data = Buffer.from(instruction.data);
  const program = instruction.programId.toBase58();
  if (program === PUMP_PROGRAM_ID && data.subarray(0, 8).equals(COLLECT_DISCRIMINATOR)) return "legacy";
  if (program === PUMP_PROGRAM_ID && data.subarray(0, 8).equals(COLLECT_V2_DISCRIMINATOR)) return "collectCreatorFeeV2";
  if (!ammVaultExists) return null;
  if (program === PUMP_AMM_PROGRAM_ID && data.subarray(0, 8).equals(AMM_DISCRIMINATOR)) return "collectCoinCreatorFee";
  if ((program === TOKEN_PROGRAM_ID || program === TOKEN_2022_PROGRAM_ID) && data[0] === 9) return "closeWsol";
  if (ALLOWED_PROGRAMS.has(program) || program === pump.PUMP_FEE_PROGRAM_ID.toBase58()) return "account";
  return null;
}

export async function buildSolCollection(input: {
  creator: string;
  ammVaultExists: boolean;
}): Promise<
  { ok: true; instructions: BuiltInstruction[]; recipient: string; spendsDeployer: false } | { ok: false; code: "parent" | "program" }
> {
  let creator: PublicKey;
  try {
    creator = new PublicKey(input.creator);
  } catch {
    return { ok: false, code: "parent" };
  }
  const connection = {
    async getMultipleAccountsInfo(keys: PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]> {
      return keys.map((key, index) => {
        void key;
        if (!input.ammVaultExists || index !== 0) return null;
        return {
          owner: new PublicKey(TOKEN_PROGRAM_ID),
          lamports: 1,
          data: Buffer.alloc(165),
          executable: false,
          rentEpoch: 0,
        };
      });
    },
  };
  const instructions = await new pump.OnlinePumpSdk(connection).collectCoinCreatorFeeV2Instructions(
    creator,
    NATIVE_MINT,
    SPL_TOKEN_PROGRAM,
  );
  const named = instructions.map((instruction) => ({ instruction, name: collectionName(instruction, input.ammVaultExists) }));
  if (named.some((entry) => entry.name === "legacy" || entry.name === null)) return { ok: false, code: "program" };
  const described = named.flatMap((entry) => (entry.name && entry.name !== "legacy" ? [describe(entry.instruction, entry.name)] : []));
  const pumpInstruction = described.find((instruction) => instruction.name === "collectCreatorFeeV2");
  const creatorKey = pumpInstruction?.keys[0];
  const quoteMint = pumpInstruction?.keys[4];
  if (!pumpInstruction || !creatorKey || creatorKey.pubkey !== creator.toBase58() || creatorKey.isSigner || !creatorKey.isWritable) {
    return { ok: false, code: "program" };
  }
  if (quoteMint?.pubkey !== NATIVE_MINT.toBase58()) return { ok: false, code: "program" };
  if (!input.ammVaultExists && described.some((instruction) => instruction.name !== "collectCreatorFeeV2")) {
    return { ok: false, code: "program" };
  }
  if (input.ammVaultExists && !described.some((instruction) => instruction.name === "collectCoinCreatorFee")) {
    return { ok: false, code: "program" };
  }
  if (input.ammVaultExists && !described.some((instruction) => instruction.name === "closeWsol")) {
    return { ok: false, code: "program" };
  }
  const close = described.find((instruction) => instruction.name === "closeWsol");
  if (close && close.keys[1]?.pubkey !== creator.toBase58()) return { ok: false, code: "program" };
  if (!allowed(described)) return { ok: false, code: "program" };
  return { ok: true, instructions: described, recipient: creator.toBase58(), spendsDeployer: false };
}

export type PoolMarket = {
  address: string;
  baseVault: string;
  quoteVault: string;
  baseReserve: string;
  quoteReserve: string;
  baseSupply: string;
  quoteMint: string;
  coinCreator: string;
  lpFeeBps: number;
  protocolFeeBps: number;
  creatorFeeBps: number;
};

function feeBps(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 10_000;
}

export type CurveMarket = {
  virtualTokenReserves: string;
  virtualQuoteReserves: string;
  realTokenReserves: string;
  realQuoteReserves: string;
  tokenTotalSupply: string;
  complete: boolean;
  creator: string;
};

export async function buildCurveBuyback(input: {
  parentMint: string;
  deployer: string;
  tokenProgram: string;
  quoteLamports: string;
  minimumTokens: string;
  slippageBps: number;
  graduated: boolean;
  pool: PoolMarket | null;
  curve: CurveMarket | null;
}): Promise<
  | { ok: true; instructions: BuiltInstruction[]; quotedTokenAmount: string | null; creditedTokenAmount: null }
  | { ok: false; code: "amount" | "graduated_market" | "parent" | "program" | "slippage" }
> {
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 1 || input.slippageBps > 1000) {
    return { ok: false, code: "slippage" };
  }
  if (!/^[1-9][0-9]{0,18}$/.test(input.quoteLamports) || !/^[1-9][0-9]{0,18}$/.test(input.minimumTokens)) {
    return { ok: false, code: "amount" };
  }
  if (input.graduated) return buildPoolBuyback(input);
  if (!input.curve || input.curve.complete) return { ok: false, code: "graduated_market" };
  const reserves = [input.curve.virtualTokenReserves, input.curve.virtualQuoteReserves, input.curve.realTokenReserves, input.curve.realQuoteReserves, input.curve.tokenTotalSupply];
  if (reserves.some((value) => !/^[1-9][0-9]{0,18}$/.test(value) && value !== "0")) return { ok: false, code: "amount" };
  let mint: PublicKey;
  let deployer: PublicKey;
  let tokenProgram: PublicKey;
  try {
    mint = new PublicKey(input.parentMint);
    deployer = new PublicKey(input.deployer);
    tokenProgram = new PublicKey(input.tokenProgram);
  } catch {
    return { ok: false, code: "parent" };
  }
  const zero = new BN(0);
  const curve = {
    virtualTokenReserves: new BN(input.curve.virtualTokenReserves),
    virtualQuoteReserves: new BN(input.curve.virtualQuoteReserves),
    realTokenReserves: new BN(input.curve.realTokenReserves),
    realQuoteReserves: new BN(input.curve.realQuoteReserves),
    tokenTotalSupply: new BN(input.curve.tokenTotalSupply),
    complete: false,
    creator: new PublicKey(input.curve.creator),
    isMayhemMode: false,
    isCashbackCoin: false,
    quoteMint: PublicKey.default,
    creatorFeeBps: zero,
    canEditCreatorFee: false,
    isHolderReward: false,
    creatorFee: zero,
    protocolFees: zero,
    depth: 0,
    initialVirtualQuoteReserves: new BN(input.curve.virtualQuoteReserves),
    postCompleteBaseOut: zero,
    postCompleteQuoteIn: zero,
  };
  const built = await new pump.PumpSdk().buyExactQuoteInV3Instructions({
    bondingCurve: curve,
    associatedUserAccountInfo: null,
    mint,
    user: deployer,
    amount: new BN(input.minimumTokens),
    quoteAmount: new BN(input.quoteLamports),
    slippage: input.slippageBps / 100,
    tokenProgram,
    quoteTokenProgram: new PublicKey(TOKEN_PROGRAM_ID),
  });
  const described = built.map((instruction, index) =>
    describe(instruction, index === built.length - 1 ? "buyExactQuoteInV3" : "account"),
  );
  const buy = described.find((instruction) => instruction.name === "buyExactQuoteInV3");
  if (!buy || buy.programId !== PUMP_PROGRAM_ID) return { ok: false, code: "program" };
  if (!buy.keys.some((key) => key.pubkey === mint.toBase58())) return { ok: false, code: "parent" };
  if (!buy.keys.some((key) => key.pubkey === deployer.toBase58() && key.isSigner)) return { ok: false, code: "parent" };
  if (!allowed(described)) return { ok: false, code: "program" };
  return {
    ok: true,
    instructions: described,
    quotedTokenAmount: input.minimumTokens,
    creditedTokenAmount: null,
  };
}

async function buildPoolBuyback(input: {
  parentMint: string;
  deployer: string;
  tokenProgram: string;
  quoteLamports: string;
  slippageBps: number;
  pool: PoolMarket | null;
}): Promise<
  | { ok: true; instructions: BuiltInstruction[]; quotedTokenAmount: null; creditedTokenAmount: null }
  | { ok: false; code: "amount" | "graduated_market" | "parent" | "program" | "slippage" }
> {
  const pool = input.pool;
  if (!pool || !feeBps(pool.lpFeeBps) || !feeBps(pool.protocolFeeBps) || !feeBps(pool.creatorFeeBps)) {
    return { ok: false, code: "graduated_market" };
  }
  if (pool.quoteMint !== NATIVE_MINT.toBase58() || pool.coinCreator !== input.deployer) {
    return { ok: false, code: "parent" };
  }
  if (!/^[1-9][0-9]{0,18}$/.test(pool.baseReserve) || !/^[1-9][0-9]{0,18}$/.test(pool.quoteReserve) || !/^[1-9][0-9]{0,18}$/.test(pool.baseSupply)) {
    return { ok: false, code: "amount" };
  }
  let mint: PublicKey;
  let deployer: PublicKey;
  let poolKey: PublicKey;
  let baseVault: PublicKey;
  let quoteVault: PublicKey;
  try {
    mint = new PublicKey(input.parentMint);
    deployer = new PublicKey(input.deployer);
    poolKey = new PublicKey(pool.address);
    baseVault = new PublicKey(pool.baseVault);
    quoteVault = new PublicKey(pool.quoteVault);
  } catch {
    return { ok: false, code: "parent" };
  }
  const baseAccount = associatedTokenAddress(input.deployer, input.parentMint, input.tokenProgram);
  const quoteAccount = associatedTokenAddress(input.deployer, NATIVE_MINT.toBase58(), TOKEN_PROGRAM_ID);
  if (!baseAccount || !quoteAccount) return { ok: false, code: "parent" };
  const zero = new BN(0);
  const empty = {
    owner: SPL_TOKEN_PROGRAM,
    lamports: 1,
    data: Buffer.alloc(165),
    executable: false,
    rentEpoch: 0,
  };
  try {
    const built = await amm.PUMP_AMM_SDK.buyQuoteInput(
      {
        globalConfig: {
          protocolFeeRecipients: [new PublicKey(BUYBACK_FEE_RECIPIENT)],
          buybackFeeRecipients: [new PublicKey(BUYBACK_FEE_RECIPIENT)],
          lpFeeBasisPoints: new BN(pool.lpFeeBps),
          protocolFeeBasisPoints: new BN(pool.protocolFeeBps),
          coinCreatorFeeBasisPoints: new BN(pool.creatorFeeBps),
          creatorFeeConfigurable: false,
        },
        feeConfig: null,
        poolKey,
        pool: {
          baseMint: mint,
          quoteMint: NATIVE_MINT,
          poolBaseTokenAccount: baseVault,
          poolQuoteTokenAccount: quoteVault,
          coinCreator: new PublicKey(pool.coinCreator),
          creator: new PublicKey(pool.coinCreator),
          isMayhemMode: false,
          creatorFeeBps: zero,
          virtualQuoteReserves: zero,
        },
        poolBaseAmount: new BN(pool.baseReserve),
        poolQuoteAmount: new BN(pool.quoteReserve),
        baseMint: mint,
        baseMintAccount: { supply: new BN(pool.baseSupply) },
        baseTokenProgram: new PublicKey(input.tokenProgram),
        quoteTokenProgram: SPL_TOKEN_PROGRAM,
        user: deployer,
        userBaseTokenAccount: new PublicKey(baseAccount),
        userQuoteTokenAccount: new PublicKey(quoteAccount),
        userBaseAccountInfo: null,
        userQuoteAccountInfo: null,
        poolAccountInfo: { ...empty, data: Buffer.alloc(300), owner: new PublicKey(PUMP_AMM_PROGRAM_ID) },
      },
      new BN(input.quoteLamports),
      input.slippageBps / 100,
    );
    const described = built.map((instruction) =>
      describe(instruction, instruction.programId.toBase58() === PUMP_AMM_PROGRAM_ID ? "buyQuoteInput" : "account"),
    );
    const buy = described.find((instruction) => instruction.programId === PUMP_AMM_PROGRAM_ID);
    if (!buy || !buy.keys.some((key) => key.pubkey === mint.toBase58()) || !buy.keys.some((key) => key.pubkey === poolKey.toBase58())) {
      return { ok: false, code: "program" };
    }
    if (!allowed(described)) return { ok: false, code: "program" };
    return { ok: true, instructions: described, quotedTokenAmount: null, creditedTokenAmount: null };
  } catch {
    return { ok: false, code: "program" };
  }
}
