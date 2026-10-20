import { NextResponse } from "next/server";

import { launchMessage } from "@/lib/launch/messages";
import { getCurrentAccount } from "@/lib/server/account";
import { recoverSignedLaunch } from "@/lib/server/launch/submit";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<NextResponse> {
  if (!trustedOrigin(request)) {
    return NextResponse.json({ ok: false, code: "origin", broadcast: false }, { status: 400 });
  }
  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json(
      { ok: false, error: launchMessage("unauthenticated"), code: "unauthenticated", broadcast: false },
      { status: 401 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "body", broadcast: false }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, code: "body", broadcast: false }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => ["parent", "scope", "transaction", "signature"].includes(key.toLowerCase()))) {
    return NextResponse.json({ ok: false, code: "parent_scope", broadcast: false }, { status: 400 });
  }
  if (typeof record.launchId !== "string" || !UUID.test(record.launchId)) {
    return NextResponse.json({ ok: false, code: "body", broadcast: false }, { status: 400 });
  }
  const result = await recoverSignedLaunch({
    accountId: account.id,
    launchId: record.launchId,
  });
  if (!result.ok) {
    const status = result.code === "forbidden" ? 403 : result.code === "not_found" ? 404 : result.code === "not_ready" ? 503 : 422;
    return NextResponse.json({ ok: false, code: result.code, broadcast: false }, { status });
  }
  return NextResponse.json({
    ok: true,
    code: result.status,
    broadcast: result.broadcast,
    signature: result.signature,
  });
}
