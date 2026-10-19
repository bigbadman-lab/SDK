import "server-only";

import { failureStatus, publicExecution, publishedVersionChoice, type PublicExecution } from "@/lib/api/contract";
import { runBlueprint } from "@/lib/blueprint/execute";
import { contentHash } from "@/lib/blueprint/json";
import type { Blueprint } from "@/lib/blueprint/model";
import { validateBlueprint, validateInputsAgainst } from "@/lib/blueprint/validate";
import { ApiFlowError } from "@/lib/server/api/errors";
import { BlueprintFlowError, beginApiExecution, finishLibraryExecution } from "@/lib/server/blueprint/service";
import { databaseFailure, getSql } from "@/lib/server/db";
import { heliusRpc, openAiStructured } from "@/lib/server/blueprint/providers";

export async function executePublishedSdk(input: {
  accountId: string;
  keyId: string;
  sdkId: string;
  version: number | null;
  values: unknown;
}): Promise<PublicExecution> {
  const resolved = await resolvePublished(input.sdkId, input.version);
  const validated = validateBlueprint(resolved.blueprint);
  if (!validated.ok) throw new ApiFlowError("sdk_unavailable");
  const hash = contentHash(validated.blueprint);
  if (hash !== resolved.contentHash) throw new ApiFlowError("sdk_unavailable");
  const inputs = validateInputsAgainst(validated.blueprint, input.values);
  if (!inputs.ok) throw new ApiFlowError("invalid_input");
  const aiSteps = validated.blueprint.steps.filter((step) => step.op === "ai.generate" || step.op === "ai.analyze").length;
  let reserved: { executionId: string; startedAt: string };
  try {
    reserved = await beginApiExecution({
      accountId: input.accountId,
      keyId: input.keyId,
      libraryVersionId: resolved.versionId,
      aiSteps,
    });
  } catch (error) {
    throw mapAdmission(error);
  }
  const started = Date.now();
  try {
    const result = await runBlueprint({
      blueprint: validated.blueprint,
      values: inputs.values,
      startedAt: started,
      ports: { now: () => Date.now(), openai: openAiStructured, helius: heliusRpc },
    });
    await finishLibraryExecution(reserved.executionId, result);
    return publicExecution({
      executionId: reserved.executionId,
      sdkId: resolved.sdkId,
      version: resolved.versionNumber,
      contentHash: hash,
      status: result.status,
      output: result.output ?? null,
      openaiRequests: result.openaiRequests,
      heliusRequests: result.heliusRequests,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs,
      startedAt: reserved.startedAt,
      finishedAt: new Date(started + result.durationMs).toISOString(),
    });
  } catch (error) {
    const code = error instanceof BlueprintFlowError ? error.code : "provider";
    await finishLibraryExecution(reserved.executionId, {
      status: failureStatus(code),
      errorCode: code,
      traces: [],
      durationMs: Date.now() - started,
      openaiRequests: 0,
      heliusRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
    }).catch(() => undefined);
    if (code === "timeout") throw new ApiFlowError("timeout");
    throw new ApiFlowError("provider_failure");
  }
}

async function resolvePublished(
  sdkId: string,
  requestedVersion: number | null,
): Promise<{ sdkId: string; versionId: string; versionNumber: number; contentHash: string; blueprint: Blueprint }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sdkId)) {
    throw new ApiFlowError("sdk_not_found");
  }
  let rows: {
    id: string;
    status: string;
    current_version: number | null;
    version_id: string | null;
    version_number: number | null;
    content_hash: string | null;
    blueprint: Blueprint | null;
    versions: number[] | null;
  }[];
  try {
    rows = await getSql()<typeof rows[number][]>`
      select
        library_sdks.id,
        library_sdks.status,
        current.version_number as current_version,
        library_versions.id as version_id,
        library_versions.version_number,
        library_versions.content_hash,
        library_versions.blueprint,
        (
          select coalesce(json_agg(version_number order by version_number), '[]'::json)
          from library_versions
          where sdk_id = library_sdks.id
        ) as versions
      from library_sdks
      left join library_versions current on current.id = library_sdks.current_version_id
      left join library_versions on library_versions.sdk_id = library_sdks.id
        and library_versions.version_number = coalesce(${requestedVersion}, current.version_number)
      where library_sdks.id = ${sdkId}
    `;
  } catch (error) {
    throw new ApiFlowError(databaseFailure(error) === "missing_schema" ? "unavailable" : "internal_error");
  }
  const row = rows[0];
  const rawVersions = row?.versions;
  const parsedVersions = typeof rawVersions === "string" ? safeJsonArray(rawVersions) : rawVersions;
  const versions = Array.isArray(parsedVersions) ? parsedVersions.map(Number).filter((value) => Number.isInteger(value)) : [];
  const choice = publishedVersionChoice({
    found: Boolean(row),
    published: row?.status === "published",
    requestedVersion,
    availableVersions: versions,
    currentVersion: row?.current_version ?? null,
  });
  if (!choice.ok) throw new ApiFlowError(choice.code);
  if (!row?.version_id || !row.content_hash || !row.blueprint || row.version_number !== choice.version) {
    throw new ApiFlowError("version_not_found");
  }
  return {
    sdkId: row.id,
    versionId: row.version_id,
    versionNumber: row.version_number,
    contentHash: row.content_hash,
    blueprint: row.blueprint,
  };
}

function safeJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapAdmission(error: unknown): ApiFlowError {
  if (error instanceof ApiFlowError) return error;
  if (error instanceof BlueprintFlowError) {
    if (error.code === "quota") return new ApiFlowError("quota_exceeded", 0);
    if (error.code === "concurrency") return new ApiFlowError("concurrency_limit");
    if (error.code === "spend_limit") return new ApiFlowError("spend_limit");
    if (error.code === "revoked_api_key") return new ApiFlowError("revoked_api_key");
    if (error.code === "timeout") return new ApiFlowError("timeout");
    if (error.code === "schema_missing" || error.code === "database_unavailable" || error.code === "provider_unconfigured") {
      return new ApiFlowError("unavailable");
    }
  }
  return new ApiFlowError("internal_error");
}
