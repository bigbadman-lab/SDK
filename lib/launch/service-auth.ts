import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const NONCE = /^[A-Za-z0-9_-]{16,80}$/;
export const SERVICE_SKEW_SECONDS = 60;

export function requestChecksum(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function serviceCanonical(input: {
  timestamp: string;
  nonce: string;
  method: string;
  path: string;
  body: string;
}): string {
  return [
    input.timestamp,
    input.nonce,
    input.method.toUpperCase(),
    input.path,
    requestChecksum(input.body),
  ].join(".");
}

export function signServiceRequest(input: {
  secret: string;
  timestamp: string;
  nonce: string;
  method: string;
  path: string;
  body: string;
}): string {
  return createHmac("sha256", input.secret)
    .update(serviceCanonical(input))
    .digest("hex");
}

export function verifyServiceRequest(input: {
  secret: string;
  timestamp: string;
  nonce: string;
  method: string;
  path: string;
  body: string;
  signature: string;
  nowSeconds: number;
}): { ok: true } | { ok: false; code: "signature" | "timestamp" | "nonce" } {
  if (!NONCE.test(input.nonce)) return { ok: false, code: "nonce" };
  if (!/^[0-9]{10,12}$/.test(input.timestamp)) return { ok: false, code: "timestamp" };
  const stamped = Number(input.timestamp);
  if (!Number.isSafeInteger(stamped)) return { ok: false, code: "timestamp" };
  if (Math.abs(input.nowSeconds - stamped) > SERVICE_SKEW_SECONDS) {
    return { ok: false, code: "timestamp" };
  }
  const expected = signServiceRequest(input);
  const left = Buffer.from(expected);
  const right = Buffer.from(input.signature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return { ok: false, code: "signature" };
  }
  return { ok: true };
}
