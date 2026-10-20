import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

import { canonicalAddress } from "../auth/solana.ts";
import { inspectRewardsTransaction, type CompiledTransaction, type SignPolicy } from "./inspect.ts";

export type SignerState = "unconfigured" | "matched" | "suspended";

export function derivedDeployerAddress(secret: string): string | null {
  let bytes: Uint8Array | null = null;
  try {
    if (secret.length < 64 || secret.length > 128 || secret.includes("[") || /\s/.test(secret)) return null;
    bytes = bs58.decode(secret);
    if (bytes.length !== 64) return null;
    const pair = nacl.sign.keyPair.fromSecretKey(bytes);
    return canonicalAddress(new PublicKey(pair.publicKey).toBase58());
  } catch {
    return null;
  } finally {
    bytes?.fill(0);
  }
}

export function inspectDeployerSigner(input: {
  secret: string | null;
  expectedAddress: string | null;
  suspended: boolean;
}): { ok: true; signer: SignerState } | { ok: false; code: "signer_malformed" | "signer_mismatch" | "signer_unbound" } {
  const secret = input.secret?.trim() ?? "";
  if (!secret) return { ok: true, signer: input.suspended ? "suspended" : "unconfigured" };
  const expected = input.expectedAddress ? canonicalAddress(input.expectedAddress) : null;
  if (!expected) return { ok: false, code: "signer_unbound" };
  const derived = derivedDeployerAddress(secret);
  if (!derived) return { ok: false, code: "signer_malformed" };
  if (derived !== expected) return { ok: false, code: "signer_mismatch" };
  return { ok: true, signer: input.suspended ? "suspended" : "matched" };
}

export function rewardsExecutionEnabled(input: {
  loopEnabled: string | null;
  executionAuthorised: string | null;
  suspended: boolean;
}): boolean {
  return input.loopEnabled === "true" && input.executionAuthorised === "true" && !input.suspended;
}

export function signInspected(input: {
  secret: string;
  expectedAddress: string;
  suspended: boolean;
  transaction: CompiledTransaction;
  policy: SignPolicy;
}): { ok: true; signature: string; message: Uint8Array } | { ok: false; code: "destination" | "identity" | "parent" | "program" | "signer_malformed" | "signer_mismatch" | "signer_unbound" | "spend" | "suspended" | "transaction" } {
  const inspection = inspectDeployerSigner({
    secret: input.secret,
    expectedAddress: input.expectedAddress,
    suspended: input.suspended,
  });
  if (!inspection.ok) return inspection;
  if (inspection.signer === "suspended") return { ok: false, code: "suspended" };
  if (inspection.signer !== "matched" || canonicalAddress(input.policy.deployer) !== canonicalAddress(input.expectedAddress)) {
    return { ok: false, code: "signer_mismatch" };
  }
  const inspected = inspectRewardsTransaction(input.transaction, input.policy);
  if (!inspected.ok) return inspected;
  let bytes: Uint8Array | null = null;
  try {
    bytes = bs58.decode(input.secret);
    const signature = nacl.sign.detached(inspected.message, bytes);
    return { ok: true, signature: bs58.encode(signature), message: inspected.message };
  } catch {
    return { ok: false, code: "signer_malformed" };
  } finally {
    bytes?.fill(0);
  }
}

export function rewardsHealth(signer: SignerState, active = false): {
  ok: true;
  service: "rewards-worker";
  signer: SignerState;
  signing: false;
  broadcasts: boolean;
  loop: boolean;
  executionAuthorised: boolean;
} {
  return {
    ok: true,
    service: "rewards-worker",
    signer,
    signing: false,
    broadcasts: active,
    loop: active,
    executionAuthorised: active,
  };
}
