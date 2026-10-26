import { TREST_MINT } from "@/lib/launch/verified-launch";
import { getCurrentAccount } from "@/lib/server/account";
import { databaseFailure, getSql } from "@/lib/server/db";
import { readPublicLaunchGate } from "@/lib/server/launch/gate";
import { launchJson } from "@/lib/server/launch/response";
import { simulateExactWire } from "@/lib/server/launch/simulate-wire";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<Response> {
  if (!trustedOrigin(request)) return launchJson({ ok: false, code: "origin", submitted: false }, 400);
  const account = await getCurrentAccount();
  if (!account) return launchJson({ ok: false, code: "unauthenticated", submitted: false }, 401);
  const gate = await readPublicLaunchGate();
  if (!gate.open || !gate.mint || gate.mint === TREST_MINT) {
    const code = gate.availability === "unavailable" ? "unavailable" : "closed";
    return launchJson({ ok: false, code, submitted: false }, code === "unavailable" ? 503 : 403);
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return launchJson({ ok: false, code: "body", submitted: false }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return launchJson({ ok: false, code: "body", submitted: false }, 400);
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => ["parent", "scope", "transaction", "quotemint"].includes(key.toLowerCase()))) {
    return launchJson({ ok: false, code: "parent_scope", submitted: false }, 400);
  }
  if (typeof record.launchId !== "string" || !UUID.test(record.launchId)) {
    return launchJson({ ok: false, code: "body", submitted: false }, 400);
  }
  if (typeof record.buildId !== "string" || !UUID.test(record.buildId)) {
    return launchJson({ ok: false, code: "body", submitted: false }, 400);
  }
  try {
    const rows = await getSql()<{ transaction: string; message_hash: string }[]>`
      select b.transaction, b.message_hash
      from launch_builds b
      join token_launches l on l.id = b.launch_id
      join sdk_parent_config config on config.id = 1
      where b.id = ${record.buildId}
        and b.launch_id = ${record.launchId}
        and b.account_id = ${account.id}
        and l.parent_scope = 'production'
        and l.parent_mint_address is null
        and b.parent_mint_address = config.mint_address
        and config.mint_address = ${gate.mint}
        and config.launches_active = true
        and config.mint_address <> ${TREST_MINT}
    `;
    const row = rows[0];
    if (!row) return launchJson({ ok: false, code: "not_found", submitted: false }, 404);
    const simulated = await simulateExactWire({ transaction: row.transaction, committedHash: row.message_hash });
    if (!simulated.ok) {
      const status = simulated.code === "unavailable" ? 503 : 422;
      return launchJson({ ok: false, code: simulated.code, submitted: false }, status);
    }
    return launchJson({ ok: true, simulated: true, submitted: false, messageHash: simulated.messageHash });
  } catch (error) {
    const code = databaseFailure(error) === "missing_schema" ? "not_ready" : "unavailable";
    return launchJson({ ok: false, code, submitted: false }, 503);
  }
}
