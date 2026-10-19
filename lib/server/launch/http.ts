import "server-only";

import { NextResponse } from "next/server";

import { launchMessage } from "@/lib/launch/messages";
import { LaunchFlowError } from "@/lib/server/launch/service";

export function launchError(error: unknown): NextResponse {
  if (error instanceof LaunchFlowError) {
    console.error(`[launch] ${error.code}`);
    return NextResponse.json(
      { error: launchMessage(error.code), code: error.code },
      { status: error.status }
    );
  }
  console.error("[launch] unexpected");
  return NextResponse.json(
    { error: launchMessage("unavailable"), code: "unavailable" },
    { status: 503 }
  );
}
