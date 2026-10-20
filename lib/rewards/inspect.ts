import { createHash } from "node:crypto";

import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";

import { canonicalAddress } from "../auth/solana.ts";
import { associatedTokenAddress, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, type BuiltInstruction } from "./claim.ts";
import { COLLECT_CREATOR_FEE_DISCRIMINATOR, COLLECT_CREATOR_FEE_V2_DISCRIMINATOR, PUMP_AMM_PROGRAM_ID, PUMP_PROGRAM_ID } from "./collect.ts";
import type { IntentKind } from "./cycle.ts";
import type { RewardScope } from "./ledger.ts";

const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
const PUMP_FEE_PROGRAM_ID = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ";
const BUY_DISCRIMINATOR = [225, 247, 80, 30, 213, 179, 132, 136];
const AMM_BUY_DISCRIMINATOR = [102, 6, 61, 18, 1, 218, 235, 234];
const AMM_COLLECT_DISCRIMINATOR = [160, 57, 89, 42, 181, 139, 43, 66];
const DISTRIBUTE_CREATOR_FEES_V2 = [255, 203, 19, 79, 244, 68, 8, 159];
const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";

function creatorVaultAddress(deployer: string): string | null {
  try {
    const [address] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("creator-vault"), new PublicKey(deployer).toBytes()],
      new PublicKey(PUMP_PROGRAM_ID),
    );
    return address.toBase58();
  } catch {
    return null;
  }
}

const ALLOWED = new Set([
  PUMP_PROGRAM_ID,
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  COMPUTE_BUDGET_PROGRAM_ID,
]);

const AMOUNT = /^(0|[1-9][0-9]{0,18})$/;

export type CompiledTransaction = {
  feePayer: string;
  recentBlockhash: string;
  instructions: BuiltInstruction[];
};

export type SignPolicy = {
  kind: IntentKind | "child_distribute";
  scope: RewardScope;
  parentMint: string;
  deployer: string;
  recipient: string;
  maxLamports: string;
  maxRentLamports: string;
  tokenProgram: string;
};

export type InspectCode = "destination" | "identity" | "parent" | "program" | "spend" | "transaction";

function sameBytes(data: readonly number[], discriminator: readonly number[]): boolean {
  return discriminator.every((byte, index) => data[index] === byte);
}

function readU32(data: readonly number[], offset: number): number | null {
  if (data.length < offset + 4) return null;
  return (data[offset] ?? 0) + (data[offset + 1] ?? 0) * 256 + (data[offset + 2] ?? 0) * 65536 + (data[offset + 3] ?? 0) * 16777216;
}

function readU64(data: readonly number[], offset: number): bigint | null {
  if (data.length < offset + 8) return null;
  let value = BigInt(0);
  for (let index = 0; index < 8; index += 1) {
    value += BigInt(data[offset + index] ?? 0) << BigInt(8 * index);
  }
  return value;
}

function parseAmount(value: string): bigint | null {
  if (!AMOUNT.test(value)) return null;
  return BigInt(value);
}

export function transactionMessage(transaction: CompiledTransaction): Uint8Array | null {
  try {
    const compiled = new Transaction({
      feePayer: new PublicKey(transaction.feePayer),
      recentBlockhash: transaction.recentBlockhash,
    });
    for (const instruction of transaction.instructions) {
      compiled.add(
        new TransactionInstruction({
          programId: new PublicKey(instruction.programId),
          keys: instruction.keys.map((key) => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          data: Buffer.from(instruction.data),
        }),
      );
    }
    return compiled.serializeMessage();
  } catch {
    return null;
  }
}

export function messageSha256(message: Uint8Array): string {
  return createHash("sha256").update(message).digest("hex");
}

export function signedTransactionWire(transaction: CompiledTransaction, signature: string): Uint8Array | null {
  try {
    const compiled = new Transaction({
      feePayer: new PublicKey(transaction.feePayer),
      recentBlockhash: transaction.recentBlockhash,
    });
    for (const instruction of transaction.instructions) {
      compiled.add(
        new TransactionInstruction({
          programId: new PublicKey(instruction.programId),
          keys: instruction.keys.map((key) => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
          })),
          data: Buffer.from(instruction.data),
        }),
      );
    }
    compiled.addSignature(new PublicKey(transaction.feePayer), Buffer.from(bs58.decode(signature)));
    return compiled.serialize();
  } catch {
    return null;
  }
}

function referenced(instructions: readonly BuiltInstruction[], address: string): boolean {
  return instructions.some(
    (instruction) =>
      instruction.programId !== SYSTEM_PROGRAM_ID &&
      instruction.keys.some((key) => key.pubkey === address),
  );
}

export function inspectRewardsTransaction(
  transaction: CompiledTransaction,
  policy: SignPolicy,
): { ok: true; message: Uint8Array } | { ok: false; code: InspectCode } {
  const deployer = canonicalAddress(policy.deployer);
  const recipient = canonicalAddress(policy.recipient);
  const parent = canonicalAddress(policy.parentMint);
  const feePayer = canonicalAddress(transaction.feePayer);
  const maxLamports = parseAmount(policy.maxLamports);
  const maxRent = parseAmount(policy.maxRentLamports);
  if (!deployer || !recipient || !parent || !feePayer || feePayer !== deployer || maxLamports === null || maxRent === null) {
    return { ok: false, code: "parent" };
  }
  if (policy.scope !== "test" && policy.scope !== "production") return { ok: false, code: "parent" };
  const message = transactionMessage(transaction);
  if (!message || transaction.instructions.length === 0) return { ok: false, code: "transaction" };
  let rentSpent = BigInt(0);
  let valueSpent = BigInt(0);
  let collect = false;
  let buy = false;
  let solClaims = 0;
  let tokenClaims = 0;
  let distributed = false;
  for (const instruction of transaction.instructions) {
    const program = canonicalAddress(instruction.programId);
    if (!program || !ALLOWED.has(program)) return { ok: false, code: "program" };
    if (instruction.keys.some((key) => key.isSigner && canonicalAddress(key.pubkey) !== deployer)) {
      return { ok: false, code: "identity" };
    }
    if (policy.kind === "child_distribute") {
      const nativeCollect =
        sameBytes(instruction.data, COLLECT_CREATOR_FEE_DISCRIMINATOR) ||
        sameBytes(instruction.data, COLLECT_CREATOR_FEE_V2_DISCRIMINATOR) ||
        sameBytes(instruction.data, AMM_COLLECT_DISCRIMINATOR);
      const buyInstruction = sameBytes(instruction.data, BUY_DISCRIMINATOR) || sameBytes(instruction.data, AMM_BUY_DISCRIMINATOR);
      if (nativeCollect || buyInstruction) return { ok: false, code: "program" };
      if (program === PUMP_PROGRAM_ID && sameBytes(instruction.data, DISTRIBUTE_CREATOR_FEES_V2)) {
        distributed = true;
        continue;
      }
      if (program === PUMP_PROGRAM_ID || program === PUMP_AMM_PROGRAM_ID || program === PUMP_FEE_PROGRAM_ID) continue;
    }
    if (program === COMPUTE_BUDGET_PROGRAM_ID) {
      const operation = instruction.data[0];
      if (operation === 2) {
        const units = readU32(instruction.data, 1);
        if (units === null || units > 1_400_000) return { ok: false, code: "spend" };
      } else if (operation === 3) {
        const price = readU64(instruction.data, 1);
        if (price === null || price > BigInt(1_000_000)) return { ok: false, code: "spend" };
      } else {
        return { ok: false, code: "program" };
      }
      continue;
    }
    if (program === ASSOCIATED_TOKEN_PROGRAM_ID) {
      const payer = canonicalAddress(instruction.keys[0]?.pubkey ?? "");
      if ((instruction.data[0] !== 0 && instruction.data[0] !== 1) || payer !== deployer) {
        return { ok: false, code: "destination" };
      }
      continue;
    }
    if ((program === TOKEN_PROGRAM_ID || program === TOKEN_2022_PROGRAM_ID) && instruction.data[0] === 17) {
      continue;
    }
    if (program === PUMP_PROGRAM_ID && sameBytes(instruction.data, COLLECT_CREATOR_FEE_DISCRIMINATOR)) {
      return { ok: false, code: "program" };
    }
    if (program === PUMP_PROGRAM_ID && sameBytes(instruction.data, COLLECT_CREATOR_FEE_V2_DISCRIMINATOR)) {
      const creator = canonicalAddress(instruction.keys[0]?.pubkey ?? "");
      const vault = creatorVaultAddress(deployer);
      const vaultKey = canonicalAddress(instruction.keys[2]?.pubkey ?? "");
      const quoteMint = canonicalAddress(instruction.keys[4]?.pubkey ?? "");
      const quoteProgram = canonicalAddress(instruction.keys[5]?.pubkey ?? "");
      const programAccount = canonicalAddress(instruction.keys[9]?.pubkey ?? "");
      if (
        creator !== deployer ||
        instruction.keys[0]?.isSigner ||
        !instruction.keys[0]?.isWritable ||
        !vault ||
        vaultKey !== vault ||
        quoteMint !== NATIVE_SOL_MINT ||
        quoteProgram !== TOKEN_PROGRAM_ID ||
        programAccount !== PUMP_PROGRAM_ID
      ) {
        return { ok: false, code: "destination" };
      }
      collect = true;
    }
    if (program === PUMP_AMM_PROGRAM_ID && sameBytes(instruction.data, AMM_COLLECT_DISCRIMINATOR)) {
      collect = true;
    }
    if ((program === TOKEN_PROGRAM_ID || program === TOKEN_2022_PROGRAM_ID) && instruction.data[0] === 9) {
      const destination = canonicalAddress(instruction.keys[1]?.pubkey ?? "");
      if (destination !== deployer) return { ok: false, code: "destination" };
    }
    if (program === PUMP_PROGRAM_ID && sameBytes(instruction.data, BUY_DISCRIMINATOR)) {
      const quote = readU64(instruction.data, 8);
      if (quote === null || !instruction.keys.some((key) => canonicalAddress(key.pubkey) === parent)) {
        return { ok: false, code: "parent" };
      }
      valueSpent += quote;
      buy = true;
    }
    if (program === PUMP_AMM_PROGRAM_ID && sameBytes(instruction.data, AMM_BUY_DISCRIMINATOR)) {
      const quote = readU64(instruction.data, 16);
      if (quote === null || !instruction.keys.some((key) => canonicalAddress(key.pubkey) === parent)) {
        return { ok: false, code: "parent" };
      }
      valueSpent += quote;
      buy = true;
    }
    if (program === SYSTEM_PROGRAM_ID && instruction.data[0] === 2) {
      const source = canonicalAddress(instruction.keys[0]?.pubkey ?? "");
      const destination = canonicalAddress(instruction.keys[1]?.pubkey ?? "");
      const lamports = readU64(instruction.data, 4);
      if (!source || !destination || source !== deployer || lamports === null) return { ok: false, code: "destination" };
      if (policy.kind === "claim_sol") {
        if (destination !== recipient) return { ok: false, code: "destination" };
        valueSpent += lamports;
        solClaims += 1;
      } else if (destination !== deployer && !referenced(transaction.instructions, destination)) {
        return { ok: false, code: "destination" };
      } else {
        rentSpent += lamports;
      }
    }
    if ((program === TOKEN_PROGRAM_ID || program === TOKEN_2022_PROGRAM_ID) && instruction.data[0] === 12) {
      const mint = canonicalAddress(instruction.keys[1]?.pubkey ?? "");
      const destination = canonicalAddress(instruction.keys[2]?.pubkey ?? "");
      const amount = readU64(instruction.data, 1);
      const expected = associatedTokenAddress(recipient, parent, program);
      if (mint !== parent || !expected || destination !== expected || amount === null) return { ok: false, code: "parent" };
      if (amount > maxLamports) return { ok: false, code: "spend" };
      tokenClaims += 1;
      continue;
    }
    const pumpCollect = program === PUMP_PROGRAM_ID && sameBytes(instruction.data, COLLECT_CREATOR_FEE_V2_DISCRIMINATOR);
    const pumpBuy = program === PUMP_PROGRAM_ID && sameBytes(instruction.data, BUY_DISCRIMINATOR);
    const ammCollect = program === PUMP_AMM_PROGRAM_ID && sameBytes(instruction.data, AMM_COLLECT_DISCRIMINATOR);
    const ammBuy = program === PUMP_AMM_PROGRAM_ID && sameBytes(instruction.data, AMM_BUY_DISCRIMINATOR);
    const close = (program === TOKEN_PROGRAM_ID || program === TOKEN_2022_PROGRAM_ID) && instruction.data[0] === 9;
    const transfer = program === SYSTEM_PROGRAM_ID && instruction.data[0] === 2;
    if (!pumpCollect && !pumpBuy && !ammCollect && !ammBuy && !close && !transfer) return { ok: false, code: "program" };
  }
  if (rentSpent > maxRent || valueSpent > maxLamports) return { ok: false, code: "spend" };
  if (policy.kind === "collect" && !collect) return { ok: false, code: "program" };
  if (policy.kind === "buyback" && !buy) return { ok: false, code: "program" };
  if (policy.kind === "claim_sol" && solClaims !== 1) return { ok: false, code: "destination" };
  if (policy.kind === "claim_token" && tokenClaims !== 1) return { ok: false, code: "parent" };
  if (policy.kind === "claim_sol" && (collect || buy || tokenClaims > 0)) return { ok: false, code: "program" };
  if (policy.kind === "claim_token" && (collect || buy || solClaims > 0)) return { ok: false, code: "program" };
  if (policy.kind === "child_distribute" && (!distributed || collect || buy || solClaims > 0 || tokenClaims > 0)) {
    return { ok: false, code: "program" };
  }
  return { ok: true, message };
}
