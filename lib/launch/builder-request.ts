const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const BUILD_PATH = "/v1/build";
export const INSPECT_PATH = "/v1/inspect";
export const DIAGNOSE_PATH = "/v1/diagnose";
export const PARENT_PATH = "/v1/parent";
export const EVIDENCE_PATH = "/v1/evidence";

export type UnsignedBuildRequest = {
  launchId: string;
  idempotencyKey: string;
  mintPublicKey: string;
};

const KEYS = ["idempotencyKey", "launchId", "mintPublicKey"] as const;

export function parseUnsignedBuildRequest(
  value: unknown,
): { ok: true; value: UnsignedBuildRequest } | { ok: false; code: "body" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: "body" };
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== KEYS.join(",")) {
    return { ok: false, code: "body" };
  }
  const { launchId, idempotencyKey, mintPublicKey } = record;
  if (typeof launchId !== "string" || !UUID.test(launchId)) {
    return { ok: false, code: "body" };
  }
  if (typeof idempotencyKey !== "string" || !UUID.test(idempotencyKey)) {
    return { ok: false, code: "body" };
  }
  if (typeof mintPublicKey !== "string" || !ADDRESS.test(mintPublicKey)) {
    return { ok: false, code: "body" };
  }
  return { ok: true, value: { launchId, idempotencyKey, mintPublicKey } };
}

const LAUNCHER_KEYS = ["launchId", "mintPublicKey"] as const;

export function parseLauncherBuildRequest(
  value: unknown,
): { ok: true; value: { launchId: string; mintPublicKey: string } } | { ok: false; code: "body" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: "body" };
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== LAUNCHER_KEYS.join(",")) {
    return { ok: false, code: "body" };
  }
  const { launchId, mintPublicKey } = record;
  if (typeof launchId !== "string" || !UUID.test(launchId)) return { ok: false, code: "body" };
  if (typeof mintPublicKey !== "string" || !ADDRESS.test(mintPublicKey)) {
    return { ok: false, code: "body" };
  }
  return { ok: true, value: { launchId, mintPublicKey } };
}

export function parseParentObservationRequest(
  value: unknown,
): { ok: true; mint: string } | { ok: false; code: "body" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "body" };
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "mint") return { ok: false, code: "body" };
  if (typeof record.mint !== "string" || !ADDRESS.test(record.mint)) return { ok: false, code: "body" };
  return { ok: true, mint: record.mint };
}

const EVIDENCE_KEYS = ["childMint", "signature"] as const;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

export function parseEvidenceRequest(
  value: unknown,
): { ok: true; signature: string; childMint: string } | { ok: false; code: "body" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "body" };
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== EVIDENCE_KEYS.join(",")) return { ok: false, code: "body" };
  if (typeof record.signature !== "string" || !SIGNATURE.test(record.signature)) return { ok: false, code: "body" };
  if (typeof record.childMint !== "string" || !ADDRESS.test(record.childMint)) return { ok: false, code: "body" };
  return { ok: true, signature: record.signature, childMint: record.childMint };
}

const REHEARSAL_KEYS = ["idempotencyKey", "launchId", "mintPublicKey", "scope"] as const;

export function parseRehearsalBuildRequest(
  value: unknown,
): { ok: true; value: UnsignedBuildRequest } | { ok: false; code: "body" } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "body" };
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== REHEARSAL_KEYS.join(",")) return { ok: false, code: "body" };
  if (record.scope !== "test") return { ok: false, code: "body" };
  return parseUnsignedBuildRequest({
    launchId: record.launchId,
    idempotencyKey: record.idempotencyKey,
    mintPublicKey: record.mintPublicKey,
  });
}

export function unsignedBuildAccepted(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    body.ok === true &&
    body.authorized === false &&
    body.sigVerify === false &&
    body.coverage === "live" &&
    body.transactionVersion === 1 &&
    body.encoding === "base64" &&
    typeof body.messageHash === "string" &&
    typeof body.transaction === "string" &&
    body.transaction.length > 0
  );
}
