import { NextResponse } from "next/server";

import { canonicalAddress } from "@/lib/auth/solana";
import { parseParentObservationRequest } from "@/lib/launch/builder-request";
import { reviewTestParent, type ParentObservation } from "@/lib/launch/parent";
import { getCurrentAccount } from "@/lib/server/account";
import { databaseFailure, getSql } from "@/lib/server/db";
import { requestParentObservation } from "@/lib/server/launch/unsigned";
import { isProvisionedOperator } from "@/lib/server/operator";
import { trustedOrigin } from "@/lib/server/origin";
import { storeTestParent } from "@/lib/server/trest/register";

export const dynamic = "force-dynamic";

async function productionMint(): Promise<
  { ok: true; mint: string | null } | { ok: false; code: "missing_schema" | "unavailable" }
> {
  try {
    const rows = await getSql()<{ mint_address: string | null }[]>`
      select mint_address from sdk_parent_config where id = 1
    `;
    return { ok: true, mint: rows[0]?.mint_address ?? null };
  } catch (error) {
    return { ok: false, code: databaseFailure(error) };
  }
}

function chainView(observation: ParentObservation, eligible: boolean) {
  return {
    parent: "TREST" as const,
    mint: observation.mint,
    creator: observation.creator,
    eligible,
    graduated: observation.graduated,
    pool: observation.pool,
    bondingCurve: observation.bondingCurve,
    feeMode: observation.feeMode,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!trustedOrigin(request)) {
    return NextResponse.json({ ok: false, code: "origin", parent: "TREST" }, { status: 400 });
  }
  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json({ ok: false, code: "unauthenticated", parent: "TREST" }, { status: 401 });
  }
  if (!isProvisionedOperator(account.walletAddress)) {
    return NextResponse.json({ ok: false, code: "forbidden", parent: "TREST" }, { status: 403 });
  }
  const operator = canonicalAddress(account.walletAddress);
  if (!operator) {
    return NextResponse.json({ ok: false, code: "forbidden", parent: "TREST" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, code: "body", parent: "TREST" }, { status: 400 });
  }
  const parsed = parseParentObservationRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ ok: false, code: "body", parent: "TREST" }, { status: 400 });
  }
  const observed = await requestParentObservation(parsed.mint);
  if (!observed.ok) {
    return NextResponse.json(
      { ok: false, code: observed.code, parent: "TREST", registration: "rejected" },
      { status: observed.code === "unavailable" || observed.code === "builder_unconfigured" ? 503 : 422 },
    );
  }
  const production = await productionMint();
  if (!production.ok) {
    return NextResponse.json(
      { ...chainView(observed.observation, false), ok: false, code: production.code, registration: "not_stored" },
      { status: 503 },
    );
  }
  const reviewed = reviewTestParent({
    observation: observed.observation,
    productionMint: production.mint,
    claimedDeployer: null,
  });
  if (!reviewed.ok) {
    return NextResponse.json(
      { ...chainView(observed.observation, false), ok: false, code: reviewed.code, registration: "rejected" },
      { status: 422 },
    );
  }
  const stored = await storeTestParent({ registration: reviewed.registration, operator });
  if (!stored.ok && stored.code === "missing_schema") {
    return NextResponse.json(
      { ...chainView(observed.observation, true), ok: false, code: "not_stored", registration: "not_stored" },
      { status: 503 },
    );
  }
  if (!stored.ok) {
    return NextResponse.json(
      { ...chainView(observed.observation, true), ok: false, code: stored.code, registration: "rejected" },
      { status: stored.code === "conflict" ? 409 : 503 },
    );
  }
  return NextResponse.json({
    ...chainView(observed.observation, true),
    ok: true,
    registration: "stored",
  });
}
