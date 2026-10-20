import { matchTrustedOrigin } from "./site-origin.ts";

const NAVIGATION_SITES = new Set(["same-origin", "same-site", "none"]);

export type DiagnosticAccount = {
  walletAddress: string;
};

export type DiagnosticDecision =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403; code: "origin" | "unauthenticated" | "forbidden" };

export function authorizeBuilderDiagnostic(input: {
  origin: string | null;
  host: string | null;
  secFetchSite: string | null;
  configuredAppUrl: string | null;
  account: DiagnosticAccount | null;
  operator: boolean;
}): DiagnosticDecision {
  const trusted = matchTrustedOrigin(input.origin, input.host, input.configuredAppUrl) !== null;
  const site = input.secFetchSite;
  const navigation =
    trusted || (!input.origin && (site === null || NAVIGATION_SITES.has(site)));
  if (!navigation) return { ok: false, status: 400, code: "origin" };
  if (!input.account) return { ok: false, status: 401, code: "unauthenticated" };
  if (!input.operator) return { ok: false, status: 403, code: "forbidden" };
  return { ok: true };
}
