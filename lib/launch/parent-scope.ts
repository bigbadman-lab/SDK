import { parseLauncherBuildRequest } from "./builder-request.ts";

const SUBSTITUTIONS = new Set([
  "deployer",
  "feemode",
  "parent",
  "parentmint",
  "parentmintaddress",
  "quote",
  "quotemint",
  "scope",
  "symbol",
]);

export type ParentBinding = {
  parentMint: string;
  scope: "production" | "test";
};

export function publicLaunchScope(
  value: unknown,
):
  | { ok: true; scope: "production"; launchId: string; mintPublicKey: string }
  | { ok: false; code: "body" | "parent_scope" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "body" };
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (SUBSTITUTIONS.has(key.toLowerCase())) return { ok: false, code: "parent_scope" };
  }
  const parsed = parseLauncherBuildRequest(value);
  if (!parsed.ok) return { ok: false, code: "body" };
  return { ok: true, scope: "production", launchId: parsed.value.launchId, mintPublicKey: parsed.value.mintPublicKey };
}

export function selectLaunchParent(input: {
  audience: "public" | "operator";
  requestedScope: "production" | "test" | null;
  requestedMint: string | null;
  productionMint: string | null;
  testParent: { mint: string; scope: "test"; eligible: boolean } | null;
}):
  | { ok: true; scope: "production"; mint: string | null; executes: false }
  | { ok: true; scope: "test"; mint: string; executes: false }
  | { ok: false; code: "parent_ineligible" | "parent_scope" | "production_parent" } {
  if (input.audience === "public") {
    if (input.requestedScope !== null || input.requestedMint !== null) {
      return { ok: false, code: "parent_scope" };
    }
    return { ok: true, scope: "production", mint: input.productionMint, executes: false };
  }
  if (input.requestedScope !== "test") {
    return { ok: true, scope: "production", mint: input.productionMint, executes: false };
  }
  if (input.requestedMint && input.productionMint && input.requestedMint === input.productionMint) {
    return { ok: false, code: "production_parent" };
  }
  const testParent = input.testParent;
  if (!testParent || !testParent.eligible || testParent.scope !== "test" || testParent.mint !== input.requestedMint) {
    return { ok: false, code: "parent_ineligible" };
  }
  return { ok: true, scope: "test", mint: testParent.mint, executes: false };
}

export function bindLaunchParent(
  existing: ParentBinding | null,
  next: ParentBinding,
): { ok: true; binding: ParentBinding } | { ok: false; code: "parent_immutable" } {
  if (existing && (existing.parentMint !== next.parentMint || existing.scope !== next.scope)) {
    return { ok: false, code: "parent_immutable" };
  }
  return { ok: true, binding: { parentMint: next.parentMint, scope: next.scope } };
}
