import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";

export function canonicalAddress(input: string): string | null {
  try {
    const key = new PublicKey(input);
    if (key.toBytes().byteLength !== 32) return null;
    return key.toBase58();
  } catch {
    return null;
  }
}

export function verifySolanaSignature(
  address: string,
  message: string,
  signature: Uint8Array,
): boolean {
  try {
    const key = new PublicKey(address);
    if (signature.byteLength !== 64) return false;
    return nacl.sign.detached.verify(
      new TextEncoder().encode(message),
      signature,
      key.toBytes(),
    );
  } catch {
    return false;
  }
}

export function decodeSignature(value: string): Uint8Array | null {
  try {
    const bytes = bs58.decode(value);
    return bytes.byteLength === 64 ? bytes : null;
  } catch {
    return null;
  }
}
