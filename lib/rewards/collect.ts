import { canonicalAddress } from "../auth/solana.ts";

export const PUMP_PROGRAM_ID = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
export const PUMP_AMM_PROGRAM_ID = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";

export const COLLECT_CREATOR_FEE_DISCRIMINATOR = [20, 22, 86, 123, 198, 28, 219, 132] as const;
export const COLLECT_CREATOR_FEE_V2_DISCRIMINATOR = [207, 17, 138, 242, 4, 34, 19, 56] as const;

export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";

// Official Pump docs (pump-public-docs/COLLECT_CREATOR_FEE.md) say single-recipient
// SOL coins use collect_creator_fee_v2 with wrapped SOL as quote_mint. The program
// moves lamports from the creator vault to the creator and leaves the vault
// rent-exempt. The legacy collect_creator_fee instruction is not the current path.
// PumpSwap WSOL stays a token balance until closeAccount unwraps it.
export function solCreatorFeeInstruction(): "collectCreatorFeeV2" {
  return "collectCreatorFeeV2";
}

const SOL_QUOTES = new Set([
  "11111111111111111111111111111111",
  "So11111111111111111111111111111111111111112",
]);

export type CollectionPlan =
  | {
      ok: true;
      mode: "single_recipient";
      pumpInstruction: "collectCreatorFeeV2";
      pumpProgram: typeof PUMP_PROGRAM_ID;
      discriminator: readonly number[];
      ammInstruction: "collectCoinCreatorFee";
      ammProgram: typeof PUMP_AMM_PROGRAM_ID;
      ammLeg: "only_if_wsol_vault_exists";
      recipient: string;
      crankSignerRequired: false;
      proceedsAccount: "creator_system_account";
      spendingSigner: "deployer";
    }
  | {
      ok: false;
      code: "fee_mode" | "quote";
      path: "sweep_creator_fee_then_distribute_creator_fees" | "holder_rewards" | "unsupported";
    };

export function collectionPlan(input: {
  feeMode: "single_recipient" | "fee_sharing" | "holder_rewards";
  creator: string;
  quoteMint: string;
}): CollectionPlan {
  const creator = canonicalAddress(input.creator);
  const quoteMint = canonicalAddress(input.quoteMint);
  if (!creator || !quoteMint) return { ok: false, code: "quote", path: "unsupported" };
  if (input.feeMode === "holder_rewards") return { ok: false, code: "fee_mode", path: "holder_rewards" };
  if (input.feeMode === "fee_sharing") {
    return { ok: false, code: "fee_mode", path: "sweep_creator_fee_then_distribute_creator_fees" };
  }
  if (!SOL_QUOTES.has(quoteMint)) return { ok: false, code: "quote", path: "unsupported" };
  return {
    ok: true,
    mode: "single_recipient",
    pumpInstruction: "collectCreatorFeeV2",
    pumpProgram: PUMP_PROGRAM_ID,
    discriminator: COLLECT_CREATOR_FEE_V2_DISCRIMINATOR,
    ammInstruction: "collectCoinCreatorFee",
    ammProgram: PUMP_AMM_PROGRAM_ID,
    ammLeg: "only_if_wsol_vault_exists",
    recipient: creator,
    crankSignerRequired: false,
    proceedsAccount: "creator_system_account",
    spendingSigner: "deployer",
  };
}
