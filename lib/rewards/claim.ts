import { canonicalAddress } from "../auth/solana.ts";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

const AMOUNT = /^(0|[1-9][0-9]{0,18})$/;
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM_ID = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export type BuiltInstruction = {
  programId: string;
  keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: number[];
};

function parse(value: string): bigint | null {
  if (!AMOUNT.test(value)) return null;
  return BigInt(value);
}

export function associatedTokenAddress(owner: string, mint: string, tokenProgram: string): string | null {
  const ownerKey = canonicalAddress(owner);
  const mintKey = canonicalAddress(mint);
  const programKey = canonicalAddress(tokenProgram);
  if (!ownerKey || !mintKey || !programKey) return null;
  if (programKey !== TOKEN_PROGRAM_ID && programKey !== TOKEN_2022_PROGRAM_ID) return null;
  const [address] = PublicKey.findProgramAddressSync(
    [new PublicKey(ownerKey).toBuffer(), new PublicKey(programKey).toBuffer(), new PublicKey(mintKey).toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return address.toBase58();
}

function encode(instruction: TransactionInstruction): BuiltInstruction {
  return {
    programId: instruction.programId.toBase58(),
    keys: instruction.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    data: [...instruction.data],
  };
}

export function remainingClaim(entitlement: string, alreadyClaimed: string): string | null {
  const total = parse(entitlement);
  const claimed = parse(alreadyClaimed);
  if (total === null || claimed === null || claimed > total) return null;
  return (total - claimed).toString();
}

export function buildSolClaim(input: {
  parentMint: string;
  claimParentMint: string;
  deployer: string;
  claimant: string;
  amountLamports: string;
  entitlementLamports: string;
  alreadyClaimedLamports: string;
  idempotencyKey: string;
  uncertainKeys: readonly string[];
}): { ok: true; instruction: BuiltInstruction; idempotencyKey: string } | { ok: false; code: "amount" | "duplicate" | "parent" | "unfunded" | "uncertain" } {
  if (input.uncertainKeys.includes(input.idempotencyKey) || input.uncertainKeys.includes(`${input.claimant}:sol`)) {
    return { ok: false, code: "uncertain" };
  }
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(input.idempotencyKey)) return { ok: false, code: "duplicate" };
  const parent = canonicalAddress(input.parentMint);
  const claimParent = canonicalAddress(input.claimParentMint);
  const deployer = canonicalAddress(input.deployer);
  const claimant = canonicalAddress(input.claimant);
  if (!parent || !claimParent || !deployer || !claimant || parent !== claimParent) return { ok: false, code: "parent" };
  const amount = parse(input.amountLamports);
  const remaining = remainingClaim(input.entitlementLamports, input.alreadyClaimedLamports);
  if (amount === null || remaining === null || amount <= BigInt(0)) return { ok: false, code: "amount" };
  if (amount > BigInt(remaining)) return { ok: false, code: "unfunded" };
  const instruction = SystemProgram.transfer({
    fromPubkey: new PublicKey(deployer),
    toPubkey: new PublicKey(claimant),
    lamports: amount,
  });
  return { ok: true, instruction: encode(instruction), idempotencyKey: input.idempotencyKey };
}

export function buildTokenClaim(input: {
  parentMint: string;
  claimMint: string;
  tokenProgram: string;
  deployer: string;
  claimant: string;
  amount: string;
  decimals: number;
  entitlement: string;
  alreadyClaimed: string;
  idempotencyKey: string;
  uncertainKeys: readonly string[];
}): { ok: true; instruction: BuiltInstruction; idempotencyKey: string } | { ok: false; code: "amount" | "duplicate" | "parent" | "unfunded" | "uncertain" } {
  if (input.uncertainKeys.includes(input.idempotencyKey) || input.uncertainKeys.includes(`${input.claimant}:token`)) {
    return { ok: false, code: "uncertain" };
  }
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(input.idempotencyKey)) return { ok: false, code: "duplicate" };
  const parent = canonicalAddress(input.parentMint);
  const claimMint = canonicalAddress(input.claimMint);
  const deployer = canonicalAddress(input.deployer);
  const claimant = canonicalAddress(input.claimant);
  const program = canonicalAddress(input.tokenProgram);
  if (!parent || !claimMint || !deployer || !claimant || !program || parent !== claimMint) return { ok: false, code: "parent" };
  if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 9) return { ok: false, code: "amount" };
  const amount = parse(input.amount);
  const remaining = remainingClaim(input.entitlement, input.alreadyClaimed);
  if (amount === null || remaining === null || amount <= BigInt(0)) return { ok: false, code: "amount" };
  if (amount > BigInt(remaining)) return { ok: false, code: "unfunded" };
  const source = associatedTokenAddress(deployer, parent, program);
  const destination = associatedTokenAddress(claimant, parent, program);
  if (!source || !destination) return { ok: false, code: "parent" };
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(input.decimals, 9);
  const instruction = new TransactionInstruction({
    programId: new PublicKey(program),
    keys: [
      { pubkey: new PublicKey(source), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(parent), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(destination), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(deployer), isSigner: true, isWritable: false },
    ],
    data,
  });
  return { ok: true, instruction: encode(instruction), idempotencyKey: input.idempotencyKey };
}
