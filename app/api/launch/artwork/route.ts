import { NextResponse } from "next/server";

import { IMAGE_MAX_BYTES } from "@/lib/launch/image";
import { getCurrentAccount } from "@/lib/server/account";
import { launchError } from "@/lib/server/launch/http";
import { LaunchFlowError, saveArtwork } from "@/lib/server/launch/service";
import { trustedOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  if (!trustedOrigin(request)) {
    return NextResponse.json(
      { error: "The launch request was not accepted.", code: "origin" },
      { status: 400 }
    );
  }
  const account = await getCurrentAccount();
  if (!account) {
    return NextResponse.json(
      { error: "Sign in to prepare a launch.", code: "unauthenticated" },
      { status: 401 }
    );
  }
  const declared =
    (request.headers.get("content-type") ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase() ?? "";
  const length = Number(request.headers.get("content-length") ?? "");
  if (!Number.isInteger(length) || length < 1) {
    return NextResponse.json(
      { error: "Artwork must include its file size.", code: "length" },
      { status: 411 }
    );
  }
  if (length > IMAGE_MAX_BYTES) {
    return NextResponse.json(
      { error: "Artwork must be 5 MB or smaller.", code: "too_large" },
      { status: 413 }
    );
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength !== length || bytes.byteLength > IMAGE_MAX_BYTES) {
    return NextResponse.json(
      { error: "Artwork must be 5 MB or smaller.", code: "too_large" },
      { status: 413 }
    );
  }
  try {
    return NextResponse.json(await saveArtwork(account, bytes, declared));
  } catch (error) {
    if (error instanceof LaunchFlowError && error.code === "image_type") {
      return NextResponse.json(
        { error: "The file contents do not match its type.", code: error.code },
        { status: 422 }
      );
    }
    return launchError(error);
  }
}
