import bs58 from "bs58";

import { canonicalAddress } from "./solana.ts";

export type SignFailure = "rejected" | "unsupported" | "disconnected" | "blocked" | "failed";

export type WalletSigner = {
  signMessage: (message: Uint8Array, display?: "utf8") => Promise<unknown>;
};

export function encodeSignInMessage(message: string): Uint8Array {
  return new TextEncoder().encode(message);
}

function byteView(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

export function normalizeWalletSignature(value: unknown): Uint8Array | null {
  const direct = byteView(value);
  if (direct?.byteLength === 64) return direct;
  if (typeof value === "string") {
    try {
      const decoded = bs58.decode(value);
      return decoded.byteLength === 64 ? decoded : null;
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && value !== null && "signature" in value) {
    return normalizeWalletSignature(value.signature);
  }
  return null;
}

export function signingAccountMatches(
  displayedAddress: string,
  providerAddress: string | null,
): boolean {
  if (!providerAddress) return false;
  const displayed = canonicalAddress(displayedAddress);
  const provider = canonicalAddress(providerAddress);
  return displayed !== null && displayed === provider;
}

function errorParts(error: unknown): string {
  if (typeof error !== "object" || error === null) return "";
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message) : "";
  const code = "code" in error ? String(error.code) : "";
  const cause =
    "cause" in error && error.cause && error.cause !== error
      ? errorParts(error.cause)
      : "";
  return `${name} ${message} ${code} ${cause}`;
}

export function describeSignFailure(error: unknown): SignFailure {
  const text = errorParts(error);
  if (
    text.includes("UserRejectedRequestError") ||
    text.includes("User rejected") ||
    text.includes("4001")
  ) {
    return "rejected";
  }
  if (
    text.includes("FeatureNotSupported") ||
    text.includes("not supported") ||
    text.includes("invalid formatting") ||
    text.includes("Invalid Input")
  ) {
    return "unsupported";
  }
  if (
    text.includes("WalletWindowBlockedError") ||
    text.includes("WalletNotReadyError") ||
    text.includes("WalletLoadError")
  ) {
    return "blocked";
  }
  if (
    text.includes("WalletAccountError") ||
    text.includes("Account not found") ||
    text.includes("Wallet not connected") ||
    text.includes("provider is undefined")
  ) {
    return "disconnected";
  }
  return "failed";
}

export function signFailureNotice(failure: SignFailure): string {
  switch (failure) {
    case "rejected":
      return "The wallet request was declined.";
    case "unsupported":
      return "This wallet cannot sign a message.";
    case "disconnected":
      return "The connected account is not available for signing.";
    case "blocked":
      return "The wallet did not open. Click Sign in wallet again.";
    case "failed":
      return "The wallet could not sign the request.";
  }
}

// The first provider is the connected AppKit wallet. Later providers are injected
// wallets for the same account, used only when the first one throws before a
// signature exists. A rejection stops the search so a second wallet cannot pop up.
export async function requestWalletSignature(
  providers: readonly WalletSigner[],
  message: Uint8Array,
): Promise<unknown> {
  let failure: unknown = new Error("missing");
  for (const provider of providers) {
    try {
      return await provider.signMessage.call(provider, message, "utf8");
    } catch (error) {
      failure = error;
      if (describeSignFailure(error) === "rejected") throw error;
    }
  }
  throw failure;
}
