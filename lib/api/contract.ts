import { API_RUNS_PER_DAY } from "../blueprint/model.ts";

export const ACTIVE_API_KEYS_PER_ACCOUNT = 5;
export const API_BODY_LIMIT_BYTES = 262_144;

export type ApiErrorCode =
  | "missing_api_key"
  | "unauthenticated"
  | "invalid_api_key"
  | "revoked_api_key"
  | "quota_exceeded"
  | "concurrency_limit"
  | "spend_limit"
  | "sdk_not_found"
  | "sdk_unavailable"
  | "version_not_found"
  | "invalid_input"
  | "provider_failure"
  | "timeout"
  | "internal_error"
  | "key_limit"
  | "key_not_found"
  | "unavailable";

export type PublicExecution = {
  executionId: string;
  sdkId: string;
  version: number;
  contentHash: string;
  status: "SUCCESS" | "FAILED" | "REJECTED" | "TIMEOUT";
  output: Record<string, unknown> | null;
  usage: {
    openaiRequests: number;
    heliusRequests: number;
    inputTokens: number;
    outputTokens: number;
  };
  durationMs: number;
  startedAt: string;
  finishedAt: string | null;
};

const MESSAGES: Record<ApiErrorCode, { status: number; message: string }> = {
  missing_api_key: { status: 401, message: "Send the API key in the Authorization header." },
  unauthenticated: { status: 401, message: "Sign in to manage API keys." },
  invalid_api_key: { status: 401, message: "The API key is not valid." },
  revoked_api_key: { status: 401, message: "The API key has been revoked." },
  quota_exceeded: { status: 429, message: "This account has used its 100 API executions for the UTC day." },
  concurrency_limit: { status: 429, message: "This account already has the maximum number of runs in progress." },
  spend_limit: { status: 429, message: "The provider budget for this period has been reached." },
  sdk_not_found: { status: 404, message: "That SDK was not found." },
  sdk_unavailable: { status: 404, message: "That SDK is not published." },
  version_not_found: { status: 404, message: "That published version was not found." },
  invalid_input: { status: 400, message: "The input does not match this SDK." },
  provider_failure: { status: 502, message: "The provider did not return a usable result." },
  timeout: { status: 504, message: "The run reached its time limit." },
  internal_error: { status: 500, message: "The execution could not be completed." },
  key_limit: { status: 409, message: "This account already has five active API keys." },
  key_not_found: { status: 404, message: "That API key is not available." },
  unavailable: { status: 503, message: "The execution API is unavailable." },
};

export function apiError(code: ApiErrorCode): { status: number; code: ApiErrorCode; message: string } {
  const known = MESSAGES[code];
  return { status: known.status, code, message: known.message };
}

export function presentedKey(header: string | null): { ok: true; secret: string } | { ok: false; code: "missing_api_key" | "invalid_api_key" } {
  if (!header) return { ok: false, code: "missing_api_key" };
  const match = /^Bearer\s+(\S+)$/.exec(header);
  const secret = match?.[1] ?? "";
  if (!/^sdk_[A-Za-z0-9_-]{43}$/.test(secret)) return { ok: false, code: "invalid_api_key" };
  return { ok: true, secret };
}

export function keyLookup(input: { match: boolean; revoked: boolean }): "active" | "invalid_api_key" | "revoked_api_key" {
  if (!input.match) return "invalid_api_key";
  if (input.revoked) return "revoked_api_key";
  return "active";
}

export function apiQuota(used: number): { admit: boolean; remaining: number } {
  if (used >= API_RUNS_PER_DAY) return { admit: false, remaining: 0 };
  return { admit: true, remaining: API_RUNS_PER_DAY - used - 1 };
}

export function activeKeySlot(active: number): "create" | "reject" {
  return active >= ACTIVE_API_KEYS_PER_ACCOUNT ? "reject" : "create";
}

export function publishedVersionChoice(input: {
  found: boolean;
  published: boolean;
  requestedVersion: number | null;
  availableVersions: readonly number[];
  currentVersion: number | null;
}): { ok: true; version: number } | { ok: false; code: "sdk_not_found" | "sdk_unavailable" | "version_not_found" } {
  if (!input.found) return { ok: false, code: "sdk_not_found" };
  if (!input.published) return { ok: false, code: "sdk_unavailable" };
  const version = input.requestedVersion ?? input.currentVersion;
  if (version === null || !input.availableVersions.includes(version)) {
    return { ok: false, code: "version_not_found" };
  }
  return { ok: true, version };
}

export function failureStatus(code: string): "TIMEOUT" | "FAILED" {
  return code === "timeout" ? "TIMEOUT" : "FAILED";
}

export function publicExecution(input: {
  executionId: string;
  sdkId: string;
  version: number;
  contentHash: string;
  status: PublicExecution["status"];
  output: Record<string, unknown> | null;
  openaiRequests: number;
  heliusRequests: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  startedAt: string;
  finishedAt: string | null;
}): PublicExecution {
  return {
    executionId: input.executionId,
    sdkId: input.sdkId,
    version: input.version,
    contentHash: input.contentHash,
    status: input.status,
    output: input.output,
    usage: {
      openaiRequests: input.openaiRequests,
      heliusRequests: input.heliusRequests,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
    },
    durationMs: input.durationMs,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
  };
}
