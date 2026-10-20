export type LinkState = "ok" | "unavailable" | "unchecked";

export type BuilderLinkReport = {
  configured: boolean;
  database: LinkState;
  rpc: LinkState;
  parent: "registered" | "unregistered";
  building: boolean;
  signing: false;
  broadcast: false;
};

const BUILD_CODES = new Set([
  "allocation",
  "body",
  "builder_rejected",
  "builder_unconfigured",
  "buy",
  "buy_unpriceable",
  "conflict",
  "coverage",
  "fee_sharing",
  "lineage",
  "mayhem",
  "mint",
  "not_found",
  "not_ready",
  "order",
  "parent_ineligible",
  "parent_unregistered",
  "program",
  "quote",
  "simulation_failed",
  "size",
  "signer",
  "slippage",
  "transaction_too_large",
  "unavailable",
  "version",
]);

function linkState(value: unknown): LinkState | null {
  if (value === "ok" || value === "unavailable" || value === "unchecked") return value;
  return null;
}

export function readBuilderLinkReport(
  value: unknown,
): { ok: true; report: BuilderLinkReport } | { ok: false; code: "builder_rejected" } {
  if (!value || typeof value !== "object") return { ok: false, code: "builder_rejected" };
  const body = value as Record<string, unknown>;
  const database = linkState(body.database);
  const rpc = linkState(body.rpc);
  if (body.ok !== true || !database || !rpc) return { ok: false, code: "builder_rejected" };
  if (body.parent !== "registered" && body.parent !== "unregistered") {
    return { ok: false, code: "builder_rejected" };
  }
  if (typeof body.configured !== "boolean" || typeof body.building !== "boolean") {
    return { ok: false, code: "builder_rejected" };
  }
  if (body.signing !== false || body.broadcast !== false) {
    return { ok: false, code: "builder_rejected" };
  }
  if (body.building && (body.parent !== "registered" || database !== "ok" || rpc !== "ok")) {
    return { ok: false, code: "builder_rejected" };
  }
  return {
    ok: true,
    report: {
      configured: body.configured,
      database,
      rpc,
      parent: body.parent,
      building: body.building,
      signing: false,
      broadcast: false,
    },
  };
}

export function builderFailureCode(value: unknown): string {
  if (!value || typeof value !== "object" || !("code" in value)) return "builder_rejected";
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" && BUILD_CODES.has(code) ? code : "builder_rejected";
}
