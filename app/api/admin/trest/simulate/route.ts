import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { databaseFailure, getSql } from "@/lib/server/db";
import { simulateExactWire } from "@/lib/server/launch/simulate-wire";
import { isProvisionedOperator } from "@/lib/server/operator";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<NextResponse> {
  if (!trustedOrigin(request)) return NextResponse.json({ ok: false, code: "origin", submitted: false }, { status: 400 });
  const account = await getCurrentAccount();
  if (!account || !isProvisionedOperator(account.walletAddress)) {
    return NextResponse.json({ ok: false, code: "forbidden", submitted: false }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "body", submitted: false }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, code: "body", submitted: false }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => ["parent", "scope", "transaction", "quotemint"].includes(key.toLowerCase()))) {
    return NextResponse.json({ ok: false, code: "parent_scope", submitted: false }, { status: 400 });
  }
  if (typeof record.launchId !== "string" || !UUID.test(record.launchId)) {
    return NextResponse.json({ ok: false, code: "body", submitted: false }, { status: 400 });
  }
  if (typeof record.buildId !== "string" || !UUID.test(record.buildId)) {
    return NextResponse.json({ ok: false, code: "body", submitted: false }, { status: 400 });
  }
  try {
    const parents = await getSql()<{ mint_address: string }[]>`
      select mint_address from parent_registrations
      where scope = 'test' and symbol = 'TREST' and eligible = true
      limit 1
    `;
    if (!parents[0]) return NextResponse.json({ ok: false, code: "parent_unregistered", submitted: false }, { status: 422 });
    const rows = await getSql()<{
      transaction: string;
      message_hash: string;
      parent_mint_address: string;
    }[]>`
      select b.transaction, b.message_hash, b.parent_mint_address
      from launch_builds b
      join token_launches l on l.id = b.launch_id
      where b.id = ${record.buildId}
        and b.launch_id = ${record.launchId}
        and b.account_id = ${account.id}
        and l.parent_scope = 'test'
        and l.parent_mint_address = b.parent_mint_address
        and b.parent_mint_address = ${parents[0].mint_address}
    `;
    const row = rows[0];
    if (!row) return NextResponse.json({ ok: false, code: "not_found", submitted: false }, { status: 404 });
    const simulated = await simulateExactWire({ transaction: row.transaction, committedHash: row.message_hash });
    if (!simulated.ok) {
      const status = simulated.code === "unavailable" ? 503 : 422;
      return NextResponse.json({ ok: false, code: simulated.code, submitted: false }, { status });
    }
    return NextResponse.json({ ok: true, simulated: true, submitted: false, messageHash: simulated.messageHash });
  } catch (error) {
    const code = databaseFailure(error) === "missing_schema" ? "parent_unregistered" : "unavailable";
    return NextResponse.json({ ok: false, code, submitted: false }, { status: code === "parent_unregistered" ? 422 : 503 });
  }
}
