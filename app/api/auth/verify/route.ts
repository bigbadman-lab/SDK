import { NextResponse } from "next/server";

import { verifyLoginChallenge } from "@/lib/server/auth";
import { authError, sessionCookie } from "@/lib/server/http";
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
  const challengeId =
    typeof body === "object" &&
    body !== null &&
    "challengeId" in body &&
    typeof body.challengeId === "string"
      ? body.challengeId
      : "";
  const signature =
    typeof body === "object" &&
    body !== null &&
    "signature" in body &&
    typeof body.signature === "string"
      ? body.signature
      : "";
  if (signature.length > 200) {
    return NextResponse.json({ error: "Unable to sign in." }, { status: 400 });
  }
  try {
    const result = await verifyLoginChallenge({
      challengeId,
      signature,
      domain: origin.domain,
      clientKey: clientAddress(request),
    });
    const response = NextResponse.json({
      authenticated: true,
      walletAddress: result.account.walletAddress,
    });
    response.cookies.set(
      sessionCookie({
        request,
        token: result.token,
        maxAge: result.maxAge,
      }),
    );
    return response;
  } catch (error) {
    return authError(error);
  }
}
