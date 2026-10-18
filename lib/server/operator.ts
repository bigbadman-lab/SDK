import "server-only";

import { canonicalAddress } from "@/lib/auth/solana";
import { readOptionalEnv } from "@/lib/server/env";

export function isProvisionedOperator(walletAddress: string): boolean {
  const configured = readOptionalEnv("OPERATOR_WALLET_ADDRESS");
  if (!configured) return false;
  const expected = canonicalAddress(configured);
  const actual = canonicalAddress(walletAddress);
  if (!expected || !actual) return false;
  return expected === actual;
}
