import { createHash } from "node:crypto";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compileTransactionMessage,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from "@solana/kit";
import type { TransactionInstruction } from "@solana/web3.js";

import { LAUNCH_PRIORITY_FEE_LAMPORTS } from "../../../lib/launch/cost.ts";

export const V1_PACKET_LIMIT_BYTES = 4096;
export const V1_ACCOUNT_LIMIT = 64;
export const V1_COMPUTE_UNIT_LIMIT = 1_400_000;
export const V1_LOADED_ACCOUNTS_DATA_LIMIT = 64 * 1024 * 1024;
export const V1_PRIORITY_FEE_LAMPORTS = LAUNCH_PRIORITY_FEE_LAMPORTS;
const V1_CONFIG_MASK = 15;

export type CompiledV1 = {
  transaction: string;
  messageHash: string;
  byteLength: number;
  accountCount: number;
  signers: string[];
  staticAccountKeys: string[];
  configMask: number;
  fitsPacket: boolean;
};

function bytesEqual(left: ArrayLike<number>, right: ArrayLike<number>): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function toKit(instruction: TransactionInstruction): Instruction {
  return {
    programAddress: address(instruction.programId.toBase58()),
    accounts: instruction.keys.map((key) => ({
      address: address(key.pubkey.toBase58()),
      role:
        key.isSigner && key.isWritable
          ? AccountRole.WRITABLE_SIGNER
          : key.isSigner
            ? AccountRole.READONLY_SIGNER
            : key.isWritable
              ? AccountRole.WRITABLE
              : AccountRole.READONLY,
    })),
    data: new Uint8Array(instruction.data),
  };
}

function writable(header: { numSignerAccounts: number; numReadonlySignerAccounts: number; numReadonlyNonSignerAccounts: number }, accountCount: number, index: number): boolean {
  const writableSigners = header.numSignerAccounts - header.numReadonlySignerAccounts;
  const readonlyTail = accountCount - header.numReadonlyNonSignerAccounts;
  return index < writableSigners || (index >= header.numSignerAccounts && index < readonlyTail);
}

export function compileLaunchV1(input: {
  instructions: TransactionInstruction[];
  feePayer: string;
  blockhash: string;
  lastValidBlockHeight: bigint;
}): { ok: true; value: CompiledV1 } | { ok: false; code: "program" | "size" } {
  const message = pipe(
    createTransactionMessage({ version: 1 }),
    (current) => setTransactionMessageFeePayer(address(input.feePayer), current),
    (current) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: input.blockhash as Blockhash,
          lastValidBlockHeight: input.lastValidBlockHeight,
        },
        current,
      ),
    (current) =>
      setTransactionMessageConfig(
        {
          computeUnitLimit: V1_COMPUTE_UNIT_LIMIT,
          loadedAccountsDataSizeLimit: V1_LOADED_ACCOUNTS_DATA_LIMIT,
          priorityFeeLamports: V1_PRIORITY_FEE_LAMPORTS,
        },
        current,
      ),
    (current) => appendTransactionMessageInstructions(input.instructions.map(toKit), current),
  );
  const compiled = compileTransactionMessage(message);
  if (compiled.version !== 1 || compiled.configMask !== V1_CONFIG_MASK) {
    return { ok: false, code: "program" };
  }
  const configured = compiled.configValues.map((item) => item.value);
  if (
    !configured.includes(V1_COMPUTE_UNIT_LIMIT) ||
    !configured.includes(V1_LOADED_ACCOUNTS_DATA_LIMIT) ||
    !configured.includes(V1_PRIORITY_FEE_LAMPORTS)
  ) {
    return { ok: false, code: "program" };
  }
  if (compiled.instructionPayloads.length !== input.instructions.length) {
    return { ok: false, code: "program" };
  }
  for (let index = 0; index < input.instructions.length; index += 1) {
    const instruction = input.instructions[index];
    const payload = compiled.instructionPayloads[index];
    const header = compiled.instructionHeaders[index];
    if (!instruction || !payload || !header) return { ok: false, code: "program" };
    const program = compiled.staticAccounts[header.programAccountIndex];
    if (program !== instruction.programId.toBase58()) return { ok: false, code: "program" };
    if (!bytesEqual(payload.instructionData, instruction.data)) return { ok: false, code: "program" };
    if (payload.instructionAccountIndices.length !== instruction.keys.length) {
      return { ok: false, code: "program" };
    }
    for (let keyIndex = 0; keyIndex < instruction.keys.length; keyIndex += 1) {
      const accountIndex = payload.instructionAccountIndices[keyIndex];
      const meta = instruction.keys[keyIndex];
      if (accountIndex === undefined || !meta) return { ok: false, code: "program" };
      if (compiled.staticAccounts[accountIndex] !== meta.pubkey.toBase58()) {
        return { ok: false, code: "program" };
      }
    }
  }
  const expectedSigners = new Set<string>([input.feePayer]);
  const expectedWritable = new Set<string>([input.feePayer]);
  for (const instruction of input.instructions) {
    for (const key of instruction.keys) {
      const account = key.pubkey.toBase58();
      if (key.isSigner) expectedSigners.add(account);
      if (key.isWritable) expectedWritable.add(account);
    }
  }
  const headerSigners = compiled.staticAccounts.slice(0, compiled.header.numSignerAccounts);
  if (headerSigners.length !== expectedSigners.size || headerSigners.some((account) => !expectedSigners.has(account))) {
    return { ok: false, code: "program" };
  }
  for (let index = 0; index < compiled.staticAccounts.length; index += 1) {
    const account = compiled.staticAccounts[index];
    if (!account) return { ok: false, code: "program" };
    const isWritable = writable(compiled.header, compiled.staticAccounts.length, index);
    if (isWritable !== expectedWritable.has(account)) return { ok: false, code: "program" };
  }
  const transaction = compileTransaction(message);
  const wire = Uint8Array.from(getTransactionEncoder().encode(transaction));
  const signers = Object.keys(transaction.signatures);
  const staticAccountKeys = compiled.staticAccounts.map((account) => account as Address);
  const fitsPacket =
    wire.byteLength <= V1_PACKET_LIMIT_BYTES &&
    staticAccountKeys.length <= V1_ACCOUNT_LIMIT &&
    signers.length === 2 &&
    compiled.header.numSignerAccounts === 2;
  if (!fitsPacket) return { ok: false, code: "size" };
  return {
    ok: true,
    value: {
      transaction: Buffer.from(wire).toString("base64"),
      messageHash: createHash("sha256").update(Uint8Array.from(transaction.messageBytes)).digest("hex"),
      byteLength: wire.byteLength,
      accountCount: staticAccountKeys.length,
      signers,
      staticAccountKeys,
      configMask: compiled.configMask,
      fitsPacket,
    },
  };
}
