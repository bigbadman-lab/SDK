import type { SubmissionStatus } from "./submission.ts";

export const TREST_MINT = "BRQG5CuAX3MuJYwmTWL7KvmPSB6kkR3Y5eHup5W1pump";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const SLOT = /^(0|[1-9][0-9]{0,18})$/;
const MAX_SLOT = BigInt("9223372036854775807");

export type ParentSymbol = "SDK" | "TREST";
export type LaunchScope = "production" | "test";

export type VerificationStamp = {
  status: SubmissionStatus;
  slot: string | null;
  verifiedAtMs: number | null;
  attemptStatus: "verified" | null;
};

export function pairLabel(input: { scope: LaunchScope; symbol: ParentSymbol | null }): "$SDK" | "$TREST" | null {
  if (input.scope === "test" && input.symbol === "TREST") return "$TREST";
  if (input.scope === "production" && input.symbol === "SDK") return "$SDK";
  return null;
}

export function audiencePair(rehearsal: boolean): { scope: LaunchScope; symbol: ParentSymbol; label: "$SDK" | "$TREST" } {
  return rehearsal
    ? { scope: "test", symbol: "TREST", label: "$TREST" }
    : { scope: "production", symbol: "SDK", label: "$SDK" };
}

function validSlot(value: string | null): string | null {
  if (!value || !SLOT.test(value)) return null;
  if (BigInt(value) > MAX_SLOT) return null;
  return value;
}

export function verificationStamp(input: {
  status: SubmissionStatus;
  evidenceSlot: string | null;
  nowMs: number;
  storedSlot: string | null;
  storedVerifiedAtMs: number | null;
}): VerificationStamp {
  const claimsVerified = input.status === "verified" || input.status === "page_ready";
  if (!claimsVerified) {
    return {
      status: input.status,
      slot: input.storedSlot,
      verifiedAtMs: input.storedVerifiedAtMs,
      attemptStatus: null,
    };
  }
  const slot = validSlot(input.storedSlot) ?? validSlot(input.evidenceSlot);
  if (!slot || !Number.isFinite(input.nowMs)) {
    return { status: "verifying", slot: null, verifiedAtMs: null, attemptStatus: null };
  }
  return {
    status: input.status,
    slot,
    verifiedAtMs: input.storedVerifiedAtMs ?? input.nowMs,
    attemptStatus: "verified",
  };
}

export type VerifiedLaunch = {
  childMint: string;
  parentMint: string;
  scope: LaunchScope;
  pairLabel: "$SDK" | "$TREST";
  parentSymbol: ParentSymbol;
  name: string;
  symbol: string;
  imageUrl: string | null;
  sdkName: string;
  sdkHref: string | null;
  creator: string;
  originatorLabel: string;
  verifiedAt: string;
  signature: string;
  slot: string;
};

export type VerifiedLaunchSource = {
  status: string;
  slot: string | null;
  verifiedAt: string | null;
  scope: LaunchScope;
  parentSymbol: ParentSymbol | null;
  childMint: string;
  parentMint: string;
  name: string;
  symbol: string;
  imageUrl: string | null;
  sdkName: string;
  librarySdkId: string | null;
  creator: string;
  originatorLabel: string;
  signature: string;
};

export function presentVerifiedLaunch(source: VerifiedLaunchSource): VerifiedLaunch | null {
  if (source.status !== "verified" && source.status !== "page_ready") return null;
  const slot = validSlot(source.slot);
  if (!slot || !source.verifiedAt) return null;
  const verifiedAt = new Date(source.verifiedAt);
  if (Number.isNaN(verifiedAt.getTime())) return null;
  const label = pairLabel({ scope: source.scope, symbol: source.parentSymbol });
  if (!label || !source.parentSymbol) return null;
  const image = source.imageUrl?.startsWith("https://") ? source.imageUrl : null;
  return {
    childMint: source.childMint,
    parentMint: source.parentMint,
    scope: source.scope,
    pairLabel: label,
    parentSymbol: source.parentSymbol,
    name: source.name,
    symbol: source.symbol,
    imageUrl: image,
    sdkName: source.sdkName,
    sdkHref: source.librarySdkId ? `/library/${source.librarySdkId}` : null,
    creator: source.creator,
    originatorLabel: source.originatorLabel,
    verifiedAt: verifiedAt.toISOString(),
    signature: source.signature,
    slot,
  };
}

export function uniqueLaunches(launches: readonly VerifiedLaunch[]): VerifiedLaunch[] {
  const seen = new Set<string>();
  const unique: VerifiedLaunch[] = [];
  for (const launch of launches) {
    if (seen.has(launch.childMint)) continue;
    seen.add(launch.childMint);
    unique.push(launch);
  }
  return unique;
}

export function launchesForCreator(launches: readonly VerifiedLaunch[], creator: string): VerifiedLaunch[] {
  return uniqueLaunches(launches.filter((launch) => launch.creator === creator));
}

export function launchByMint(launches: readonly VerifiedLaunch[], mint: string): VerifiedLaunch | null {
  return uniqueLaunches(launches).find((launch) => launch.childMint === mint) ?? null;
}

export function shortenAddress(address: string): string {
  if (address.length < 8) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function explorerUrl(value: string, kind: "address" | "tx" = "address"): string {
  return `https://explorer.solana.com/${kind}/${value}`;
}

export function formatVerifiedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}
