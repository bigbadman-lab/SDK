import { createRequire } from "node:module";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";

type SdkClient = {
  createV2Instruction(input: Record<string, unknown>): Promise<TransactionInstruction>;
  createFeeSharingConfig(input: Record<string, unknown>): Promise<TransactionInstruction>;
  updateFeeSharesV2(input: Record<string, unknown>): Promise<TransactionInstruction>;
  buyExactQuoteInV3Instructions(input: Record<string, unknown>): Promise<TransactionInstruction[]>;
};

const require = createRequire(import.meta.url);
const pump = require("@pump-fun/pump-sdk") as {
  PUMP_PROGRAM_ID: PublicKey;
  PUMP_FEE_PROGRAM_ID: PublicKey;
  PUMP_AMM_PROGRAM_ID: PublicKey;
  MAYHEM_PROGRAM_ID: PublicKey;
  QUOTE_CONTROL_PDA: PublicKey;
  GLOBAL_PDA: PublicKey;
  FEE_PROGRAM_GLOBAL_PDA: PublicKey;
  PUMP_FEE_CONFIG_PDA: PublicKey;
  PUMP_EVENT_AUTHORITY_PDA: PublicKey;
  PUMP_FEE_EVENT_AUTHORITY_PDA: PublicKey;
  PUMP_AMM_EVENT_AUTHORITY_PDA: PublicKey;
  AMM_GLOBAL_PDA: PublicKey;
  GLOBAL_VOLUME_ACCUMULATOR_PDA: PublicKey;
  AMM_GLOBAL_VOLUME_ACCUMULATOR_PDA: PublicKey;
  getGlobalParamsPda: () => PublicKey;
  getSolVaultPda: () => PublicKey;
  feeSharingConfigPda: (mint: PublicKey) => PublicKey;
  creatorVaultPda: (creator: PublicKey) => PublicKey;
  PumpSdk: new () => SdkClient;
  MAX_CURVE_DEPTH: number;
};

const swap = require("@pump-fun/pump-swap-sdk") as {
  coinCreatorVaultAuthorityPda: (creator: PublicKey) => PublicKey;
};

export const EXPECTED_PROGRAMS = {
  pump: "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
  fee: "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ",
  amm: "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
  quoteControl: "6z6GDdfb2AjR9ZhJmAUQ5cipJCVxQvLJhB2H8mCwTFBP",
} as const;

function assertAddress(actual: PublicKey, expected: string, label: string): void {
  if (actual.toBase58() !== expected) {
    throw new Error(`Pump SDK ${label} does not match the pinned program`);
  }
}

assertAddress(pump.PUMP_PROGRAM_ID, EXPECTED_PROGRAMS.pump, "pump program");
assertAddress(pump.PUMP_FEE_PROGRAM_ID, EXPECTED_PROGRAMS.fee, "fee program");
assertAddress(pump.PUMP_AMM_PROGRAM_ID, EXPECTED_PROGRAMS.amm, "amm program");
assertAddress(pump.QUOTE_CONTROL_PDA, EXPECTED_PROGRAMS.quoteControl, "quote control");

if (pump.MAX_CURVE_DEPTH !== 5) {
  throw new Error("Pump SDK max curve depth is not 5");
}

export const BUYBACK_FEE_RECIPIENT = "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD";

export function knownStaticAddresses(platformWallet: string): string[] {
  return [
    pump.PUMP_PROGRAM_ID,
    pump.PUMP_FEE_PROGRAM_ID,
    pump.PUMP_AMM_PROGRAM_ID,
    pump.MAYHEM_PROGRAM_ID,
    pump.QUOTE_CONTROL_PDA,
    pump.GLOBAL_PDA,
    pump.FEE_PROGRAM_GLOBAL_PDA,
    pump.PUMP_FEE_CONFIG_PDA,
    pump.PUMP_EVENT_AUTHORITY_PDA,
    pump.PUMP_FEE_EVENT_AUTHORITY_PDA,
    pump.PUMP_AMM_EVENT_AUTHORITY_PDA,
    pump.AMM_GLOBAL_PDA,
    pump.GLOBAL_VOLUME_ACCUMULATOR_PDA,
    pump.AMM_GLOBAL_VOLUME_ACCUMULATOR_PDA,
    pump.getGlobalParamsPda(),
    pump.getSolVaultPda(),
    new PublicKey("11111111111111111111111111111111"),
    new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    new PublicKey("ComputeBudget111111111111111111111111111111"),
    new PublicKey("TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM"),
    new PublicKey(BUYBACK_FEE_RECIPIENT),
    new PublicKey(platformWallet),
  ].map((key) => key.toBase58());
}

export function coinCreatorVaultAuthority(sharingConfig: PublicKey): PublicKey {
  return swap.coinCreatorVaultAuthorityPda(sharingConfig);
}

export { pump };
