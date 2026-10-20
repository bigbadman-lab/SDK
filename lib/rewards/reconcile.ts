import { canonicalAddress } from "../auth/solana.ts";
import { creditFee, type FeeReceipt, type RewardScope } from "./ledger.ts";

const AMOUNT = /^(0|[1-9][0-9]{0,18})$/;
const SIGNED = /^-?(0|[1-9][0-9]{0,18})$/;

export type CollectionStatus = "confirmed" | "failed" | "uncertain";

function parse(value: string): bigint | null {
  if (!AMOUNT.test(value)) return null;
  return BigInt(value);
}

function parseSigned(value: string): bigint | null {
  if (!SIGNED.test(value)) return null;
  return BigInt(value);
}

export function netCreatorFee(input: {
  vaultOutLamports: string;
  networkFeeLamports: string;
  deployerPaidFee: boolean;
}): { ok: true; gross: string; fee: string; net: string } | { ok: false; code: "amount" } {
  const vault = parse(input.vaultOutLamports);
  const fee = parse(input.networkFeeLamports);
  if (vault === null || fee === null || vault <= BigInt(0)) return { ok: false, code: "amount" };
  const cost = input.deployerPaidFee ? fee : BigInt(0);
  const net = vault > cost ? vault - cost : BigInt(0);
  return { ok: true, gross: vault.toString(), fee: cost.toString(), net: net.toString() };
}

export function explainCreatorDelta(input: {
  creatorDeltaLamports: string;
  nativeVaultOutLamports: string;
  wsolClosedLamports: string;
  networkFeeLamports: string;
  deployerPaidFee: boolean;
}): { ok: true; unrelatedDepositLamports: string } | { ok: false; code: "amount" | "unreconciled" } {
  const delta = parseSigned(input.creatorDeltaLamports);
  const native = parse(input.nativeVaultOutLamports);
  const closed = parse(input.wsolClosedLamports);
  const fee = parse(input.networkFeeLamports);
  if (delta === null || native === null || closed === null || fee === null) return { ok: false, code: "amount" };
  const cost = input.deployerPaidFee ? fee : BigInt(0);
  const residual = delta - (native + closed - cost);
  if (residual < BigInt(0)) return { ok: false, code: "unreconciled" };
  return { ok: true, unrelatedDepositLamports: residual.toString() };
}

export function reconcileCreatorFee(input: {
  status: CollectionStatus;
  signature: string;
  slot: string;
  parentMint: string;
  scope: RewardScope;
  creator: string;
  feePayer: string;
  vaultOutLamports: string;
  creatorDeltaLamports: string;
  networkFeeLamports: string;
  unrelatedDepositLamports: string;
  wsolTokenOut?: string;
  wsolClosedLamports?: string;
  wsolRentLamports?: string;
  existing: readonly FeeReceipt[];
}): { ok: true; receipt: FeeReceipt; gross: string; fee: string; net: string; native: string; wsolConverted: string; wsolUnconverted: string; rentExcluded: string; receipts: FeeReceipt[] } | { ok: false; code: "amount" | "duplicate" | "fee_source" | "parent" | "unconfirmed" | "unreconciled" | "wsol" } {
  if (input.status !== "confirmed") return { ok: false, code: "unconfirmed" };
  const creator = canonicalAddress(input.creator);
  const feePayer = canonicalAddress(input.feePayer);
  const parent = canonicalAddress(input.parentMint);
  if (!creator || !feePayer || !parent) return { ok: false, code: "parent" };
  const delta = parseSigned(input.creatorDeltaLamports);
  const deposit = parse(input.unrelatedDepositLamports);
  const vault = parse(input.vaultOutLamports);
  const fee = parse(input.networkFeeLamports);
  const wsolToken = parse(input.wsolTokenOut ?? "0");
  const wsolClosed = parse(input.wsolClosedLamports ?? "0");
  const wsolRent = parse(input.wsolRentLamports ?? "0");
  if (delta === null || deposit === null || vault === null || fee === null || wsolToken === null || wsolClosed === null || wsolRent === null) {
    return { ok: false, code: "amount" };
  }
  if (wsolClosed > BigInt(0) && wsolClosed < wsolRent) return { ok: false, code: "unreconciled" };
  const wsolConverted = wsolClosed > BigInt(0) ? wsolClosed - wsolRent : BigInt(0);
  if (wsolClosed > BigInt(0) && wsolConverted !== wsolToken) return { ok: false, code: "unreconciled" };
  const wsolUnconverted = wsolClosed === BigInt(0) ? wsolToken : BigInt(0);
  if (vault <= BigInt(0) && wsolConverted <= BigInt(0)) {
    return { ok: false, code: wsolUnconverted > BigInt(0) ? "wsol" : "fee_source" };
  }
  const deployerPaidFee = feePayer === creator;
  const cost = deployerPaidFee ? fee : BigInt(0);
  const expectedDelta = vault + wsolClosed - cost + deposit;
  if (delta !== expectedDelta) return { ok: false, code: "unreconciled" };
  const gross = vault + wsolConverted;
  const netAmount = gross > cost ? gross - cost : BigInt(0);
  if (netAmount <= BigInt(0)) return { ok: false, code: "amount" };
  const net = { ok: true as const, gross: gross.toString(), fee: cost.toString(), net: netAmount.toString() };
  const credited = creditFee(input.existing, {
    signature: input.signature,
    parentMint: parent,
    scope: input.scope,
    amountLamports: net.net,
    slot: input.slot,
    confirmed: true,
    source: "creator_vault",
  });
  if (!credited.ok) return credited;
  const receipt = credited.receipts[credited.receipts.length - 1];
  if (!receipt) return { ok: false, code: "amount" };
  return {
    ok: true,
    receipt,
    gross: net.gross,
    fee: net.fee,
    net: net.net,
    native: vault.toString(),
    wsolConverted: wsolConverted.toString(),
    wsolUnconverted: wsolUnconverted.toString(),
    rentExcluded: (wsolClosed > BigInt(0) ? wsolRent : BigInt(0)).toString(),
    receipts: credited.receipts,
  };
}

export function reconcileBuyback(input: {
  status: CollectionStatus;
  quotedTokenAmount: string;
  tokenDelta: string;
}): { ok: true; credited: string } | { ok: false; code: "failed" | "unconfirmed" | "amount" } {
  const quoted = parse(input.quotedTokenAmount);
  const delta = parse(input.tokenDelta);
  if (quoted === null || delta === null) return { ok: false, code: "amount" };
  if (input.status === "failed") return { ok: false, code: "failed" };
  if (input.status !== "confirmed") return { ok: false, code: "unconfirmed" };
  if (delta <= BigInt(0)) return { ok: false, code: "amount" };
  return { ok: true, credited: delta.toString() };
}
