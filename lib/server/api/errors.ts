import "server-only";

import { apiError, type ApiErrorCode } from "@/lib/api/contract";

export class ApiFlowError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly remaining: number | null;

  constructor(code: ApiErrorCode, remaining: number | null = null, message?: string) {
    const described = apiError(code);
    super(message ?? described.message);
    this.name = "ApiFlowError";
    this.status = described.status;
    this.code = code;
    this.remaining = remaining;
  }
}
