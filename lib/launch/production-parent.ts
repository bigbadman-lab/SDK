import { TREST_MINT, TOKEN_2022_PROGRAM } from "./verified-launch.ts";
import type { ParentObservation } from "./parent.ts";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const PROGRAMS = new Set([TOKEN_PROGRAM, TOKEN_2022_PROGRAM]);

export function acceptCanonicalLaunchParent(input: {
  configMint: string | null;
  configProgram: string | null;
  configDecimals: number | null;
  observed: ParentObservation | null;
  buildParentMint: string | null;
}): { ok: true; mint: string } | { ok: false; code: "parent_unregistered" | "parent_ineligible" } {
  const mint = input.configMint;
  if (!mint || mint === TREST_MINT) return { ok: false, code: "parent_unregistered" };
  if (!input.buildParentMint || input.buildParentMint !== mint || input.buildParentMint === TREST_MINT) {
    return { ok: false, code: "parent_unregistered" };
  }
  const observed = input.observed;
  if (!observed) return { ok: false, code: "parent_ineligible" };
  if (observed.mint !== mint || observed.mint === TREST_MINT) return { ok: false, code: "parent_ineligible" };
  if (observed.source !== "pumpCoin" || observed.mayhem || observed.cashback) {
    return { ok: false, code: "parent_ineligible" };
  }
  if (input.configProgram !== observed.tokenProgram || !PROGRAMS.has(observed.tokenProgram)) {
    return { ok: false, code: "parent_ineligible" };
  }
  if (
    input.configDecimals === null ||
    input.configDecimals !== observed.decimals ||
    observed.decimals < 0 ||
    observed.decimals > 9
  ) {
    return { ok: false, code: "parent_ineligible" };
  }
  return { ok: true, mint };
}
