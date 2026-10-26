import { launchMessage } from "@/lib/launch/messages";
import { getCurrentAccount } from "@/lib/server/account";
import { readPublicLaunchGate } from "@/lib/server/launch/gate";
import { launchJson } from "@/lib/server/launch/response";
import { submitSignedLaunch } from "@/lib/server/launch/submit";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

const SUBSTITUTIONS = ["parent", "parentmint", "quotemint", "scope", "symbol", "deployer", "shareholders", "feebps"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<Response> {
  if (!trustedOrigin(request)) {
    return launchJson({ ok: false, code: "origin", broadcast: false }, 400);
  }
  const account = await getCurrentAccount();
  if (!account) {
    return launchJson(
      { ok: false, error: launchMessage("unauthenticated"), code: "unauthenticated", broadcast: false },
      401,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return launchJson({ ok: false, code: "body", broadcast: false }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return launchJson({ ok: false, code: "body", broadcast: false }, 400);
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => SUBSTITUTIONS.includes(key.toLowerCase()))) {
    return launchJson({ ok: false, code: "parent_scope", broadcast: false }, 400);
  }
  if (typeof record.launchId !== "string" || !UUID.test(record.launchId)) {
    return launchJson({ ok: false, code: "body", broadcast: false }, 400);
  }
  if (typeof record.buildId !== "string" || !UUID.test(record.buildId)) {
    return launchJson({ ok: false, code: "body", broadcast: false }, 400);
  }
  if (typeof record.transaction !== "string" || record.transaction.length < 16) {
    return launchJson({ ok: false, code: "body", broadcast: false }, 400);
  }
  const gate = await readPublicLaunchGate();
  if (!gate.open) {
    const code = gate.availability === "unavailable" ? "unavailable" : "closed";
    const status = code === "unavailable" ? 503 : 403;
    return launchJson({ ok: false, code, broadcast: false }, status);
  }
  const transaction = Buffer.from(record.transaction, "base64");
  if (transaction.byteLength < 1) {
    return launchJson({ ok: false, code: "body", broadcast: false }, 400);
  }
  const result = await submitSignedLaunch({
    accountId: account.id,
    launchId: record.launchId,
    buildId: record.buildId,
    transaction,
  });
  if (!result.ok) {
    const status = result.code === "unauthenticated" ? 401 : result.code === "forbidden" ? 403 : result.code === "not_ready" ? 503 : 422;
    return launchJson({ ok: false, code: result.code, broadcast: false }, status);
  }
  return launchJson({
    ok: result.status !== "failed",
    code: result.status,
    broadcast: result.broadcast,
    signature: result.signature,
  });
}
