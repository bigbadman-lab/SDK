import {
  PublicKey,
  type MessageV0,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import BN from "bn.js";

import type { Shareholder } from "../../../lib/launch/fees.ts";
import { coinCreatorVaultAuthority, pump } from "./protocol.ts";
import { V1_COMPUTE_UNIT_LIMIT, compileLaunchV1 } from "./v1.ts";

export class AssembleError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "AssembleError";
    this.code = code;
  }
}

export type QuoteAccountGroup = {
  pool?: PublicKey;
  baseVault?: PublicKey;
  quoteVault?: PublicKey;
};

export type AssembleLaunchInput = {
  name: string;
  symbol: string;
  uri: string;
  mint: PublicKey;
  launcher: PublicKey;
  parentMint: PublicKey;
  quoteTokenProgram: PublicKey;
  shareholders: Shareholder[];
  blockhash: string;
  lastValidBlockHeight: bigint;
  coverage: "fixture" | "live";
  pumpQuote?: {
    pool?: { pool: PublicKey; baseVault: PublicKey; quoteVault: PublicKey };
    chain?: { mint: PublicKey; pool?: { pool: PublicKey; baseVault: PublicKey; quoteVault: PublicKey } }[];
  };
  buy: null | {
    quoteBaseUnits: BN;
    tokenAmount: BN;
    slippagePercent: number;
    bondingCurve: {
      virtualTokenReserves: BN;
      virtualQuoteReserves: BN;
      realTokenReserves: BN;
      realQuoteReserves: BN;
      tokenTotalSupply: BN;
      complete: boolean;
      creator: PublicKey;
      isMayhemMode: boolean;
      isCashbackCoin: boolean;
      quoteMint: PublicKey;
      creatorFeeBps: BN;
      canEditCreatorFee: boolean;
      isHolderReward: boolean;
      creatorFee: BN;
      protocolFees: BN;
      depth: number;
      initialVirtualQuoteReserves: BN;
      postCompleteBaseOut: BN;
      postCompleteQuoteIn: BN;
    };
  };
};

export type AssembledLaunch = {
  coverage: "fixture" | "live";
  transaction: string;
  transactionVersion: 1;
  encoding: "base64";
  messageHash: string;
  byteLength: number;
  accountCount: number;
  fitsPacket: boolean;
  roles: string[];
  signers: string[];
  shareholders: Shareholder[];
  adminRevokedByProtocol: true;
  quoteMint: string;
  mint: string;
  launcher: string;
  lookupTables: 0;
  computeUnitLimit: number;
  configMask: number;
  referencedAccounts: string[];
  staticAccountKeys: string[];
  instructions: TransactionInstruction[];
};

function encodeLength(length: number): number[] {
  const bytes: number[] = [];
  let remaining = length;
  for (;;) {
    let element = remaining & 0x7f;
    remaining >>= 7;
    if (remaining === 0) {
      bytes.push(element);
      break;
    }
    bytes.push(element | 0x80);
  }
  return bytes;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function serializeMessage(message: MessageV0): Uint8Array {
  const parts: Uint8Array[] = [
    Uint8Array.of(
      0x80,
      message.header.numRequiredSignatures,
      message.header.numReadonlySignedAccounts,
      message.header.numReadonlyUnsignedAccounts,
    ),
    Uint8Array.from(encodeLength(message.staticAccountKeys.length)),
  ];
  for (const key of message.staticAccountKeys) parts.push(key.toBytes());
  parts.push(new PublicKey(message.recentBlockhash).toBytes());
  parts.push(Uint8Array.from(encodeLength(message.compiledInstructions.length)));
  for (const instruction of message.compiledInstructions) {
    parts.push(Uint8Array.of(instruction.programIdIndex));
    parts.push(Uint8Array.from(encodeLength(instruction.accountKeyIndexes.length)));
    parts.push(Uint8Array.from(instruction.accountKeyIndexes));
    parts.push(Uint8Array.from(encodeLength(instruction.data.length)));
    parts.push(instruction.data);
  }
  parts.push(Uint8Array.from(encodeLength(message.addressTableLookups.length)));
  for (const lookup of message.addressTableLookups) {
    parts.push(lookup.accountKey.toBytes());
    parts.push(Uint8Array.from(encodeLength(lookup.writableIndexes.length)));
    parts.push(Uint8Array.from(lookup.writableIndexes));
    parts.push(Uint8Array.from(encodeLength(lookup.readonlyIndexes.length)));
    parts.push(Uint8Array.from(lookup.readonlyIndexes));
  }
  return concat(parts);
}

function quoteAta(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  program: PublicKey,
): TransactionInstruction {
  return createAssociatedTokenAccountIdempotentInstruction(
    payer,
    getAssociatedTokenAddressSync(mint, owner, true, program),
    owner,
    mint,
    program,
  );
}

function assertQuote(parent: PublicKey, program: PublicKey): void {
  if (parent.equals(NATIVE_MINT) || parent.equals(PublicKey.default)) {
    throw new AssembleError("quote");
  }
  if (!program.equals(TOKEN_2022_PROGRAM_ID) && !program.equals(TOKEN_PROGRAM_ID)) {
    throw new AssembleError("quote");
  }
}

export async function assembleChildLaunch(input: AssembleLaunchInput): Promise<AssembledLaunch> {
  assertQuote(input.parentMint, input.quoteTokenProgram);
  if (input.shareholders.length < 1 || input.shareholders.length > 10) {
    throw new AssembleError("allocation");
  }
  const seen = new Set<string>();
  for (const holder of input.shareholders) {
    if (holder.shareBps <= 0 || seen.has(holder.address)) throw new AssembleError("allocation");
    seen.add(holder.address);
  }
  const total = input.shareholders.reduce((sum, holder) => sum + holder.shareBps, 0);
  if (total !== 10_000) throw new AssembleError("allocation");
  if (input.buy && (input.buy.quoteBaseUnits.lten(0) || input.buy.tokenAmount.lten(0))) {
    throw new AssembleError("buy");
  }
  if (input.buy && (!Number.isFinite(input.buy.slippagePercent) || input.buy.slippagePercent <= 0 || input.buy.slippagePercent > 10)) {
    throw new AssembleError("slippage");
  }
  if (input.buy?.bondingCurve.isMayhemMode || input.buy?.bondingCurve.isCashbackCoin) {
    throw new AssembleError("mayhem");
  }
  if (input.buy && !input.buy.bondingCurve.quoteMint.equals(input.parentMint)) {
    throw new AssembleError("quote");
  }

  const sdk = new pump.PumpSdk();
  const holders = input.shareholders.map((holder) => ({
    address: new PublicKey(holder.address),
    shareBps: holder.shareBps,
  }));
  const create = await sdk.createV2Instruction({
    mint: input.mint,
    name: input.name,
    symbol: input.symbol,
    uri: input.uri,
    creator: input.launcher,
    user: input.launcher,
    mayhemMode: false,
    quoteMint: input.parentMint,
    quoteTokenProgram: input.quoteTokenProgram,
    pumpQuote: input.pumpQuote ?? { chain: [] },
  });
  const feeConfig = await sdk.createFeeSharingConfig({
    creator: input.launcher,
    mint: input.mint,
    pool: null,
  });
  const update = await sdk.updateFeeSharesV2({
    authority: input.launcher,
    mint: input.mint,
    currentShareholders: [input.launcher],
    newShareholders: holders,
    quoteMint: input.parentMint,
    quoteTokenProgram: input.quoteTokenProgram,
    bondingCurveComplete: false,
  });
  const sharingConfig = pump.feeSharingConfigPda(input.mint);
  const atas = new Map<string, TransactionInstruction>();
  // Fee updates distribute the quote before changing shares. A new child has
  // no creator vault yet, and the fee program rejects that missing token account.
  for (const owner of [
    input.launcher,
    ...holders.map((holder) => holder.address),
    pump.creatorVaultPda(sharingConfig),
    coinCreatorVaultAuthority(sharingConfig),
  ]) {
    const instruction = quoteAta(input.launcher, owner, input.parentMint, input.quoteTokenProgram);
    const key = instruction.keys.map((item) => `${item.pubkey.toBase58()}:${item.isSigner}`).join(",");
    atas.set(key, instruction);
  }
  const tagged: { role: string; instruction: TransactionInstruction }[] = [
    { role: "create_v2", instruction: create },
    { role: "create_fee_sharing_config", instruction: feeConfig },
    ...[...atas.values()].map((instruction) => ({ role: "quote_ata", instruction })),
    { role: "update_fee_shares_v2", instruction: update },
  ];
  if (input.buy) {
    const buyInstructions = await sdk.buyExactQuoteInV3Instructions({
      bondingCurve: input.buy.bondingCurve,
      associatedUserAccountInfo: null,
      mint: input.mint,
      user: input.launcher,
      amount: input.buy.tokenAmount,
      quoteAmount: input.buy.quoteBaseUnits,
      slippage: input.buy.slippagePercent,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      quoteTokenProgram: input.quoteTokenProgram,
    });
    if (buyInstructions.length < 1) throw new AssembleError("buy");
    buyInstructions.forEach((instruction, index) => {
      tagged.push({
        role: index === buyInstructions.length - 1 ? "buy_exact_quote_in_v3" : "buy_account",
        instruction,
      });
    });
  }

  const roles = tagged.map((item) => item.role);
  const createAt = roles.indexOf("create_v2");
  const configAt = roles.indexOf("create_fee_sharing_config");
  const updateAt = roles.indexOf("update_fee_shares_v2");
  const buyAt = roles.indexOf("buy_exact_quote_in_v3");
  if (!(createAt === 0 && configAt === 1 && updateAt > configAt)) throw new AssembleError("order");
  if (input.buy && (buyAt < 0 || buyAt !== roles.length - 1 || buyAt < updateAt)) {
    throw new AssembleError("buy");
  }
  if (!input.buy && buyAt !== -1) throw new AssembleError("buy");
  if (!create.keys.some((key) => key.pubkey.equals(input.parentMint))) throw new AssembleError("quote");
  if (!create.keys.some((key) => key.pubkey.equals(input.mint))) throw new AssembleError("mint");
  const sharing = sharingConfig;
  if (!feeConfig.keys.some((key) => key.pubkey.equals(sharing))) throw new AssembleError("fee_sharing");
  if (!update.keys.some((key) => key.pubkey.equals(sharing))) throw new AssembleError("fee_sharing");
  if (create.programId.toBase58() !== pump.PUMP_PROGRAM_ID.toBase58()) throw new AssembleError("program");
  if (feeConfig.programId.toBase58() !== pump.PUMP_FEE_PROGRAM_ID.toBase58()) throw new AssembleError("program");
  if (update.programId.toBase58() !== pump.PUMP_FEE_PROGRAM_ID.toBase58()) throw new AssembleError("program");
  if (feeConfig.data.subarray(0, 8).equals(update.data.subarray(0, 8))) throw new AssembleError("fee_sharing");

  const instructions = tagged.map((item) => item.instruction);
  const compiled = compileLaunchV1({
    instructions,
    feePayer: input.launcher.toBase58(),
    blockhash: input.blockhash,
    lastValidBlockHeight: input.lastValidBlockHeight,
  });
  if (!compiled.ok) throw new AssembleError(compiled.code);
  const required = [input.launcher.toBase58(), input.mint.toBase58()].sort();
  const actual = [...compiled.value.signers].sort();
  if (actual.join(",") !== required.join(",")) throw new AssembleError("signer");
  for (const holder of input.shareholders) {
    if (holder.address !== input.launcher.toBase58() && actual.includes(holder.address)) {
      throw new AssembleError("signer");
    }
  }
  for (const item of tagged) {
    if (item.role !== "quote_ata") continue;
    const [payer, , owner] = item.instruction.keys;
    if (!payer?.pubkey.equals(input.launcher) || payer.isSigner !== true) throw new AssembleError("signer");
    if (!owner || owner.isSigner || owner.isWritable) throw new AssembleError("signer");
  }
  return {
    coverage: input.coverage,
    transaction: compiled.value.transaction,
    transactionVersion: 1,
    encoding: "base64",
    messageHash: compiled.value.messageHash,
    byteLength: compiled.value.byteLength,
    accountCount: compiled.value.accountCount,
    fitsPacket: compiled.value.fitsPacket,
    roles,
    signers: compiled.value.signers,
    shareholders: input.shareholders,
    adminRevokedByProtocol: true,
    quoteMint: input.parentMint.toBase58(),
    mint: input.mint.toBase58(),
    launcher: input.launcher.toBase58(),
    lookupTables: 0,
    computeUnitLimit: V1_COMPUTE_UNIT_LIMIT,
    configMask: compiled.value.configMask,
    referencedAccounts: compiled.value.staticAccountKeys,
    staticAccountKeys: compiled.value.staticAccountKeys,
    instructions,
  };
}

export function fixtureCurve(quoteMint: PublicKey, creator: PublicKey) {
  const zero = new BN(0);
  const reserve = new BN(1_000_000_000);
  return {
    virtualTokenReserves: reserve,
    virtualQuoteReserves: reserve,
    realTokenReserves: reserve,
    realQuoteReserves: zero,
    tokenTotalSupply: reserve,
    complete: false,
    creator,
    isMayhemMode: false,
    isCashbackCoin: false,
    quoteMint,
    creatorFeeBps: zero,
    canEditCreatorFee: false,
    isHolderReward: false,
    creatorFee: zero,
    protocolFees: zero,
    depth: 1,
    initialVirtualQuoteReserves: reserve,
    postCompleteBaseOut: zero,
    postCompleteQuoteIn: zero,
  };
}
