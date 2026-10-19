export class SDKClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly remaining: number | null;

  constructor(code: string, message: string, status: number, remaining: number | null = null) {
    super(message);
    this.name = "SDKClientError";
    this.code = code;
    this.status = status;
    this.remaining = remaining;
  }
}

export type ExecutionUsage = {
  openaiRequests: number;
  heliusRequests: number;
  inputTokens: number;
  outputTokens: number;
};

export type ExecutionResult = {
  executionId: string;
  sdkId: string;
  version: number;
  contentHash: string;
  status: "SUCCESS" | "FAILED" | "REJECTED" | "TIMEOUT";
  output: Record<string, unknown> | null;
  usage: ExecutionUsage;
  durationMs: number;
  startedAt: string;
  finishedAt: string | null;
};

export type RunRequest = {
  sdkId: string;
  version?: number;
  input?: Record<string, unknown>;
  signal?: AbortSignal;
};

export type SDKClientOptions = {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 70_000;

export class SDKClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: SDKClientOptions) {
    if (options.apiKey.trim().length < 1) throw new SDKClientError("missing_api_key", "An API key is required.", 401);
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async run(request: RunRequest): Promise<ExecutionResult> {
    if (request.signal?.aborted) throw new SDKClientError("cancelled", "The request was cancelled.", 0);
    const controller = new AbortController();
    const timedOut = { value: false };
    const timer = setTimeout(() => {
      timedOut.value = true;
      controller.abort();
    }, this.timeoutMs);
    const onAbort = (): void => controller.abort();
    request.signal?.addEventListener("abort", onAbort);
    const payload: { sdkId: string; version?: number; input: Record<string, unknown> } = {
      sdkId: request.sdkId,
      input: request.input ?? {},
    };
    if (request.version !== undefined) payload.version = request.version;
    try {
      const response = await fetch(new URL("/api/v1/sdk/execute", this.baseUrl), {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      return await readResult(response);
    } catch (error) {
      if (error instanceof SDKClientError) throw error;
      if (isAbort(error)) {
        throw new SDKClientError(
          timedOut.value ? "timeout" : "cancelled",
          timedOut.value ? "The request reached its time limit." : "The request was cancelled.",
          timedOut.value ? 504 : 0,
        );
      }
      throw new SDKClientError("internal_error", "The execution could not be completed.", 0);
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
    }
  }
}

async function readResult(response: Response): Promise<ExecutionResult> {
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const error = body !== null && typeof body === "object" && "error" in body ? body.error : null;
    const record = error !== null && typeof error === "object" ? error : null;
    const code = record && "code" in record && typeof record.code === "string" ? record.code : "internal_error";
    const message =
      record && "message" in record && typeof record.message === "string"
        ? record.message
        : "The execution could not be completed.";
    const remaining = record && "remaining" in record && typeof record.remaining === "number" ? record.remaining : null;
    throw new SDKClientError(code, message, response.status, remaining);
  }
  if (!isExecution(body)) throw new SDKClientError("internal_error", "The execution response was not usable.", response.status);
  return body;
}

function isExecution(value: unknown): value is ExecutionResult {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.executionId === "string" &&
    typeof record.sdkId === "string" &&
    typeof record.version === "number" &&
    typeof record.contentHash === "string" &&
    typeof record.status === "string" &&
    typeof record.durationMs === "number" &&
    typeof record.startedAt === "string" &&
    (record.finishedAt === null || typeof record.finishedAt === "string") &&
    record.output !== undefined &&
    record.usage !== null &&
    typeof record.usage === "object"
  );
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
