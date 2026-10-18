import { NextResponse } from "next/server";

import { createLoginChallenge } from "@/lib/server/auth";
import { authError } from "@/lib/server/http";
import { clientAddress, trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const origin = trustedOrigin(request);
  if (!origin) {
    return NextResponse.json({ error: "Unable to sign in." }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Unable to sign in." }, { status: 400 });
  }
  const walletAddress =
    typeof body === "object" &&
    body !== null &&
    "walletAddress" in body &&
    typeof body.walletAddress === "string"
      ? body.walletAddress
      : "";
  try {
    const challenge = await createLoginChallenge({
      walletAddress,
      domain: origin.domain,
      origin: origin.origin,
      clientKey: clientAddress(request),
    });
    return NextResponse.json(challenge);
  } catch (error) {
    return authError(error);
  }
}
