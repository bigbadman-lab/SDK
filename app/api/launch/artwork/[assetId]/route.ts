import { NextResponse } from "next/server";

import { getCurrentAccount } from "@/lib/server/account";
import { launchError } from "@/lib/server/launch/http";
import { readOwnedArtwork } from "@/lib/server/launch/service";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ assetId: string }> }
): Promise<NextResponse> {
  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json(
      { error: "Sign in to prepare a launch.", code: "unauthenticated" },
      { status: 401 }
    );
  }
  const { assetId } = await context.params;
  try {
    const image = await readOwnedArtwork(account, assetId);
    return new NextResponse(new Blob([copyArtwork(image.bytes)]), {
      headers: {
        "content-type": image.contentType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return launchError(error);
  }
}

function copyArtwork(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
