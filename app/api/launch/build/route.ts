import { builderFailureCode } from "@/lib/launch/builder-probe";
import { publicLaunchScope } from "@/lib/launch/parent-scope";
import { launchMessage } from "@/lib/launch/messages";
import { getCurrentAccount } from "@/lib/server/account";
import { readPublicLaunchGate } from "@/lib/server/launch/gate";
import { launchJson } from "@/lib/server/launch/response";
import { requestUnsignedBuild } from "@/lib/server/launch/unsigned";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

function statusFor(code: string): number {
  if (code === "not_found") return 404;
  if (code === "conflict") return 409;
  if (code === "closed") return 403;
  if (code === "not_ready" || code === "simulation_failed" || code === "lineage" || code === "slippage") {
    return 422;
  }
  if (
    code === "builder_unconfigured" ||
    code === "parent_unregistered" ||
    code === "parent_ineligible" ||
    code === "unavailable"
  ) {
    return 503;
  }
  if (code === "body" || code === "mint" || code === "parent_scope") return 400;
  return 502;
}

export async function POST(request: Request): Promise<Response> {
  if (!trustedOrigin(request)) {
    return launchJson({ ok: false, code: "origin" }, 400);
  }
  const account = await getCurrentAccount();
  if (!account) {
    return launchJson(
      { ok: false, error: launchMessage("unauthenticated"), code: "unauthenticated" },
      401,
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return launchJson({ ok: false, error: launchMessage("body"), code: "body" }, 400);
  }
  if (request.headers.get("x-sdk-rehearsal") === "trest") {
    return launchJson({ ok: false, error: launchMessage("parent_scope"), code: "parent_scope" }, 403);
  }
  const parsed = publicLaunchScope(body);
  if (!parsed.ok) {
    return launchJson({ ok: false, error: launchMessage(parsed.code), code: parsed.code }, 400);
  }
  const gate = await readPublicLaunchGate();
  if (!gate.open) {
    const code = gate.availability === "unavailable" ? "unavailable" : "closed";
    return launchJson({ ok: false, error: launchMessage(code), code }, statusFor(code));
  }
  const result = await requestUnsignedBuild({
    accountId: account.id,
    launchId: parsed.launchId,
    mintPublicKey: parsed.mintPublicKey,
  });
  if (!result.ok) {
    const code = result.code === "closed" || result.code === "parent_scope"
      ? result.code
      : builderFailureCode({ code: result.code });
    return launchJson({ ok: false, error: launchMessage(code), code }, statusFor(code));
  }
  return launchJson(result.body);
}
