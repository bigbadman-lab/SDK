export type LaunchEvidence = {
  transactionStatus: "confirmed" | "failed" | "missing" | "uncertain";
  transactionError: boolean | null;
  slot: string | null;
  mintExists: boolean | null;
  tokenProgram: string | null;
  quoteMint: string | null;
  launcher: string | null;
  metadataUri: string | null;
  shareholders: readonly { address: string; shareBps: number }[] | null;
  adminRevoked: boolean | null;
  buyExecuted: boolean | null;
};

export type LaunchCommitment = {
  childMint: string;
  parentMint: string;
  launcher: string;
  tokenProgram: string;
  metadataUri: string;
  buyAmount: string;
  shareholders: readonly { address: string; shareBps: number }[];
};

export type VerificationVerdict = {
  verified: boolean;
  failed: boolean;
  missing: string[];
};

function sameShareholders(
  left: readonly { address: string; shareBps: number }[],
  right: readonly { address: string; shareBps: number }[],
): boolean {
  const key = (rows: readonly { address: string; shareBps: number }[]) =>
    [...rows].map((row) => `${row.address}:${row.shareBps}`).sort().join(",");
  return key(left) === key(right);
}

export function verifyLaunchEvidence(commitment: LaunchCommitment, evidence: LaunchEvidence): VerificationVerdict {
  if (evidence.transactionStatus === "uncertain" || evidence.transactionStatus === "missing") {
    return { verified: false, failed: false, missing: ["transaction"] };
  }
  if (evidence.transactionStatus === "failed" || evidence.transactionError === true) {
    return { verified: false, failed: true, missing: [] };
  }
  const missing: string[] = [];
  const mismatches: string[] = [];
  if (evidence.mintExists !== true) missing.push("child_mint");
  if (!evidence.tokenProgram) missing.push("token_program");
  else if (evidence.tokenProgram !== commitment.tokenProgram) mismatches.push("token_program");
  if (!evidence.quoteMint) missing.push("parent");
  else if (evidence.quoteMint !== commitment.parentMint) mismatches.push("parent");
  if (!evidence.launcher) missing.push("launcher");
  else if (evidence.launcher !== commitment.launcher) mismatches.push("launcher");
  if (!evidence.metadataUri) missing.push("metadata");
  else if (evidence.metadataUri !== commitment.metadataUri) mismatches.push("metadata");
  if (!evidence.shareholders) missing.push("shareholders");
  else if (!sameShareholders(evidence.shareholders, commitment.shareholders)) mismatches.push("shareholders");
  if (evidence.adminRevoked === null) missing.push("admin");
  else if (evidence.adminRevoked !== true) mismatches.push("admin");
  const buyExpected = commitment.buyAmount !== "0";
  if (evidence.buyExecuted === null) missing.push("buy");
  else if (evidence.buyExecuted !== buyExpected) mismatches.push("buy");
  if (!evidence.slot) missing.push("slot");
  if (mismatches.length > 0) return { verified: false, failed: true, missing: mismatches };
  if (missing.length > 0) return { verified: false, failed: false, missing };
  return { verified: true, failed: false, missing: [] };
}
