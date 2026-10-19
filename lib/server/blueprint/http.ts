import "server-only";

import { NextResponse } from "next/server";

import { BlueprintFlowError } from "@/lib/server/blueprint/service";

export function describeBlueprintError(error: unknown): { status: number; code: string; error: string } {
  if (error instanceof BlueprintFlowError) {
    console.error(`[blueprint] ${error.code}`);
    return { status: error.status, code: error.code, error: publicMessage(error.code) };
  }
  console.error("[blueprint] unexpected");
  return { status: 503, code: "unexpected", error: "The Builder is unavailable." };
}

export function blueprintError(error: unknown): NextResponse {
  const described = describeBlueprintError(error);
  return NextResponse.json(
    { error: described.error, code: described.code },
    { status: described.status },
  );
}

function publicMessage(code: string): string {
  if (code === "quota" || code === "spend_limit" || code === "concurrency" || code === "draft_limit") {
    return "The account limit for this action has been reached.";
  }
  if (code === "revision_conflict") {
    return "This draft changed in another request. Reload it and try again.";
  }
  if (code === "draft_not_found") return "That draft is not available.";
  if (code === "schema_missing" || code === "provider_unconfigured" || code === "database_unavailable") {
    return "The Builder is unavailable.";
  }
  if (
    code === "draft_unavailable" ||
    code === "version_unavailable" ||
    code === "execution_unavailable" ||
    code === "conversation_unavailable"
  ) {
    return "The draft could not be saved.";
  }
  if (code === "timeout") return "The run reached its time limit.";
  if (code === "provider") return "The provider did not return a usable result.";
  if (code === "unsupported_operation") return "That SDK uses an operation the engine does not run.";
  if (code === "invalid_reference") return "The blueprint refers to a step or input that is not available.";
  if (code === "unsupported_configuration") return "That step configuration is not supported.";
  if (code === "persistence") return "The draft could not be saved.";
  if (code === "test_required") return "Test this blueprint successfully before saving it.";
  if (code === "name") return "Enter a name up to 80 characters.";
  if (code === "description") return "Enter a description up to 500 characters.";
  return "The blueprint request was not accepted.";
}
