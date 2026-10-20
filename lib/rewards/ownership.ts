import { createHash } from "node:crypto";

import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { canonicalAddress } from "../auth/solana.ts";
import type { RewardScope } from "./ledger.ts";

export function claimAuthorizationMessage(input: {
  scope: RewardScope;
  parentMint: string;
  claimant: string;
  asset: "sol" | "trest";
  idempotencyKey: string;
  amount: string;
}): string | null {
  const parent = canonicalAddress(input.parentMint);
  const claimant = canonicalAddress(input.claimant);
  if (!parent || !claimant) return null;
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(input.idempotencyKey)) return null;
  if (!/^[1-9][0-9]{0,18}$/.test(input.amount)) return null;
  return `sdk.fund/rewards/${input.scope}/${parent}/${input.asset}/${input.idempotencyKey}/${input.amount}`;
}

const DOMAIN = /^[A-Za-z0-9.:-]{3,120}$/;
const NONCE = /^[A-Za-z0-9_-]{16,80}$/;

export function boundClaimMessage(input: {
  domain: string;
  scope: RewardScope;
  parentMint: string;
  claimant: string;
  asset: "sol" | "trest";
  idempotencyKey: string;
  amount: string;
  nonce: string;
  expiresAt: number;
}): string | null {
  const base = claimAuthorizationMessage(input);
  if (!base || !DOMAIN.test(input.domain) || !NONCE.test(input.nonce)) return null;
  if (!Number.isInteger(input.expiresAt) || input.expiresAt <= 0) return null;
  return `${base}\nDomain: ${input.domain}\nNonce: ${input.nonce}\nExpires: ${input.expiresAt}`;
}

export function parseBoundClaim(message: string): { domain: string; nonce: string; expiresAt: number } | null {
  const lines = message.split("\n");
  if (lines.length !== 4 || !lines[0]?.startsWith("sdk.fund/rewards/")) return null;
  const domain = lines[1]?.startsWith("Domain: ") ? lines[1].slice("Domain: ".length) : "";
  const nonce = lines[2]?.startsWith("Nonce: ") ? lines[2].slice("Nonce: ".length) : "";
  const expires = lines[3]?.startsWith("Expires: ") ? lines[3].slice("Expires: ".length) : "";
  if (!DOMAIN.test(domain) || !NONCE.test(nonce) || !/^[1-9][0-9]{0,15}$/.test(expires)) return null;
  return { domain, nonce, expiresAt: Number(expires) };
}

export function verifyClaimOwnership(input: {
  message: string;
  signature: string;
  claimant: string;
}): { ok: true; proofHash: string } | { ok: false; code: "ownership" } {
  const claimant = canonicalAddress(input.claimant);
  if (!claimant || !input.message.startsWith("sdk.fund/rewards/")) return { ok: false, code: "ownership" };
  try {
    const signature = bs58.decode(input.signature);
    const key = new PublicKey(claimant).toBytes();
    const verified = nacl.sign.detached.verify(new TextEncoder().encode(input.message), signature, key);
    if (!verified) return { ok: false, code: "ownership" };
    return { ok: true, proofHash: createHash("sha256").update(input.message).digest("hex") };
  } catch {
    return { ok: false, code: "ownership" };
  }
}
