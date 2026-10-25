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

export const API_COPY = {
  missingApiKey: "Add your SDK API key to the Authorization header to continue.",
  invalidApiKey: "We couldn't verify this API key. Check your key in Account → API Keys.",
  revokedApiKey: "This API key has been revoked. Create a new key in Account → API Keys.",
  invalidSdkInput: "This input doesn't match the SDK's requirements. Check the required fields in the Library.",
  invalidJson: "We couldn't read the request body. Check that you're sending valid JSON.",
  bodyTooLarge: "The request body is larger than the API accepts.",
  requestShape: "Send a valid SDK ID. If you include a version, use a whole number of 1 or greater.",
  keyLabel: "Enter an API key label between 1 and 80 characters.",
  origin: "This request was not accepted.",
  sdkNotFound: "We couldn't find this SDK. Check the SDK ID and try again.",
  sdkUnavailable: "This SDK isn't available for execution. Check its status in the Library.",
  versionNotFound: "This SDK version isn't available. Check the published versions in the Library.",
  quotaExceeded: `You've reached your API execution limit of ${API_RUNS_PER_DAY} for the UTC day. Check your usage in Account.`,
  concurrencyLimit: "You have too many executions running. Try again when one finishes.",
  spendLimit: "Execution is temporarily unavailable because a spending limit has been reached.",
  providerFailure: "This SDK couldn't complete its provider request. Please try again later.",
  timeout: "This SDK took too long to respond. Please try again.",
  unavailable: "SDK execution is temporarily unavailable. Please try again later.",
  internalError: "We couldn't complete this execution. Please try again.",
  keysUnavailable: "API keys are temporarily unavailable. Please try again later.",
  keysInternal: "We couldn't update your API keys. Please try again.",
  keyLimit: "This account already has five active API keys. Revoke one in Account → API Keys before creating another.",
  keyNotFound: "We couldn't find this API key. Check Account → API Keys.",
} as const;

const MESSAGES: Record<ApiErrorCode, { status: number; message: string }> = {
  missing_api_key: { status: 401, message: API_COPY.missingApiKey },
  unauthenticated: { status: 401, message: "Sign in to manage API keys." },
  invalid_api_key: { status: 401, message: API_COPY.invalidApiKey },
  revoked_api_key: { status: 401, message: API_COPY.revokedApiKey },
  quota_exceeded: { status: 429, message: API_COPY.quotaExceeded },
  concurrency_limit: { status: 429, message: API_COPY.concurrencyLimit },
  spend_limit: { status: 429, message: API_COPY.spendLimit },
  sdk_not_found: { status: 404, message: API_COPY.sdkNotFound },
  sdk_unavailable: { status: 404, message: API_COPY.sdkUnavailable },
  version_not_found: { status: 404, message: API_COPY.versionNotFound },
  invalid_input: { status: 400, message: API_COPY.invalidSdkInput },
  provider_failure: { status: 502, message: API_COPY.providerFailure },
  timeout: { status: 504, message: API_COPY.timeout },
  internal_error: { status: 500, message: API_COPY.internalError },
  key_limit: { status: 409, message: API_COPY.keyLimit },
  key_not_found: { status: 404, message: API_COPY.keyNotFound },
  unavailable: { status: 503, message: API_COPY.unavailable },
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
