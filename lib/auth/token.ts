import { createHmac, randomBytes } from "node:crypto";

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createNonce(): string {
  return randomBytes(16).toString("hex");
}

export function hashSessionToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function hashRateLimitKey(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}
