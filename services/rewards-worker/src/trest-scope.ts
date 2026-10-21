import { canonicalAddress } from "../../../lib/auth/solana.ts";
import { createSql } from "./postgres.ts";

type Sql = ReturnType<typeof createSql>;

export type TrestParentRow = {
  scope: string;
  symbol: string;
  mintAddress: string;
  deployerAddress: string;
  feeRecipientAddress: string;
  feeMode: string;
  eligible: boolean;
};

export type VerifiedTrestParent = {
  ok: true;
  mintAddress: string;
  deployerAddress: string;
};

export type TrestParentDecision = VerifiedTrestParent | { ok: false; code: "parent" };

export function resolveTrestParent(rows: readonly TrestParentRow[], expectedAddress: string): TrestParentDecision {
  const expected = canonicalAddress(expectedAddress);
  if (!expected) return { ok: false, code: "parent" };
  const matches = rows.filter((row) => {
    const mint = canonicalAddress(row.mintAddress);
    const deployer = canonicalAddress(row.deployerAddress);
    const recipient = canonicalAddress(row.feeRecipientAddress);
    return row.scope === "test"
      && row.symbol === "TREST"
      && row.feeMode === "single_recipient"
      && row.eligible === true
      && mint !== null
      && deployer === expected
      && recipient === expected;
  });
  const mints = new Set(matches.map((row) => canonicalAddress(row.mintAddress)));
  const mint = matches[0] ? canonicalAddress(matches[0].mintAddress) : null;
  if (matches.length !== 1 || mints.size !== 1 || !mint) return { ok: false, code: "parent" };
  return { ok: true, mintAddress: mint, deployerAddress: expected };
}

export async function loadVerifiedTrestParent(sql: Sql, expectedAddress: string): Promise<TrestParentDecision> {
  try {
    const rows = await sql<TrestParentRow[]>`
      select scope,
             symbol,
             mint_address as "mintAddress",
             deployer_address as "deployerAddress",
             fee_recipient_address as "feeRecipientAddress",
             fee_mode as "feeMode",
             eligible
      from parent_registrations
      where scope = 'test' and symbol = 'TREST'
    `;
    return resolveTrestParent(rows, expectedAddress);
  } catch {
    return { ok: false, code: "parent" };
  }
}

export function selectTrestChildren<T extends { mint: string; quoteMint: string; scope: string }>(
  parent: TrestParentDecision,
  rows: readonly T[],
): T[] {
  if (!parent.ok) return [];
  return rows.filter((row) => {
    const mint = canonicalAddress(row.mint);
    const quote = canonicalAddress(row.quoteMint);
    return row.scope === "test" && mint !== null && quote === parent.mintAddress;
  });
}

export function selectTrestOpenIntents<T extends { scope: string; quoteMint: string; childMint: string }>(
  parent: TrestParentDecision,
  children: readonly { mint: string }[],
  rows: readonly T[],
): T[] {
  if (!parent.ok) return [];
  const allowed = new Set(children.flatMap((child) => {
    const mint = canonicalAddress(child.mint);
    return mint ? [mint] : [];
  }));
  return rows.filter((row) => {
    const child = canonicalAddress(row.childMint);
    const quote = canonicalAddress(row.quoteMint);
    return row.scope === "test" && child !== null && quote === parent.mintAddress && allowed.has(child);
  });
}

export function selectTrestClaims<T extends { scope: string; parentMint: string }>(
  parent: TrestParentDecision,
  rows: readonly T[],
): T[] {
  if (!parent.ok) return [];
  return rows.filter((row) => row.scope === "test" && canonicalAddress(row.parentMint) === parent.mintAddress);
}

export function trestClaimAllowed(parent: TrestParentDecision, claim: { scope: string; parentMint: string }): boolean {
  return selectTrestClaims(parent, [claim]).length === 1;
}
