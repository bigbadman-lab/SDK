import { publicRecoveryAdmission } from "@/lib/launch/public-gate";
import { launchMessage } from "@/lib/launch/messages";
import { getCurrentAccount } from "@/lib/server/account";
import { readPublicLaunchGate } from "@/lib/server/launch/gate";
import { launchJson } from "@/lib/server/launch/response";
import { recoverSignedLaunch } from "@/lib/server/launch/submit";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

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
  if (Object.keys(record).some((key) => ["parent", "scope", "transaction", "signature"].includes(key.toLowerCase()))) {
    return launchJson({ ok: false, code: "parent_scope", broadcast: false }, 400);
  }
  if (typeof record.launchId !== "string" || !UUID.test(record.launchId)) {
    return launchJson({ ok: false, code: "body", broadcast: false }, 400);
  }
  const gate = await readPublicLaunchGate();
  const result = await recoverSignedLaunch({
    accountId: account.id,
    launchId: record.launchId,
  });
  if (!result.ok && result.code === "not_found") {
    if (gate.availability === "unavailable") {
      return launchJson({ ok: false, code: "unavailable", broadcast: false }, 503);
    }
    const admission = publicRecoveryAdmission({ gateOpen: gate.open, submissionFound: false });
    if (admission === "closed") return launchJson({ ok: false, code: "closed", broadcast: false }, 403);
    return launchJson({ ok: false, code: "not_found", broadcast: false }, 404);
  }
  if (!result.ok) {
    const status = result.code === "forbidden" ? 403 : result.code === "not_found" ? 404 : result.code === "not_ready" ? 503 : 422;
    return launchJson({ ok: false, code: result.code, broadcast: false }, status);
  }
  return launchJson({
    ok: true,
    code: result.status,
    broadcast: result.broadcast,
    signature: result.signature,
    childMint: result.childMint,
    parentMint: result.parentMint,
    buyAmount: result.buyAmount,
    shareholders: result.shareholders,
  });
}
